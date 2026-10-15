//! Cron scheduler (TASK-22 Tier B) — AionUi "Scheduled Tasks" shape, Tauri-native.
//!
//! Jobs live in `app_data_dir/cron/jobs.json` (single source of truth — doc-1
//! §6 "single copy per data"). Each `ICronJob` is conversation-bound
//! (`executionMode: continue | new`), timezone-anchored (IANA `tz`, repaired
//! to the system zone when missing/invalid on load), and either a standard
//! 5-field cron expression, a fixed interval, or a one-time datetime.
//!
//! The ticker runs on a background thread, polls every 30s, and fires jobs
//! whose scheduled time has passed while the app was awake (AionUi's
//! "detect missed triggers after wake" behavior). Firing = recording a run
//! in `runs` history + logging; conversation dispatch is the frontend's job
//! (it polls `cron_due_jobs` and posts the prompt into the bound
//! conversation), keeping this module free of ACP dependencies.
//!
//! Queue protection (AionUi `cron.json:86-88`): a job with
//! `queue_protection: true` is skipped when its previous run is still
//! marked `running` in history.

use std::collections::HashMap;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use cron::Schedule;
use serde::{Deserialize, Serialize};

/// How often the ticker wakes to evaluate schedules.
const TICK_POLL_SECS: u64 = 30;

/// Normalize a standard 5-field cron expression (`min hour dom mon dow`)
/// into the `cron` crate's 7-field shape (`sec min hour dom mon dow [year]`)
/// by prefixing a `0` seconds field. 5-field is the only durable stored
/// shape (doc-1 §6); this is pure sugar at the parse boundary.
fn normalize_cron_expr(expr: &str) -> String {
    let trimmed = expr.trim();
    let field_count = trimmed.split_whitespace().count();
    if field_count == 5 {
        format!("0 {trimmed}")
    } else {
        trimmed.to_string()
    }
}

/// Parse a stored (5- or 7-field) cron expression into a `Schedule`.
fn parse_cron_schedule(expr: &str) -> Result<Schedule, String> {
    Schedule::from_str(&normalize_cron_expr(expr))
        .map_err(|e| format!("invalid cron expression \"{expr}\": {e}"))
}

// ---------------------------------------------------------------------------
// Job shape
// ---------------------------------------------------------------------------

/// Execution mode (AionUi `CreateTaskDialog`): append to the bound
/// conversation's history, or start a fresh conversation each run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CronExecutionMode {
    Continue,
    New,
}

/// One scheduled job — the AionUi `ICronJob` analogue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronJob {
    pub id: String,
    pub name: String,
    /// Prompt sent to the agent when the job fires.
    pub prompt: String,
    /// Agent registry id (optional — server default when absent).
    #[serde(default)]
    pub agent: Option<String>,
    /// Model override (optional).
    #[serde(default)]
    pub model: Option<String>,
    /// Conversation this job appends to in `continue` mode.
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// Exactly one of these three is set:
    #[serde(default)]
    pub cron_expr: Option<String>,
    #[serde(default)]
    pub interval_minutes: Option<u64>,
    /// One-time ISO-8601 datetime; the job auto-disables after firing.
    #[serde(default)]
    pub one_time_at: Option<String>,
    /// IANA timezone for cron evaluation (e.g. `Asia/Tokyo`).
    pub tz: String,
    pub execution_mode: CronExecutionMode,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Keep the machine awake while this job is armed (frontend honors it).
    #[serde(default)]
    pub keep_awake: bool,
    /// Skip the tick when the previous run is still running.
    #[serde(default)]
    pub queue_protection: bool,
}

fn default_true() -> bool {
    true
}

/// One recorded run (AionUi execution history).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronRunRecord {
    pub job_id: String,
    pub fired_at: String,
    pub status: CronRunStatus,
    #[serde(default)]
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CronRunStatus {
    Running,
    Done,
    Failed,
    Skipped,
}

/// The persisted store — `app_data_dir/cron/jobs.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct CronStore {
    jobs: Vec<CronJob>,
    runs: Vec<CronRunRecord>,
}

// ---------------------------------------------------------------------------
// Store: load / save / tz repair
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct CronState {
    store_path: PathBuf,
    store: Arc<Mutex<CronStore>>,
    /// Last time each job fired (in-memory; recomputed from history on boot).
    last_fired: Arc<Mutex<HashMap<String, DateTime<Utc>>>>,
}

impl CronState {
    pub fn load(app_data_dir: &std::path::Path) -> Result<Self, String> {
        let dir = app_data_dir.join("cron");
        std::fs::create_dir_all(&dir).map_err(|e| format!("cron dir create failed: {e}"))?;
        let store_path = dir.join("jobs.json");
        let mut store = if store_path.exists() {
            let raw = std::fs::read_to_string(&store_path)
                .map_err(|e| format!("cron jobs.json read failed: {e}"))?;
            serde_json::from_str::<CronStore>(&raw)
                .map_err(|e| format!("cron jobs.json parse failed: {e}"))?
        } else {
            CronStore::default()
        };
        repair_time_zones(&mut store.jobs);
        let mut last_fired = HashMap::new();
        for run in &store.runs {
            if let Ok(at) = DateTime::parse_from_rfc3339(&run.fired_at) {
                last_fired.insert(run.job_id.clone(), at.with_timezone(&Utc));
            }
        }
        let state = Self {
            store_path,
            store: Arc::new(Mutex::new(store)),
            last_fired: Arc::new(Mutex::new(last_fired)),
        };
        state.persist()?;
        Ok(state)
    }

    fn persist(&self) -> Result<(), String> {
        let guard = self.store.lock().map_err(|e| e.to_string())?;
        let json = serde_json::to_string_pretty(&*guard)
            .map_err(|e| format!("cron serialize failed: {e}"))?;
        std::fs::write(&self.store_path, json)
            .map_err(|e| format!("cron jobs.json write failed: {e}"))
    }

    pub fn list(&self) -> Vec<CronJob> {
        self.store
            .lock()
            .map(|g| g.jobs.clone())
            .unwrap_or_default()
    }

    pub fn upsert(&self, job: CronJob) -> Result<(), String> {
        {
            let mut guard = self.store.lock().map_err(|e| e.to_string())?;
            if let Some(existing) = guard.jobs.iter_mut().find(|j| j.id == job.id) {
                *existing = job;
            } else {
                guard.jobs.push(job);
            }
        }
        self.persist()
    }

    pub fn remove(&self, job_id: &str) -> Result<bool, String> {
        let removed = {
            let mut guard = self.store.lock().map_err(|e| e.to_string())?;
            let before = guard.jobs.len();
            guard.jobs.retain(|j| j.id != job_id);
            guard.runs.retain(|r| r.job_id != job_id);
            before != guard.jobs.len()
        };
        if removed {
            self.persist()?;
        }
        Ok(removed)
    }

    pub fn history(&self, job_id: Option<&str>, limit: usize) -> Vec<CronRunRecord> {
        self.store
            .lock()
            .map(|g| {
                let mut runs: Vec<CronRunRecord> = g
                    .runs
                    .iter()
                    .filter(|r| job_id.is_none_or(|id| r.job_id == id))
                    .cloned()
                    .collect();
                runs.sort_by(|a, b| b.fired_at.cmp(&a.fired_at));
                runs.truncate(limit);
                runs
            })
            .unwrap_or_default()
    }

    pub fn clear_history(&self, job_id: Option<&str>) -> Result<usize, String> {
        let removed = {
            let mut guard = self.store.lock().map_err(|e| e.to_string())?;
            let before = guard.runs.len();
            match job_id {
                Some(id) => guard.runs.retain(|r| r.job_id != id),
                None => guard.runs.clear(),
            }
            before - guard.runs.len()
        };
        if removed > 0 {
            self.persist()?;
        }
        Ok(removed)
    }

    /// Record that a job fired (called by the ticker or `run_now`).
    pub fn record_fired(&self, job_id: &str) -> Result<CronRunRecord, String> {
        let record = CronRunRecord {
            job_id: job_id.to_string(),
            fired_at: Utc::now().to_rfc3339(),
            status: CronRunStatus::Running,
            finished_at: None,
        };
        {
            let mut guard = self.store.lock().map_err(|e| e.to_string())?;
            guard.runs.push(record.clone());
            if let Ok(at) = DateTime::parse_from_rfc3339(&record.fired_at) {
                self_last_fired_insert(&self.last_fired, job_id, at.with_timezone(&Utc));
            }
        }
        self.persist()?;
        Ok(record)
    }

    /// Mark a run finished (frontend confirms dispatch; one-time jobs
    /// auto-disable here).
    pub fn record_finished(&self, job_id: &str, fired_at: &str, ok: bool) -> Result<(), String> {
        {
            let mut guard = self.store.lock().map_err(|e| e.to_string())?;
            for run in guard
                .runs
                .iter_mut()
                .filter(|r| r.job_id == job_id && r.fired_at == fired_at)
            {
                run.status = if ok {
                    CronRunStatus::Done
                } else {
                    CronRunStatus::Failed
                };
                run.finished_at = Some(Utc::now().to_rfc3339());
            }
            if ok {
                // One-time jobs auto-disable after a successful run (AionUi).
                if let Some(job) = guard.jobs.iter_mut().find(|j| j.id == job_id) {
                    if job.one_time_at.is_some() {
                        job.enabled = false;
                    }
                }
            }
        }
        self.persist()
    }

    /// Mark a run skipped (queue protection).
    pub fn record_skipped(&self, job_id: &str) -> Result<(), String> {
        {
            let mut guard = self.store.lock().map_err(|e| e.to_string())?;
            guard.runs.push(CronRunRecord {
                job_id: job_id.to_string(),
                fired_at: Utc::now().to_rfc3339(),
                status: CronRunStatus::Skipped,
                finished_at: Some(Utc::now().to_rfc3339()),
            });
        }
        self.persist()
    }

    /// Jobs whose schedule is due at `now` (ticker evaluation).
    /// Applies `enabled`, one-time expiry, and queue protection.
    pub fn due_jobs(&self, now: DateTime<Utc>) -> Vec<CronJob> {
        let guard = match self.store.lock() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        let last = match self.last_fired.lock() {
            Ok(l) => l,
            Err(_) => return Vec::new(),
        };
        let mut due = Vec::new();
        for job in &guard.jobs {
            if !job.enabled {
                continue;
            }
            let Some(due_at) = next_due_after(job, now, last.get(&job.id).copied()) else {
                continue;
            };
            if due_at > now {
                continue;
            }
            if job.queue_protection && is_running(&guard.runs, &job.id) {
                continue;
            }
            due.push(job.clone());
        }
        due
    }
}

fn self_last_fired_insert(
    last_fired: &Mutex<HashMap<String, DateTime<Utc>>>,
    job_id: &str,
    at: DateTime<Utc>,
) {
    if let Ok(mut last) = last_fired.lock() {
        last.insert(job_id.to_string(), at);
    }
}

fn is_running(runs: &[CronRunRecord], job_id: &str) -> bool {
    runs.iter()
        .any(|r| r.job_id == job_id && r.status == CronRunStatus::Running)
}

// ---------------------------------------------------------------------------
// Schedule evaluation
// ---------------------------------------------------------------------------

/// When is this job next due, given the evaluation time and the previous
/// fire time (if any)? Returns `None` when the job has no valid schedule.
fn next_due_after(
    job: &CronJob,
    now: DateTime<Utc>,
    last_fired: Option<DateTime<Utc>>,
) -> Option<DateTime<Utc>> {
    let tz: Tz = job.tz.parse().ok()?;
    let now_tz = now.with_timezone(&tz);
    if let Some(expr) = &job.cron_expr {
        // Standard 5-field cron — the only durable shape (doc-1 §6).
        let schedule = parse_cron_schedule(expr).ok()?;
        // `after` returns strictly-later times; for a never-fired job the
        // next tick after "now minus one poll window" fires immediately
        // (missed-trigger semantics).
        let anchor = now_tz - chrono::Duration::seconds(TICK_POLL_SECS as i64);
        let next = schedule.after(&anchor).next()?;
        return Some(next.with_timezone(&Utc));
    }
    if let Some(minutes) = job.interval_minutes {
        let interval = chrono::Duration::minutes(minutes as i64);
        return Some(match last_fired {
            // Interval jobs fire relative to their previous run.
            Some(prev) => prev + interval,
            // Never fired → due immediately (first tick).
            None => now,
        });
    }
    if let Some(at) = &job.one_time_at {
        let due = DateTime::parse_from_rfc3339(at).ok()?.with_timezone(&Utc);
        // Expired one-time jobs that already fired are disabled by
        // `record_finished`; a never-fired expired job fires once now
        // (missed-trigger semantics) unless it fired before this boot.
        return last_fired.map_or(Some(due), |_| None);
    }
    None
}

/// AionUi `repairCronJobTimeZone` pattern: rewrite stale/missing tz strings
/// to the current system zone on every load so `9am Tokyo` doesn't drift
/// after travel. System zone resolution goes through `chrono-tz`'s tzname
/// probe; falls back to UTC when the platform zone can't be mapped.
fn repair_time_zones(jobs: &mut [CronJob]) {
    let system_tz = system_time_zone().unwrap_or_else(|| "UTC".to_string());
    for job in jobs {
        if job.tz.parse::<Tz>().is_err() {
            job.tz = system_tz.clone();
        }
    }
}

/// IANA name of the current system zone. TASK-177: this read
/// `/etc/localtime` and fell through to `TZ`, so on Windows the link never
/// exists, every seeded job came up `UTC`, and a `9am` reminder fired at the
/// wrong hour with nothing in the log to explain it. `iana-time-zone` asks
/// the platform (tzdata symlink, the Windows timezone registry key, CoreFoundation).
/// `TZ` stays as the override and `None` (→ UTC) as the last resort.
fn system_time_zone() -> Option<String> {
    if let Some(tz) = iana_time_zone::get_timezone()
        .ok()
        .filter(|name| !name.is_empty())
    {
        return Some(tz);
    }
    if let Ok(tz_env) = std::env::var("TZ") {
        if !tz_env.is_empty() && tz_env.parse::<Tz>().is_ok() {
            return Some(tz_env);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Default jobs (seeded disabled — user opts in)
// ---------------------------------------------------------------------------

/// Seed the default jobs (doc-1 §5.2.2 B2 + §5.2.5 data-maintenance) on first boot.
pub fn seed_default_jobs(state: &CronState) -> Result<(), String> {
    let defaults = [
        CronJob {
            id: "default-morning-review-nudge".to_string(),
            name: "Morning review nudge".to_string(),
            prompt: "Good morning! Here is your FSRS review plan for today.".to_string(),
            agent: None,
            model: None,
            conversation_id: None,
            cron_expr: Some("0 8 * * *".to_string()),
            interval_minutes: None,
            one_time_at: None,
            tz: "Asia/Tokyo".to_string(),
            execution_mode: CronExecutionMode::Continue,
            enabled: false,
            keep_awake: false,
            queue_protection: true,
        },
        CronJob {
            id: "default-weekly-jlpt-mock".to_string(),
            name: "Weekly JLPT mock".to_string(),
            prompt: "Generate a fresh 20-question JLPT mock from my weak patterns.".to_string(),
            agent: None,
            model: None,
            conversation_id: None,
            cron_expr: Some("0 9 * * 1".to_string()),
            interval_minutes: None,
            one_time_at: None,
            tz: "Asia/Tokyo".to_string(),
            execution_mode: CronExecutionMode::New,
            enabled: false,
            keep_awake: false,
            queue_protection: true,
        },
        CronJob {
            id: "default-nightly-weak-pattern-rebuild".to_string(),
            name: "Nightly weak-pattern rebuild".to_string(),
            prompt: "Rebuild my weak-pattern quiz queue from recent mistakes.".to_string(),
            agent: None,
            model: None,
            conversation_id: None,
            cron_expr: None,
            interval_minutes: Some(360),
            one_time_at: None,
            tz: "Asia/Tokyo".to_string(),
            execution_mode: CronExecutionMode::Continue,
            enabled: false,
            keep_awake: false,
            queue_protection: true,
        },
        // doc-1 §5.2.5 — headless data-maintenance (background, no conversation)
        CronJob {
            id: "default-weekly-jmdict-refresh".to_string(),
            name: "Weekly JMdict refresh".to_string(),
            prompt: "Refresh JMdict/JMDict corpora (fetch-vocab tag check).".to_string(),
            agent: None,
            model: None,
            conversation_id: None,
            cron_expr: Some("0 3 * * 0".to_string()),
            interval_minutes: None,
            one_time_at: None,
            tz: "Asia/Tokyo".to_string(),
            execution_mode: CronExecutionMode::New,
            enabled: false,
            keep_awake: false,
            queue_protection: true,
        },
        CronJob {
            id: "default-weekly-sentences-rebuild".to_string(),
            name: "Weekly sentences rebuild".to_string(),
            prompt: "Rebuild sentences_fts from Tatoeba/Tanaka jpn_indices.".to_string(),
            agent: None,
            model: None,
            conversation_id: None,
            cron_expr: Some("0 4 * * 0".to_string()),
            interval_minutes: None,
            one_time_at: None,
            tz: "Asia/Tokyo".to_string(),
            execution_mode: CronExecutionMode::New,
            enabled: false,
            keep_awake: false,
            queue_protection: true,
        },
    ];
    let existing = state.list();
    for job in defaults {
        if !existing.iter().any(|j| j.id == job.id) {
            state.upsert(job)?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Ticker thread
// ---------------------------------------------------------------------------

/// Spawn the background ticker. Fires due jobs by recording them in history
/// — the frontend polls `cron_due_jobs` and dispatches the prompt into the
/// bound conversation (keeps this module ACP-free).
///
/// The ticker shares the same `Arc<Mutex<...>>` state as the managed
/// `CronState`, so jobs created via `cron_upsert` after boot are visible
/// immediately (fixed split-brain clone in v1).
pub fn spawn_ticker(state: CronState) {
    // Keep-awake accounting — how many enabled jobs request it (banner + log).
    let keep_awake_armed = state
        .list()
        .iter()
        .filter(|j| j.enabled && j.keep_awake)
        .count();
    if keep_awake_armed > 0 {
        log::info!("[cron] {keep_awake_armed} keep-awake job(s) armed");
    }
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(TICK_POLL_SECS));
        let now = Utc::now();
        let due = state.due_jobs(now);
        for job in due {
            if job.queue_protection && is_running(&state_history(&state), &job.id) {
                let _ = state.record_skipped(&job.id);
                continue;
            }
            let _ = state.record_fired(&job.id);
            log::info!("[cron] fired job {} ({})", job.id, job.name);
        }
    });
}

fn state_history(state: &CronState) -> Vec<CronRunRecord> {
    state.history(None, 100)
}

/// Whether any enabled job requests keep-awake (front-end can poll this).
pub fn has_keep_awake_jobs(state: &CronState) -> bool {
    state.list().iter().any(|j| j.enabled && j.keep_awake)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cron_list(state: tauri::State<CronState>) -> Vec<CronJob> {
    state.list()
}

#[derive(Debug, Deserialize)]
pub struct CronUpsertRequest {
    pub job: CronJob,
}

#[tauri::command]
pub fn cron_upsert(
    state: tauri::State<CronState>,
    request: CronUpsertRequest,
) -> Result<(), String> {
    validate_job(&request.job)?;
    state.upsert(request.job)
}

#[tauri::command]
pub fn cron_remove(state: tauri::State<CronState>, job_id: String) -> Result<bool, String> {
    state.remove(&job_id)
}

#[tauri::command]
pub fn cron_history(
    state: tauri::State<CronState>,
    job_id: Option<String>,
    limit: Option<u32>,
) -> Vec<CronRunRecord> {
    state.history(job_id.as_deref(), limit.unwrap_or(50).max(1) as usize)
}

#[tauri::command]
pub fn cron_clear_history(
    state: tauri::State<CronState>,
    job_id: Option<String>,
) -> Result<usize, String> {
    state.clear_history(job_id.as_deref())
}

/// Manual run (AionUi "Run Now") — records a fire immediately regardless of
/// schedule. The frontend polls for it and dispatches.
#[tauri::command]
pub fn cron_run_now(
    state: tauri::State<CronState>,
    job_id: String,
) -> Result<CronRunRecord, String> {
    if state.list().iter().all(|j| j.id != job_id) {
        return Err(format!("no such cron job: {job_id}"));
    }
    state.record_fired(&job_id)
}

/// Frontend dispatch loop: jobs fired since the last poll. The frontend then
/// posts each prompt into the bound conversation and calls
/// `cron_report_result` so history + one-time auto-disable stay accurate.
#[tauri::command]
pub fn cron_due_jobs(state: tauri::State<CronState>) -> Vec<CronJob> {
    state.due_jobs(Utc::now())
}

#[tauri::command]
pub fn cron_keep_awake_armed(state: tauri::State<CronState>) -> bool {
    has_keep_awake_jobs(&state)
}

#[derive(Debug, Deserialize)]
pub struct CronReportRequest {
    pub job_id: String,
    pub fired_at: String,
    pub ok: bool,
}

#[tauri::command]
pub fn cron_report_result(
    state: tauri::State<CronState>,
    request: CronReportRequest,
) -> Result<(), String> {
    state.record_finished(&request.job_id, &request.fired_at, request.ok)
}

/// Validate the schedule invariants: exactly one of cron/interval/one-time,
/// 5-field cron parseable, tz resolvable.
pub fn validate_job(job: &CronJob) -> Result<(), String> {
    let set_count = usize::from(job.cron_expr.is_some())
        + usize::from(job.interval_minutes.is_some())
        + usize::from(job.one_time_at.is_some());
    if set_count != 1 {
        return Err(format!(
            "job \"{}\" must set exactly one of cronExpr, intervalMinutes, oneTimeAt (got {set_count})",
            job.name
        ));
    }
    if let Some(expr) = &job.cron_expr {
        parse_cron_schedule(expr)?;
    }
    job.tz
        .parse::<Tz>()
        .map_err(|e| format!("invalid IANA timezone \"{}\": {e}", job.tz))?;
    if job.prompt.trim().is_empty() {
        return Err("prompt must not be empty".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(tag: &str) -> (PathBuf, CronState) {
        let dir = std::env::temp_dir().join(format!("manobu-cron-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let state = CronState::load(&dir).unwrap();
        (dir, state)
    }

    fn sample_job(tag: &str) -> CronJob {
        CronJob {
            id: format!("job-{tag}"),
            name: "Test job".to_string(),
            prompt: "ping".to_string(),
            agent: None,
            model: None,
            conversation_id: None,
            cron_expr: Some("0 8 * * *".to_string()),
            interval_minutes: None,
            one_time_at: None,
            tz: "Asia/Tokyo".to_string(),
            execution_mode: CronExecutionMode::Continue,
            enabled: true,
            keep_awake: false,
            queue_protection: false,
        }
    }

    #[test]
    fn upsert_and_list_round_trip_persists_to_jobs_json() {
        let (dir, state) = temp_store("roundtrip");
        state.upsert(sample_job("a")).unwrap();
        assert_eq!(state.list().len(), 1);
        // Store file exists and parses.
        let raw = std::fs::read_to_string(dir.join("cron").join("jobs.json")).unwrap();
        let parsed: CronStore = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed.jobs.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn upsert_replaces_same_id() {
        let (dir, state) = temp_store("replace");
        let mut job = sample_job("b");
        state.upsert(job.clone()).unwrap();
        job.name = "Renamed".to_string();
        state.upsert(job).unwrap();
        assert_eq!(state.list().len(), 1);
        assert_eq!(state.list()[0].name, "Renamed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_timezone_is_repaired_on_load() {
        let dir = std::env::temp_dir().join(format!("manobu-cron-tzrepair-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("cron")).unwrap();
        let job = CronJob {
            tz: "Not/AZone".to_string(),
            ..sample_job("tz")
        };
        let store = CronStore {
            jobs: vec![job],
            runs: vec![],
        };
        std::fs::write(
            dir.join("cron").join("jobs.json"),
            serde_json::to_string(&store).unwrap(),
        )
        .unwrap();
        let state = CronState::load(&dir).unwrap();
        let loaded = state.list();
        assert_eq!(loaded.len(), 1);
        // Repaired to a parseable zone (system zone or UTC fallback).
        assert!(loaded[0].tz.parse::<Tz>().is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_rejects_missing_schedule_and_bad_cron() {
        let mut job = sample_job("v1");
        job.cron_expr = None;
        job.interval_minutes = None;
        job.one_time_at = None;
        assert!(validate_job(&job).is_err());

        let mut job = sample_job("v2");
        job.cron_expr = Some("99 * * *".to_string());
        assert!(validate_job(&job).is_err());

        let mut job = sample_job("v3");
        job.tz = "Mars/Olympus".to_string();
        assert!(validate_job(&job).is_err());

        assert!(validate_job(&sample_job("v4")).is_ok());
    }

    #[test]
    fn due_jobs_respects_enabled_and_one_time_expiry() {
        let (dir, state) = temp_store("due");
        let mut job = sample_job("due1");
        job.enabled = false;
        state.upsert(job).unwrap();
        assert!(state.due_jobs(Utc::now()).is_empty());

        let mut job = sample_job("due2");
        job.cron_expr = None;
        job.one_time_at = Some((Utc::now() - chrono::Duration::hours(1)).to_rfc3339());
        state.upsert(job).unwrap();
        // Expired one-time job fires once (missed-trigger semantics).
        assert_eq!(state.due_jobs(Utc::now()).len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fire_finish_cycle_disables_one_time_jobs() {
        let (dir, state) = temp_store("onetime");
        let mut job = sample_job("ot");
        job.cron_expr = None;
        job.one_time_at = Some((Utc::now() - chrono::Duration::minutes(5)).to_rfc3339());
        state.upsert(job).unwrap();
        assert_eq!(state.due_jobs(Utc::now()).len(), 1);
        let record = state.record_fired("job-ot").unwrap();
        state
            .record_finished("job-ot", &record.fired_at, true)
            .unwrap();
        // Auto-disabled after success — no longer due.
        assert!(state.due_jobs(Utc::now()).is_empty());
        assert_eq!(state.history(Some("job-ot"), 10).len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn queue_protection_skips_while_previous_run_is_running() {
        let (dir, state) = temp_store("qprot");
        let mut job = sample_job("qp");
        job.cron_expr = None;
        // 0-minute interval = due on every poll (deterministic in tests).
        job.interval_minutes = Some(0);
        job.queue_protection = true;
        state.upsert(job).unwrap();
        assert_eq!(state.due_jobs(Utc::now()).len(), 1);
        state.record_fired("job-qp").unwrap();
        // Previous run still `running` → skipped, not re-fired (even though
        // the schedule is due).
        assert!(state.due_jobs(Utc::now()).is_empty());
        state
            .record_finished(
                "job-qp",
                &state.history(Some("job-qp"), 1)[0].fired_at,
                true,
            )
            .unwrap();
        // Protection released + schedule due again → fires.
        assert_eq!(state.due_jobs(Utc::now()).len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clear_history_removes_all_or_one() {
        let (dir, state) = temp_store("history");
        state.upsert(sample_job("h1")).unwrap();
        state.upsert(sample_job("h2")).unwrap();
        state.record_fired("job-h1").unwrap();
        state.record_fired("job-h2").unwrap();
        assert_eq!(state.clear_history(Some("job-h1")).unwrap(), 1);
        assert_eq!(state.history(None, 10).len(), 1);
        assert_eq!(state.clear_history(None).unwrap(), 1);
        assert!(state.history(None, 10).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn seed_defaults_are_present_and_disabled() {
        let (dir, state) = temp_store("seed");
        seed_default_jobs(&state).unwrap();
        let jobs = state.list();
        assert_eq!(jobs.len(), 5);
        assert!(jobs.iter().all(|j| !j.enabled));
        // Idempotent — seeding again does not duplicate.
        seed_default_jobs(&state).unwrap();
        assert_eq!(state.list().len(), 5);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_now_rejects_unknown_job() {
        let (dir, state) = temp_store("runnow");
        assert!(state.list().iter().all(|j| j.id != "ghost"));
        let err = cron_run_now_pub(&state, "ghost").unwrap_err();
        assert!(err.contains("no such cron job"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn cron_run_now_pub(state: &CronState, job_id: &str) -> Result<CronRunRecord, String> {
        if state.list().iter().all(|j| j.id != job_id) {
            return Err(format!("no such cron job: {job_id}"));
        }
        state.record_fired(job_id)
    }
}
