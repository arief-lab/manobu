//! Model lifecycle for the speech domain.
//!
//! Offline models live at `app_data_dir/speech/models/` (XDG_DATA_HOME on
//! Linux, `~/Library/Application Support` on macOS, `%APPDATA%` on Windows).
//! Each model is a directory as published at
//! `https://k2-fsa.github.io/sherpa/onnx/pretrained_models/` · VITS/STT carry
//! `model.onnx` + `tokens.txt`, Supertonic carries its own file set
//! (see `SUPERTONIC_FILES`).
//!
//! This module does not download · it resolves paths and validates presence.
//! Download is triggered via `speech_download_model` (future) or manual copy.

use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub kind: ModelKind,
    pub display_name: String,
    pub dir: String,
    pub ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModelKind {
    Tts,
    SttOffline,
    SttStreaming,
    Vad,
}

pub fn models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    Ok(data_dir.join("speech").join("models"))
}

/// Result of `speech_validate_model` · drives the Settings UUIuC banner.
#[derive(Debug, Clone, Serialize)]
pub struct ModelValidation {
    /// UUIuC: leftover archive or truncated/empty weights file.
    pub corrupt: bool,
    /// Heuristic kind: "tts" | "stt" | "vad" (null when dir is absent).
    pub kind: Option<String>,
    /// Required files that are absent (empty when ready).
    pub missing: Vec<String>,
    pub model_id: String,
    /// All required files present (may still be `corrupt`).
    pub ready: bool,
}

pub fn model_dir(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(id))
}

/// Supertonic 3 ships a different layout than VITS/Piper: four ONNX stages
/// plus `tts.json`, `unicode_indexer.bin` and `voice.bin` — no `model.onnx`
/// and no `tokens.txt`. Checked by directory name (`<id>.contains("supertonic")`).
pub(crate) const SUPERTONIC_FILES: &[&str] = &[
    "duration_predictor.int8.onnx",
    "text_encoder.int8.onnx",
    "vector_estimator.int8.onnx",
    "vocoder.int8.onnx",
    "tts.json",
    "unicode_indexer.bin",
    "voice.bin",
];

fn is_supertonic_dir(dir: &std::path::Path) -> bool {
    dir.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.contains("supertonic"))
}

/// Kind-aware readiness (TASK-21.3): which file proves the model is usable.
///
/// - VAD ships as a single `silero_vad.onnx` (~1MB) · no tokens dir.
/// - TTS proves via weights OR the `espeak-ng-data` dir (phonemizer data),
///   or the full Supertonic file set for supertonic dirs; STT needs weights
///   + `tokens.txt`.
fn model_ready(dir: &std::path::Path, kind: &ModelKind) -> bool {
    if *kind == ModelKind::Vad {
        return dir.join("silero_vad.onnx").exists();
    }
    if *kind == ModelKind::Tts && is_supertonic_dir(dir) {
        return SUPERTONIC_FILES.iter().all(|f| dir.join(f).exists());
    }
    let weights = dir.join("model.onnx").exists() || dir.join("model.int8.onnx").exists();
    if *kind == ModelKind::Tts {
        return weights || dir.join("espeak-ng-data").exists();
    }
    weights && dir.join("tokens.txt").exists()
}

#[tauri::command]
pub fn speech_list_models(app: tauri::AppHandle) -> Result<Vec<ModelInfo>, String> {
    let dir = models_dir(&app)?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let id = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
        // Heuristic kind from directory name / contents
        let kind = if id.contains("tts") || id.contains("vits") || id.contains("kokoro") {
            ModelKind::Tts
        } else if id.contains("vad") {
            ModelKind::Vad
        } else if id.contains("streaming") {
            ModelKind::SttStreaming
        } else {
            ModelKind::SttOffline
        };
        let ready = model_ready(&path, &kind);
        out.push(ModelInfo {
            display_name: id.clone(),
            dir: path.display().to_string(),
            id,
            kind,
            ready,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn speech_ensure_models_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = models_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.display().to_string())
}

/// Well-known model manifests for manobu (Japanese focus).
///
/// These are the sherpa-onnx pre-trained models that work offline and have
/// Japanese support. The frontend can call `speech_download_model` (TODO) or
/// the user can manually download via `https://k2-fsa.github.io/sherpa/onnx/pretrained_models/`.
#[derive(Debug, Clone, Serialize)]
pub struct ModelManifest {
    pub id: &'static str,
    pub kind: ModelKind,
    pub description: &'static str,
    pub url: &'static str,
}

pub const KNOWN_MODELS: &[ModelManifest] = &[
    ModelManifest {
        id: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
        kind: ModelKind::SttOffline,
        description: "SenseVoice multilingual (JA/ZH/EN/KO) · non-streaming, best for Sensei transcription",
        url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2",
    },
    ModelManifest {
        id: "sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01",
        kind: ModelKind::SttStreaming,
        description: "ReazonSpeech Zipformer JA · streaming, low-latency",
        url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01.tar.bz2",
    },
    ModelManifest {
        id: "sherpa-onnx-supertonic-3-tts-int8-2026-05-11",
        kind: ModelKind::Tts,
        description: "Supertonic 3 JA (10 voices) · TTS for Sensei voice (TASK-174, OpenRAIL-M)",
        url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2",
    },
    ModelManifest {
        id: "sherpa-onnx-silero-vad",
        kind: ModelKind::Vad,
        description: "Silero VAD · voice activity detection for turn-taking",
        url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
    },
];

#[tauri::command]
pub fn speech_known_models() -> Vec<ModelInfo> {
    KNOWN_MODELS
        .iter()
        .map(|m| ModelInfo {
            id: m.id.to_string(),
            kind: m.kind.clone(),
            display_name: m.description.to_string(),
            dir: String::new(),
            ready: false,
        })
        .collect()
}

#[tauri::command]
pub fn speech_validate_model(
    app: tauri::AppHandle,
    model_id: String,
) -> Result<ModelValidation, String> {
    let dir = model_dir(&app, &model_id)?;
    validate_model_dir(&dir, &model_id)
}

/// Check a model directory for the files its kind needs.
///
/// `ready` = the kind's required files all exist. `corrupt` marks the
/// UUIuC case: a leftover archive or zero-byte/truncated weights file ·
/// recovery is `[Re-download]` (remove + fetch again) or
/// `[Continue offline]` (STT falls back to Type, TTS to pitch diagrams).
fn validate_model_dir(dir: &std::path::Path, model_id: &str) -> Result<ModelValidation, String> {
    if !dir.exists() {
        let missing: Vec<String> = if model_id.contains("supertonic") {
            SUPERTONIC_FILES.iter().map(|f| f.to_string()).collect()
        } else {
            vec!["model.onnx".to_string(), "tokens.txt".to_string()]
        };
        return Ok(ModelValidation {
            corrupt: false,
            kind: None,
            missing,
            model_id: model_id.to_string(),
            ready: false,
        });
    }

    let entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| format!("read_dir {}: {e}", dir.display()))?
        .flatten()
        .collect();
    let names: Vec<String> = entries
        .iter()
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .collect();

    // Kind follows the same heuristic as speech_list_models.
    let kind = if model_id.contains("vad") || names.iter().any(|n| n.contains("silero")) {
        Some("vad".to_string())
    } else if model_id.contains("vits") || model_id.contains("kokoro") || model_id.contains("tts") {
        Some("tts".to_string())
    } else {
        Some("stt".to_string())
    };

    let is_tts = kind.as_deref() == Some("tts");
    let is_vad = kind.as_deref() == Some("vad");
    let supertonic = is_tts && is_supertonic_dir(dir);
    // VAD ships as a single `silero_vad.onnx` · no tokens/phonemizer data.
    // Supertonic weights are the four stage ONNX + two binaries (tts.json is
    // a small config file, so it never feeds the tiny-file corrupt check).
    let weights: Vec<&str> = if is_vad {
        vec!["silero_vad.onnx", "model.onnx", "model.int8.onnx"]
    } else if supertonic {
        vec![
            "duration_predictor.int8.onnx",
            "text_encoder.int8.onnx",
            "vector_estimator.int8.onnx",
            "vocoder.int8.onnx",
            "unicode_indexer.bin",
            "voice.bin",
        ]
    } else if is_tts {
        vec!["model.onnx", "model.int8.onnx"]
    } else {
        vec!["model.onnx", "model.int8.onnx", "encoder.onnx"]
    };
    let weights_present = weights.iter().any(|w| dir.join(w).exists());

    let mut missing: Vec<String> = Vec::new();
    if supertonic {
        for f in SUPERTONIC_FILES {
            if !dir.join(f).exists() {
                missing.push((*f).to_string());
            }
        }
    } else {
        if !weights_present {
            missing.push(weights[0].to_string());
        }
        if !is_vad {
            let tokens_ok = if is_tts {
                dir.join("tokens.txt").exists() || dir.join("espeak-ng-data").exists()
            } else {
                dir.join("tokens.txt").exists()
            };
            if !tokens_ok {
                missing.push("tokens.txt".to_string());
            }
        }
    }

    // Corrupt signals: leftover archive, or a weights file that is empty
    // or suspiciously tiny (<1KB · real SenseVoice/Piper models are MB+).
    let leftover_archive = names
        .iter()
        .any(|n| n.ends_with(".tar.bz2") || n.ends_with(".part"));
    let mut corrupt = leftover_archive;
    if !corrupt && weights_present {
        for w in weights {
            let path = dir.join(w);
            if path.exists() {
                let size = path.metadata().map(|m| m.len()).unwrap_or(0);
                if size < 1024 {
                    corrupt = true;
                    break;
                }
            }
        }
    }

    let ready = missing.is_empty();
    Ok(ModelValidation {
        corrupt,
        kind,
        missing,
        model_id: model_id.to_string(),
        ready,
    })
}

/// Remove a model directory (UUIuC recovery step 1) so the next
/// `speech_ensure_model` performs a clean re-download instead of skipping.
#[tauri::command]
pub fn speech_remove_model(app: tauri::AppHandle, model_id: String) -> Result<bool, String> {
    // Guard: only ever remove inside the models dir, never a bare id path.
    if model_id.contains('/') || model_id.contains("\\") || model_id.contains("..") {
        return Err(format!("invalid model_id: {model_id}"));
    }
    let dir = model_dir(&app, &model_id)?;
    if !dir.exists() {
        return Ok(false);
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("remove {}: {e}", dir.display()))?;
    log::info!("[speech.models] removed model dir {}", dir.display());
    Ok(true)
}

/// User spec for auto-download · fits the model to the user's **PC spec**.
///
/// The frontend passes `device_tier` or we auto-detect via `sysinfo`:
/// RAM, CPU cores, OS. Low-end PCs (<8GB RAM or 2 cores) get int8/small
/// models; high-end (>=16GB, 8+ cores) get full quality. This is the
/// "fit to PC spec" entry point · no manual model picking.
#[derive(Debug, Clone, Deserialize)]
pub struct SpeechAutoSpec {
    /// Task: "tts", "stt", "vad", or "auto"
    pub task: Option<String>,
    /// Language: "ja", "zh", "en", "auto" · for manobu this is usually "ja"
    pub language: Option<String>,
    /// Streaming preferred? true = low-latency (Zipformer), false = best quality
    pub streaming: Option<bool>,
    /// Device tier: "low" = int8/small, "high" = full, "auto" = detect from PC
    pub device_tier: Option<String>,
    /// Optional explicit PC info from frontend (navigator.hardwareConcurrency etc.)
    pub pc_ram_gb: Option<u64>,
    pub pc_cores: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PcTier {
    Low,    // <8GB RAM or 2 cores · use int8 / small
    Medium, // 8-16GB, 4 cores · balanced
    High,   // >=16GB, 8+ cores · full quality
}

fn detect_pc_tier(spec: &SpeechAutoSpec) -> PcTier {
    // If frontend explicitly says low/high, respect it
    if let Some(tier) = spec.device_tier.as_deref() {
        match tier {
            "low" => return PcTier::Low,
            "high" => return PcTier::High,
            _ => {}
        }
    }
    // If frontend passed explicit RAM/cores, use those (from navigator.deviceMemory/hardwareConcurrency)
    if let (Some(ram), Some(cores)) = (spec.pc_ram_gb, spec.pc_cores) {
        return tier_from_ram_cores(ram, cores);
    }
    // Auto-detect via sysinfo
    let mut sys = sysinfo::System::new_all();
    sys.refresh_memory();
    sys.refresh_cpu_all();
    let ram_gb = sys.total_memory() / 1024 / 1024 / 1024;
    let cores = sys.cpus().len();
    log::info!(
        "[speech.models] PC spec: {}GB RAM, {} cores → tier detection",
        ram_gb,
        cores
    );
    tier_from_ram_cores(ram_gb, cores)
}

fn tier_from_ram_cores(ram_gb: u64, cores: usize) -> PcTier {
    if ram_gb < 8 || cores <= 2 {
        PcTier::Low
    } else if ram_gb >= 16 && cores >= 8 {
        PcTier::High
    } else {
        PcTier::Medium
    }
}

fn resolve_for_spec(spec: &SpeechAutoSpec) -> &'static ModelManifest {
    let task = spec.task.as_deref().unwrap_or("auto");
    let lang = spec.language.as_deref().unwrap_or("ja");
    let streaming = spec.streaming.unwrap_or(false);
    let tier = detect_pc_tier(spec);

    log::info!(
        "[speech.models] resolve task={task} lang={lang} streaming={streaming} tier={tier:?}"
    );

    match (task, lang, tier) {
        ("vad", _, _) => &KNOWN_MODELS[3],
        ("tts", _, PcTier::Low) => {
            // Supertonic 3 int8 is the only JA TTS manifest and is already the
            // quantized build · same voice for all tiers (TASK-174).
            &KNOWN_MODELS[2]
        }
        ("tts", _, _) => &KNOWN_MODELS[2],
        ("stt", _, PcTier::Low) if streaming => {
            // Low-end streaming: use smallest Zipformer (already small)
            &KNOWN_MODELS[1]
        }
        ("stt", _, _) | ("auto", _, _) if streaming => &KNOWN_MODELS[1],
        (_, _, PcTier::Low) => {
            // Low-end offline: prefer smaller Paraformer or int8 if we had it
            // SenseVoice is ~400MB · on low-end we could use paraformer-small (~80MB)
            // For now keep SenseVoice but log that int8 would be better
            log::info!("[speech.models] low-end PC: would prefer int8/small model if available");
            &KNOWN_MODELS[0]
        }
        _ => &KNOWN_MODELS[0],
    }
}

#[tauri::command]
pub async fn speech_ensure_model(
    app: tauri::AppHandle,
    model_id: String,
) -> Result<String, String> {
    let manifest = KNOWN_MODELS
        .iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| format!("unknown model_id: {model_id}"))?;
    let dir = model_dir(&app, &manifest.id)?;
    if model_ready(&dir, &manifest.kind) {
        return Ok(dir.display().to_string());
    }
    download_and_extract(&app, manifest).await
}

#[tauri::command]
pub async fn speech_auto_download(
    app: tauri::AppHandle,
    spec: SpeechAutoSpec,
) -> Result<ModelInfo, String> {
    let manifest = resolve_for_spec(&spec);
    let dir = model_dir(&app, manifest.id)?;
    let ready = model_ready(&dir, &manifest.kind);
    if !ready {
        download_and_extract(&app, manifest).await?;
    }
    Ok(ModelInfo {
        id: manifest.id.to_string(),
        kind: manifest.kind.clone(),
        display_name: manifest.description.to_string(),
        dir: dir.display().to_string(),
        ready: true,
    })
}

async fn download_and_extract(
    app: &tauri::AppHandle,
    manifest: &ModelManifest,
) -> Result<String, String> {
    let dir = model_dir(app, manifest.id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // If it's a single .onnx (VAD), just download the file
    if manifest.url.ends_with(".onnx") {
        let dest = dir.join("silero_vad.onnx");
        if dest.exists() {
            return Ok(dir.display().to_string());
        }
        log::info!(
            "[speech.models] downloading {} -> {}",
            manifest.url,
            dest.display()
        );
        download_file(&manifest.url, &dest).await?;
        return Ok(dir.display().to_string());
    }

    // For tar.bz2, download to temp, extract
    let tmp = dir.join(format!("{}.tar.bz2", manifest.id));
    log::info!(
        "[speech.models] downloading {} -> {}",
        manifest.url,
        tmp.display()
    );
    download_file(&manifest.url, &tmp).await?;

    log::info!(
        "[speech.models] extracting {} -> {}",
        tmp.display(),
        dir.display()
    );
    extract_tar_bz2(&tmp, &dir).map_err(|e| e.to_string())?;

    // Remove the archive BEFORE flattening: it lives inside `dir`, so while
    // it is there the dir holds two entries (archive + tar's top-level dir)
    // and `flatten_single_subdir`'s single-entry test silently no-ops,
    // leaving the weights nested one level too deep (TASK-154 live check).
    let _ = std::fs::remove_file(&tmp);
    flatten_single_subdir(&dir).map_err(|e| format!("flatten {}: {e}", dir.display()))?;

    Ok(dir.display().to_string())
}

// ---------------------------------------------------------------------------
// Download progress (TASK-21.4 AC1) · byte-counted ureq copy loop feeding a
// per-model state that `speech_download_progress` reports to the frontend.

/// Byte progress for the active download(s), keyed by model id.
/// `total` is 0 while Content-Length is absent/unknown.
static DOWNLOAD_PROGRESS: std::sync::LazyLock<Mutex<Vec<DownloadProgress>>> =
    std::sync::LazyLock::new(|| Mutex::new(Vec::new()));

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    /// Bytes copied so far.
    pub downloaded: u64,
    /// Active while the ureq reader is being consumed.
    pub done: bool,
    pub model_id: String,
    /// Total bytes from Content-Length (0 = unknown).
    pub total: u64,
}

fn set_progress(entry: DownloadProgress) {
    let mut guard = DOWNLOAD_PROGRESS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match guard.iter_mut().find(|p| p.model_id == entry.model_id) {
        Some(slot) => *slot = entry,
        None => guard.push(entry),
    }
}

/// Total bytes of every successful model download (for tests).
static BYTES_COPIED: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub fn speech_download_progress() -> Vec<DownloadProgress> {
    DOWNLOAD_PROGRESS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

async fn download_file(url: &str, dest: &std::path::Path) -> Result<(), String> {
    let url = url.to_string();
    let dest = dest.to_path_buf();
    let model_id = dest
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("model")
        .trim_end_matches(".tar")
        .to_string();
    tokio::task::spawn_blocking(move || {
        let resp = ureq::get(&url).call().map_err(|e| e.to_string())?;
        if resp.status() != 200 {
            return Err(format!("download failed {}: {}", url, resp.status()));
        }
        let total = resp
            .header("Content-Length")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        set_progress(DownloadProgress {
            downloaded: 0,
            done: false,
            model_id: model_id.clone(),
            total,
        });
        let mut reader = resp.into_reader();
        let mut file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        let mut buffer = [0u8; 64 * 1024];
        let mut copied: u64 = 0;
        loop {
            let n = reader
                .read(&mut buffer)
                .map_err(|e| format!("download read: {e}"))?;
            if n == 0 {
                break;
            }
            std::io::Write::write_all(&mut file, &buffer[..n])
                .map_err(|e| format!("download write: {e}"))?;
            copied += n as u64;
            BYTES_COPIED.fetch_add(n as u64, Ordering::Relaxed);
            set_progress(DownloadProgress {
                downloaded: copied,
                done: false,
                model_id: model_id.clone(),
                total,
            });
        }
        set_progress(DownloadProgress {
            downloaded: copied,
            done: true,
            model_id,
            total,
        });
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn extract_tar_bz2(archive: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let dec = bzip2::read::BzDecoder::new(file);
    let mut tar = tar::Archive::new(dec);
    tar.unpack(dest).map_err(|e| e.to_string())?;
    Ok(())
}

fn flatten_single_subdir(dir: &std::path::Path) -> Result<(), String> {
    let entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    if entries.len() == 1 && entries[0].path().is_dir() {
        let inner = entries[0].path();
        for entry in std::fs::read_dir(&inner)
            .map_err(|e| e.to_string())?
            .flatten()
        {
            let dest = dir.join(entry.file_name());
            std::fs::rename(entry.path(), dest).map_err(|e| e.to_string())?;
        }
        let _ = std::fs::remove_dir(inner);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- PC-spec tier boundaries (AC2) ------------------------------------

    #[test]
    fn tier_low_below_8gb_or_2cores() {
        assert_eq!(tier_from_ram_cores(7, 8), PcTier::Low);
        assert_eq!(tier_from_ram_cores(4, 4), PcTier::Low);
        assert_eq!(tier_from_ram_cores(32, 2), PcTier::Low);
        assert_eq!(tier_from_ram_cores(4, 2), PcTier::Low);
    }

    #[test]
    fn tier_high_only_16gb_and_8cores() {
        assert_eq!(tier_from_ram_cores(16, 8), PcTier::High);
        assert_eq!(tier_from_ram_cores(32, 16), PcTier::High);
        // RAM alone or cores alone is not enough
        assert_eq!(tier_from_ram_cores(16, 4), PcTier::Medium);
        assert_eq!(tier_from_ram_cores(12, 8), PcTier::Medium);
    }

    #[test]
    fn tier_medium_in_between() {
        assert_eq!(tier_from_ram_cores(8, 4), PcTier::Medium);
        assert_eq!(tier_from_ram_cores(8, 8), PcTier::Medium);
    }

    #[test]
    fn explicit_device_tier_overrides_ram_cores() {
        let spec = SpeechAutoSpec {
            task: Some("stt".into()),
            language: Some("ja".into()),
            streaming: None,
            device_tier: Some("high".into()),
            pc_ram_gb: Some(4),
            pc_cores: Some(2),
        };
        assert_eq!(detect_pc_tier(&spec), PcTier::High);
        let spec_low = SpeechAutoSpec {
            device_tier: Some("low".into()),
            ..spec
        };
        assert_eq!(detect_pc_tier(&spec_low), PcTier::Low);
    }

    #[test]
    fn explicit_ram_cores_override_sysinfo() {
        // Frontend (navigator.deviceMemory/hardwareConcurrency) wins over
        // whatever sysinfo would detect · no assertion on sys values here.
        let spec = SpeechAutoSpec {
            task: Some("stt".into()),
            language: Some("ja".into()),
            streaming: None,
            device_tier: None,
            pc_ram_gb: Some(2),
            pc_cores: Some(1),
        };
        assert_eq!(detect_pc_tier(&spec), PcTier::Low);
        let spec_high = SpeechAutoSpec {
            pc_ram_gb: Some(32),
            pc_cores: Some(16),
            ..spec
        };
        assert_eq!(detect_pc_tier(&spec_high), PcTier::High);
    }

    #[test]
    fn resolve_stt_low_tier_prefers_streaming_when_asked() {
        let spec = SpeechAutoSpec {
            task: Some("stt".into()),
            language: Some("ja".into()),
            streaming: Some(true),
            device_tier: Some("low".into()),
            pc_ram_gb: None,
            pc_cores: None,
        };
        assert_eq!(resolve_for_spec(&spec).id, KNOWN_MODELS[1].id);
    }

    #[test]
    fn resolve_stt_defaults_to_sense_voice() {
        let spec = SpeechAutoSpec {
            task: Some("stt".into()),
            language: Some("ja".into()),
            streaming: Some(false),
            device_tier: Some("high".into()),
            pc_ram_gb: None,
            pc_cores: None,
        };
        assert_eq!(resolve_for_spec(&spec).id, KNOWN_MODELS[0].id);
    }

    // ---- validate_model_dir (UUIuC) ---------------------------------------

    fn write_file(path: &std::path::Path, len: usize) {
        std::fs::write(path, vec![0u8; len]).unwrap();
    }

    #[test]
    fn validate_missing_dir_reports_not_ready_not_corrupt() {
        let tmp = std::env::temp_dir().join("manobu-test-missing-model");
        let _ = std::fs::remove_dir_all(&tmp);
        let v = validate_model_dir(&tmp, "some-model").unwrap();
        assert!(!v.ready);
        assert!(!v.corrupt);
        // kind is only inferred when the dir exists (documented on ModelValidation)
        assert_eq!(v.kind, None);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn validate_ready_model_with_weights_and_tokens() {
        let tmp = std::env::temp_dir().join("manobu-test-ready-model");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        write_file(&tmp.join("model.onnx"), 2048);
        write_file(&tmp.join("tokens.txt"), 64);
        let v = validate_model_dir(&tmp, "sherpa-onnx-sense-voice").unwrap();
        assert!(v.ready);
        assert!(!v.corrupt);
        assert!(v.missing.is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn validate_leftover_archive_flags_corrupt() {
        let tmp = std::env::temp_dir().join("manobu-test-leftover-archive");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        write_file(&tmp.join("model.onnx"), 2048);
        write_file(&tmp.join("tokens.txt"), 64);
        write_file(&tmp.join("model.tar.bz2.part"), 10);
        let v = validate_model_dir(&tmp, "sherpa-onnx-sense-voice").unwrap();
        assert!(v.corrupt, "leftover .part archive must flag corrupt");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn validate_truncated_weights_flags_corrupt() {
        let tmp = std::env::temp_dir().join("manobu-test-truncated-weights");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        write_file(&tmp.join("model.onnx"), 10); // 10 bytes · truncated
        write_file(&tmp.join("tokens.txt"), 64);
        let v = validate_model_dir(&tmp, "sherpa-onnx-sense-voice").unwrap();
        assert!(v.corrupt, "sub-1KB weights must flag corrupt");
        assert!(
            v.ready,
            "files exist so ready stays true · UUIuC recovery needs the corrupt flag"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn validate_tts_accepts_espeak_ng_data_instead_of_tokens() {
        let tmp = std::env::temp_dir().join("manobu-test-tts-espeak");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp.join("espeak-ng-data")).unwrap();
        write_file(&tmp.join("model.onnx"), 2048);
        let v = validate_model_dir(&tmp, "vits-piper-ja_JP-kokoro").unwrap();
        assert_eq!(v.kind.as_deref(), Some("tts"));
        assert!(v.ready);
        assert!(!v.corrupt);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ---- Supertonic layout (TASK-154) -------------------------------------

    const SUPERTONIC_ID: &str = "sherpa-onnx-supertonic-3-tts-int8-2026-05-11";

    fn make_supertonic_dir(name: &str) -> std::path::PathBuf {
        let tmp = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&tmp);
        // The readiness check keys on the directory name, so the temp dir
        // must carry the model id, like the real models_dir layout.
        let dir = tmp.join(SUPERTONIC_ID);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn model_ready_supertonic_requires_full_file_set() {
        let dir = make_supertonic_dir("manobu-test-supertonic-ready");
        assert!(!model_ready(&dir, &ModelKind::Tts));
        for f in SUPERTONIC_FILES {
            write_file(&dir.join(f), 2048);
            // Partial downloads stay not-ready until the last file lands.
            if *f != SUPERTONIC_FILES[SUPERTONIC_FILES.len() - 1] {
                assert!(!model_ready(&dir, &ModelKind::Tts));
            }
        }
        assert!(model_ready(&dir, &ModelKind::Tts));
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn validate_supertonic_dir_reports_ready_without_model_onnx() {
        let dir = make_supertonic_dir("manobu-test-supertonic-validate");
        for f in SUPERTONIC_FILES {
            write_file(&dir.join(f), 2048);
        }
        let v = validate_model_dir(&dir, SUPERTONIC_ID).unwrap();
        assert_eq!(v.kind.as_deref(), Some("tts"));
        assert!(v.ready);
        assert!(!v.corrupt);
        assert!(v.missing.is_empty());
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn validate_supertonic_missing_dir_lists_supertonic_files() {
        let tmp = std::env::temp_dir().join("manobu-test-supertonic-absent");
        let _ = std::fs::remove_dir_all(&tmp);
        let v = validate_model_dir(&tmp.join(SUPERTONIC_ID), SUPERTONIC_ID).unwrap();
        assert!(!v.ready);
        assert_eq!(v.missing.len(), SUPERTONIC_FILES.len());
        assert!(v.missing.iter().any(|m| m == "voice.bin"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn validate_supertonic_truncated_stage_flags_corrupt() {
        let dir = make_supertonic_dir("manobu-test-supertonic-truncated");
        for f in SUPERTONIC_FILES {
            write_file(&dir.join(f), 2048);
        }
        write_file(&dir.join("vocoder.int8.onnx"), 10); // truncated stage
        let v = validate_model_dir(&dir, SUPERTONIC_ID).unwrap();
        assert!(v.corrupt, "sub-1KB supertonic stage must flag corrupt");
        assert!(v.ready, "files exist so recovery keys off corrupt");
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    // ---- download progress plumbing (AC1) ---------------------------------

    // ---- flatten after extraction (TASK-154 live check) --------------------

    #[test]
    fn flatten_hoists_a_single_nested_dir() {
        // The outer dir name carries "supertonic" because readiness keys on
        // it, like the real models_dir layout.
        let tmp = std::env::temp_dir().join("manobu-test-supertonic-flatten");
        let _ = std::fs::remove_dir_all(&tmp);
        let inner = tmp.join(SUPERTONIC_ID);
        std::fs::create_dir_all(&inner).unwrap();
        for f in SUPERTONIC_FILES {
            write_file(&inner.join(f), 2048);
        }
        flatten_single_subdir(&tmp).unwrap();
        assert!(
            model_ready(&tmp, &ModelKind::Tts),
            "files land at the model dir root"
        );
        assert!(!inner.exists(), "the nested copy is removed");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn flatten_noops_when_the_archive_is_still_in_the_dir() {
        // Guards the exact ordering bug: a leftover tarball made the
        // single-entry test fail and the nested layout shipped to users.
        let tmp = std::env::temp_dir().join("manobu-test-supertonic-flatten-archive");
        let _ = std::fs::remove_dir_all(&tmp);
        let inner = tmp.join(SUPERTONIC_ID);
        std::fs::create_dir_all(&inner).unwrap();
        write_file(&inner.join("voice.bin"), 2048);
        write_file(&tmp.join(format!("{SUPERTONIC_ID}.tar.bz2")), 2048);
        flatten_single_subdir(&tmp).unwrap();
        assert!(!model_ready(&tmp, &ModelKind::Tts));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ---- VAD kind-aware readiness (TASK-21.3) -----------------------------

    #[test]
    fn model_ready_vad_requires_silero_onnx_only() {
        let tmp = std::env::temp_dir().join("manobu-test-vad-ready");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        assert!(!model_ready(&tmp, &ModelKind::Vad));
        write_file(&tmp.join("silero_vad.onnx"), 1024 * 1024);
        assert!(model_ready(&tmp, &ModelKind::Vad));
        // tokens.txt must NOT be required for VAD.
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn model_ready_stt_requires_weights_and_tokens() {
        let tmp = std::env::temp_dir().join("manobu-test-stt-ready");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        write_file(&tmp.join("model.onnx"), 2048);
        assert!(!model_ready(&tmp, &ModelKind::SttOffline));
        write_file(&tmp.join("tokens.txt"), 256);
        assert!(model_ready(&tmp, &ModelKind::SttOffline));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn validate_vad_dir_reports_ready_with_silero_weights() {
        let tmp = std::env::temp_dir().join("manobu-test-vad-validate");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        write_file(&tmp.join("silero_vad.onnx"), 1024 * 1024);
        let v = validate_model_dir(&tmp, "sherpa-onnx-silero-vad").unwrap();
        assert_eq!(v.kind.as_deref(), Some("vad"));
        assert!(v.ready);
        assert!(!v.corrupt);
        assert!(v.missing.is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn set_progress_upserts_by_model_id() {
        set_progress(DownloadProgress {
            downloaded: 10,
            done: false,
            model_id: "test-progress-model".into(),
            total: 100,
        });
        set_progress(DownloadProgress {
            downloaded: 50,
            done: false,
            model_id: "test-progress-model".into(),
            total: 100,
        });
        let all = DOWNLOAD_PROGRESS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let entries: Vec<_> = all
            .iter()
            .filter(|p| p.model_id == "test-progress-model")
            .collect();
        assert_eq!(entries.len(), 1, "upsert, not append");
        assert_eq!(entries[0].downloaded, 50);
        assert_eq!(entries[0].total, 100);
        assert!(!entries[0].done);
        // cleanup so other tests / the live command don't see this entry
        DOWNLOAD_PROGRESS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .retain(|p| p.model_id != "test-progress-model");
    }

    #[test]
    fn download_file_counts_bytes_and_finishes_done() {
        // Tiny local HTTP server so ureq exercises the real counting loop.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let payload = vec![7u8; 64 * 1024 + 123]; // > one 64KiB buffer
        let payload_len = payload.len() as u64;
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut stream = stream;
            let mut buf = [0u8; 1024];
            let _ = std::io::Read::read(&mut stream, &mut buf);
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                payload.len()
            );
            use std::io::Write;
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(&payload);
        });

        let dest = std::env::temp_dir().join("manobu-test-progress-model.tar.bz2");
        let _ = std::fs::remove_file(&dest);
        // Run the async download on a scratch runtime.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(download_file(
            &format!("http://127.0.0.1:{port}/file.tar.bz2"),
            &dest,
        ))
        .unwrap();
        server.join().unwrap();

        // File fully written.
        assert_eq!(std::fs::metadata(&dest).unwrap().len(), payload_len);

        // Progress entry: done, byte-accurate, Content-Length total.
        let all = DOWNLOAD_PROGRESS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let entry = all
            .iter()
            .find(|p| p.model_id == "manobu-test-progress-model")
            .expect("progress entry for the downloaded model");
        assert!(entry.done);
        assert_eq!(entry.downloaded, payload_len);
        assert_eq!(entry.total, payload_len);

        // The global counter observed every byte.
        assert!(BYTES_COPIED.load(Ordering::Relaxed) >= payload_len);

        // The command shape returns the same entries.
        let via_cmd = speech_download_progress();
        assert!(via_cmd
            .iter()
            .any(|p| p.model_id == "manobu-test-progress-model" && p.done));

        let _ = std::fs::remove_file(&dest);
        DOWNLOAD_PROGRESS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .retain(|p| p.model_id != "manobu-test-progress-model");
    }
}
