use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

mod cron;
mod fsrs;
mod mcp;
mod speech;

/// Port the sidecar server (`apps/server` bun-compiled binary) listens on.
/// Picked low-and-uncommon to avoid colliding with anything on the user's box.
///
/// Inside an AppImage this is the ONLY HTTP server our WebView talks to.
/// Dev mode pins the same port via `BUN_PORT=4317` so behavior is identical
/// to a real AppImage — no second bind on :3000 to debug.
const SIDECAR_PORT: u16 = 4317;

/// How long we wait for the sidecar to bind its port before giving up.
/// 30s, not the sub-second bun launch implies: `apps/server` applies its DB
/// migrations before it starts listening, so a cold start measured 15s from
/// spawn to `[ai] listening`. OpenCode still spawns lazily on first /ai
/// request, so this only bounds the bind, not agent startup.
const READINESS_TIMEOUT: Duration = Duration::from_secs(30);

/// Shell → webview announcement that the sidecar answered its health probe.
/// Mirrors `SIDECAR_READY_EVENT` in `src/lib/sidecar-ready.ts`; the frontend
/// re-runs its status probe on it because the window mounts long before this
/// fires and the probe does not retry on its own.
const SIDECAR_READY_EVENT: &str = "sidecar:ready";

/// How long the sidecar gets to shut down gracefully (SIGTERM → its own
/// teardown reaps agent child groups) before we escalate to SIGKILL.
/// TASK-153: disposeAll needs a couple of group kills plus registry rewrites;
/// 2s bounds the window-close latency while staying well under a user's
/// patience. Unix-only because the Windows arm cannot wait for anything.
#[cfg(unix)]
const SIDECAR_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);

/// Single instance of the sidecar command child, so we can `kill()` it on
/// app exit. `tokio::sync::Mutex` would be cleaner but we want zero async
/// runtime cost here — std Mutex around Option<CommandChild> is plenty.
static SIDECAR_CHILD: Mutex<Option<CommandChild>> = Mutex::new(None);

/// Path of the bundled `jlpt-mcp` sidecar beside the app exe, or `None` when
/// it is not there (dev layout, unknown target triple).
///
/// TASK-177: the bundled name carries the target triple and the platform exe
/// suffix, exactly as `scripts/sidecar-stage.sh` and Tauri's `externalBin`
/// rule produce them (`jlpt-mcp-x86_64-unknown-linux-gnu`,
/// `jlpt-mcp-x86_64-pc-windows-msvc.exe`). A bare `jlpt-mcp` never exists
/// beside the app, so the fallback silently yielded nothing and every
/// packaged run shipped without the vocab MCP server. `target_triple()` is
/// compile-derived, so it matches the staged file on each build target.
fn bundled_jlpt_mcp_path(app_exe: Option<&std::path::Path>) -> Option<PathBuf> {
    let dir = app_exe?.parent()?;
    let path = dir.join(format!("jlpt-mcp{}", std::env::consts::EXE_SUFFIX));
    path.exists().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::bundled_jlpt_mcp_path;

    /// Bundles install the sidecar beside the app exe under its plain name plus
    /// the platform exe suffix: `/usr/bin/{app,jlpt-mcp}` in the deb,
    /// `$INSTDIR\{app.exe,jlpt-mcp.exe}` in the NSIS script. The triple only
    /// exists in the staging directory (`dist/jlpt-mcp-<triple>[.exe]`), which
    /// the bundler renames away, so looking for the triple-named file next to
    /// the exe would silently ship vocab-less on Windows.
    #[test]
    fn bundled_jlpt_mcp_path_finds_the_sidecar_beside_the_exe() {
        let root = std::env::temp_dir().join(format!("manobu-mcp-fallback-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("temp dir");
        let exe = root.join(if cfg!(windows) { "app.exe" } else { "app" });
        let staged = root.join(format!("jlpt-mcp{}", std::env::consts::EXE_SUFFIX));
        let _ = std::fs::remove_file(&staged);

        assert_eq!(
            bundled_jlpt_mcp_path(Some(&exe)),
            None,
            "no sidecar staged yet"
        );

        std::fs::write(&staged, b"staged").expect("write staged name");
        assert_eq!(bundled_jlpt_mcp_path(Some(&exe)), Some(staged.clone()));

        // A missing exe path is not a crash: the caller passes
        // `current_exe().ok()`, which is `None` in exotic contexts.
        assert_eq!(bundled_jlpt_mcp_path(None), None);

        let _ = std::fs::remove_file(&staged);
        let _ = std::fs::remove_dir(&root);
    }
}

/// TASK-153 AC#1/#2: on graceful exit, SIGTERM the sidecar and give it
/// SIDECAR_SHUTDOWN_TIMEOUT to run its own teardown (the handler in
/// `apps/server` disposes every ACP session and reaps the agent process
/// groups via ChildRegistry). The old bare `kill()` was a SIGKILL:
/// `disposeAll` never ran, so opencode and its jlpt-mcp grandchildren
/// survived the app. Escalate to `kill()` only if the process is still alive
/// after the grace window — a hung sidecar must not block exit indefinitely.
#[cfg(unix)]
fn shutdown_sidecar(child: CommandChild) {
    let pid = child.pid();
    log::info!(
        "[sidecar] SIGTERM to pid {pid}, waiting up to {SIDECAR_SHUTDOWN_TIMEOUT:?} for graceful shutdown"
    );
    // SAFETY: kill(2) with our own spawned child's pid; a failed signal
    // (ESRCH) is benign and detected by the /proc poll below.
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }
    let proc_dir = format!("/proc/{pid}");
    let deadline = Instant::now() + SIDECAR_SHUTDOWN_TIMEOUT;
    while Instant::now() < deadline && std::path::Path::new(&proc_dir).exists() {
        thread::sleep(Duration::from_millis(50));
    }
    if std::path::Path::new(&proc_dir).exists() {
        log::warn!("[sidecar] still alive — escalating to kill()");
        let _ = child.kill();
    } else {
        log::info!("[sidecar] exited gracefully");
    }
}

/// Windows has no parent-side SIGTERM: `kill(2)` does not exist and
/// `CommandChild::kill()` is `TerminateProcess`, i.e. the same unclean
/// SIGKILL TASK-153 removed. Sending it here would skip the sidecar's
/// teardown and orphan every agent child, so the graceful path is the
/// sidecar's own parent watchdog (`apps/server/src/parent-watchdog.ts`):
/// this process always passes `MANOBU_PARENT_PID`, and once it vanishes the
/// watchdog polls signal-0 within 2 s and runs exactly the teardown SIGTERM
/// would have. The cost versus Unix is that we cannot wait for it, so the
/// sidecar outlives the window by up to one poll interval, and a wedged
/// sidecar cannot be force-killed from here (Job Objects, deferred).
#[cfg(windows)]
fn shutdown_sidecar(child: CommandChild) {
    log::info!(
        "[sidecar] pid {} left to its parent watchdog: no SIGTERM on Windows, teardown completes within 2s of this process exiting",
        child.pid()
    );
}

/// Poll `http://127.0.0.1:port/` until it returns HTTP 200 or we hit the
/// timeout. Returns true on success.
///
/// We poll HTTP health rather than raw TCP so we know the Hono app has
/// finished booting and is serving `GET /` ("OK"), not just that the port
/// is bound. The sidecar does `bun run src/index.ts` and only binds once
/// module-level imports resolve (Hono, @manobu/acp, etc.).
fn wait_for_http(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let url = format!("http://127.0.0.1:{port}/");
    while Instant::now() < deadline {
        if let Ok(resp) = ureq::get(&url).call() {
            if resp.status() == 200 {
                log::info!("[sidecar] health check {url} is responsive");
                return true;
            }
        }
        thread::sleep(Duration::from_millis(200));
    }
    log::warn!("[sidecar] health check {url} failed within {timeout:?}");
    // TASK-48: name the port-holder so the next move is obvious — orphaned
    // sidecar squatting the port vs sidecar dead before binding.
    if let Ok(out) = std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("ss -tlnp 2>/dev/null | grep ':{port} ' || true"))
        .output()
    {
        let hint = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if hint.is_empty() {
            log::warn!("[sidecar] nothing is listening on :{port} — sidecar died before binding");
        } else {
            log::warn!("[sidecar] :{port} held by: {hint}");
        }
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(speech::SpeechState::default())
        .plugin(tauri_plugin_shell::init())
        // Cron scheduler is registered in setup (needs app_data_dir) — see
        // the `.setup` hook below; commands are declared with a placeholder
        // state there via `.manage`.
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Info
                } else {
                    log::LevelFilter::Warn
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            speech::speech_version,
            speech::speech_status,
            speech::models::speech_list_models,
            speech::models::speech_ensure_models_dir,
            speech::models::speech_known_models,
            speech::models::speech_ensure_model,
            speech::models::speech_auto_download,
            speech::models::speech_validate_model,
            speech::models::speech_remove_model,
            speech::models::speech_download_progress,
            speech::tts::speech_init_tts,
            speech::tts::speech_tts,
            speech::tts::speech_tts_is_ready,
            speech::stt::speech_init_stt,
            speech::stt::speech_stt_file,
            speech::stt::speech_stt_is_ready,
            speech::stt::speech_write_temp_wav,
            speech::stt::speech_init_stt_stream,
            speech::stt::speech_stt_stream_is_ready,
            speech::stt::speech_stt_stream_create,
            speech::stt::speech_stt_stream_accept,
            speech::stt::speech_stt_stream_finish,
            speech::stt::speech_stt_stream_close,
            speech::vad::speech_init_vad,
            cron::cron_list,
            cron::cron_upsert,
            cron::cron_remove,
            cron::cron_history,
            cron::cron_clear_history,
            cron::cron_run_now,
            cron::cron_due_jobs,
            cron::cron_keep_awake_armed,
            cron::cron_report_result,
            mcp::mcp_catalog_list,
            mcp::mcp_catalog_upsert,
            mcp::mcp_catalog_remove,
            speech::vad::speech_vad_detect,
            fsrs::fsrs_default_parameters,
            fsrs::fsrs_preview,
            fsrs::fsrs_next_states,
            fsrs::fsrs_optimize,
            fsrs::fsrs_snooze,
            fsrs::fsrs_vacation,
            fsrs::fsrs_should_leech,
            fsrs::fsrs_compute_optimal,
            fsrs::fsrs_reschedule,
        ])
        .setup(|app| {
            // Resolve a persistent SQLite path for the sidecar so a fresh
            // installed `.deb` doesn't crash with `DATABASE_URL missing`.
            // Tauri's `app_data_dir()` honors the OS's per-user app-data
            // convention (XDG_DATA_HOME on Linux) and creates the directory.
            //
            // SQLite filename: `file:<dir>/manobu.db` (libsql-style URI
            // accepted by @t3-oss/env-core + drizzle).
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("[sidecar] app_data_dir: {e}"))?;
            std::fs::create_dir_all(&data_dir)
                .map_err(|e| format!("[sidecar] mkdir {data_dir:?}: {e}"))?;
            let db_path = data_dir.join("manobu.db");
            let db_url = format!("file:{}", db_path.display());
            log::info!("[sidecar] DATABASE_URL={db_url}");

            // TASK-153 AC#3: give the sidecar explicit cache and log homes so
            // `/api/system/info` reports real dirs, never a cwd-derived
            // guess. Tauri resolves both per-user (XDG on Linux).
            let cache_dir = app
                .path()
                .app_cache_dir()
                .map_err(|e| format!("[sidecar] app_cache_dir: {e}"))?;
            std::fs::create_dir_all(&cache_dir)
                .map_err(|e| format!("[sidecar] mkdir {cache_dir:?}: {e}"))?;
            let log_dir = app
                .path()
                .app_log_dir()
                .map_err(|e| format!("[sidecar] app_log_dir: {e}"))?;
            std::fs::create_dir_all(&log_dir)
                .map_err(|e| format!("[sidecar] mkdir {log_dir:?}: {e}"))?;
            log::info!(
                "[sidecar] MANOBU_CACHE_DIR={} MANOBU_LOG_DIR={}",
                cache_dir.display(),
                log_dir.display()
            );

            // Cron scheduler (TASK-22 Tier B): load/seed the job store and
            // spawn the ticker. Default jobs are disabled until opted in.
            // Clone shares the same Arc<Mutex> store so ticker sees upserts.
            let cron_state = cron::CronState::load(&data_dir)?;
            cron::seed_default_jobs(&cron_state)?;
            cron::spawn_ticker(cron_state.clone());
            app.manage(cron_state);

            // MCP catalog (TASK-22 Tier C): single file watched by both
            // Rust and packages/acp (resolveMcpServersFromDisk).
            let mcp_state = mcp::McpCatalogState::new(data_dir.clone());
            app.manage(mcp_state);

            // Spawn the bundled `server` sidecar (the bun-compiled
            // apps/server binary).
            //
            // CORS_ORIGIN includes every origin the WebView might use —
            // `tauri://localhost` for WebKitGTK (deb/AppImage/rpm),
            // `http://tauri.localhost` for WebView2 (nsis), and
            // `http://localhost:4317` purely for static-file debugging
            // against the binary. The two first are listed on every build: an
            // origin that a platform never sends is inert, and one string is
            // less ways for a packaged Windows run to be silently
            // CORS-rejected.
            //
            // A debug build served from `devUrl` sends THAT origin instead,
            // and the sidecar pins NODE_ENV=production below, so the
            // server's dev-localhost fallback (apps/server/src/index.ts)
            // never fires. Without this the whole RPC surface is CORS-
            // rejected in `tauri dev`: the setup rail reads
            // "backend unreachable" while the sidecar is up and healthy.
            // Release builds keep the strict list.
            let mut cors_origin = String::from(
                "tauri://localhost,http://tauri.localhost,http://localhost:4317",
            );
            if cfg!(debug_assertions) {
                if let Some(dev_url) = app.config().build.dev_url.as_ref() {
                    cors_origin.push(',');
                    cors_origin.push_str(
                        dev_url.origin().ascii_serialization().as_ref(),
                    );
                }
            }
            let shell = app.shell();
            let mut sidecar = shell
                .sidecar("server")
                .map_err(|e| format!("[sidecar] config error: {e}"))?
                .env("BUN_PORT", SIDECAR_PORT.to_string())
                .env("CORS_ORIGIN", &cors_origin)
                .env("NODE_ENV", "production")
                .env("DATABASE_URL", &db_url)
                // TASK-153 AC#2: the sidecar watches this pid and exits when
                // we vanish (crash or kill -9), so an orphaned backend can't
                // squat :4317 or hold agent groups after the app is gone.
                .env("MANOBU_PARENT_PID", std::process::id().to_string())
                .env("MANOBU_CACHE_DIR", cache_dir.display().to_string())
                .env("MANOBU_LOG_DIR", log_dir.display().to_string());

            // Point the server at the persona markdown files (`assistant/*.md`)
            // so the ACP agent's system prompt is loaded from disk, not baked
            // into the binary. Two layouts are covered:
            //
            //   1. Packaged (deb/AppImage): `assistant` ships via
            //      `bundle.resources` → resolve through the resource dir.
            //   2. Dev: `sidecar-dev.sh` syncs the .md files into
            //      `src-tauri/binaries/assistant/`, next to the server binary.
            //
            // If neither exists the server falls back to its embedded
            // Sensei persona and logs a warning.
            // TASK-46: exe-parent FIRST (dev: src-tauri/binaries/assistant,
            // the copy sidecar-dev.sh syncs on every boot), resource dir
            // second (packaged: bundle.resources). The old order hit the
            // resource dir in dev too — two copies existed and drifted.
            let assistant_dir = std::env::current_exe().ok().and_then(|exe| {
                let dir = exe
                    .parent()
                    .unwrap_or_else(|| std::path::Path::new("."))
                    .join("assistant");
                dir.is_dir().then_some(dir)
            })
            .or_else(|| {
                app.path()
                    .resolve("assistant", tauri::path::BaseDirectory::Resource)
                    .ok()
                    .filter(|dir| dir.is_dir())
            });
            if let Some(dir) = assistant_dir {
                log::info!("[sidecar] MANOBU_ASSISTANT_DIR={}", dir.display());
                sidecar =
                    sidecar.env("MANOBU_ASSISTANT_DIR", dir.display().to_string());
            } else {
                log::warn!(
                    "[sidecar] assistant dir not found (resources/dev sync) — server falls back to embedded persona"
                );
            }

            // TASK-43: same contract for the Japanese data files the
            // file-backed routes read (n*.json, grammar/, kanji.json,
            // kanjivg/). Resource dir copy first (packaged), then the repo
            // working tree (dev — the compiled binary's import.meta.dir is
            // /$bunfs so only the env var can point it at real files).
            let japanese_data_dir = app
                .path()
                .resolve(
                    "packages/japanese/data",
                    tauri::path::BaseDirectory::Resource,
                )
                .ok()
                .filter(|dir| dir.is_dir())
                .or_else(|| {
                    // Dev: repo tree above src-tauri/target or src-tauri/binaries.
                    std::env::current_exe().ok().and_then(|exe| {
                        let mut dir = exe.parent().map(|p| p.to_path_buf());
                        for _ in 0..6 {
                            let Some(d) = dir else { break };
                            let candidate = d
                                .join("packages/japanese/data");
                            if candidate.is_dir() {
                                return Some(candidate);
                            }
                            dir = d.parent().map(|p| p.to_path_buf());
                        }
                        None
                    })
                });
            if let Some(dir) = japanese_data_dir {
                log::info!("[sidecar] MANOBU_DATA_DIR={}", dir.display());
                sidecar = sidecar.env("MANOBU_DATA_DIR", dir.display().to_string());
            } else {
                log::warn!(
                    "[sidecar] japanese data dir not found — /api/vocab|grammar|kanji will 500"
                );
            }

            // Point the server at MCP servers (Tier C catalog). Precedence:
            // 1) ACP_MCP_SERVERS env literal wins (user override / tests)
            // 2) Catalog file `config/mcp-servers.json` when it has enabled entries
            // 3) Bundled `jlpt-mcp` sidecar fallback (sits next to `app`)
            //
            // TASK-177: the bundled name carries the target triple and the
            // platform exe suffix, exactly as `scripts/sidecar-stage.sh` and
            // Tauri's `externalBin` rule produce them
            // (`jlpt-mcp-x86_64-unknown-linux-gnu`,
            // `jlpt-mcp-x86_64-pc-windows-msvc.exe`). A bare `jlpt-mcp` never
            // exists next to the app, so before this the fallback silently
            // yielded nothing and the packaged sidecar shipped vocab-less.
            if std::env::var_os("ACP_MCP_SERVERS").is_some() {
                log::info!(
                    "[sidecar] ACP_MCP_SERVERS already set — leaving user override in place"
                );
            } else if let Some(acp_servers) = mcp::resolve_acp_mcp_servers(
                &data_dir,
                bundled_jlpt_mcp_path(std::env::current_exe().ok().as_deref()),
            ) {
                log::info!("[sidecar] ACP_MCP_SERVERS={acp_servers}");
                sidecar = sidecar.env("ACP_MCP_SERVERS", acp_servers);
            } else {
                log::warn!("[sidecar] no MCP servers configured — skipping ACP_MCP_SERVERS");
            }

            // TASK-38: the bun-compiled server resolves native addons
            // (libsql's `require("@libsql/linux-x64-gnu")`) via a
            // node_modules walk relative to its CWD — they are NOT embedded
            // in the single-file binary. Set the sidecar cwd to the exe's
            // parent when it carries `node_modules` (dev: src-tauri/binaries,
            // mirrored by sidecar-dev.sh); otherwise fall back to the
            // resource dir (packaged: bundle.resources maps the same
            // package layout there). Bun resolves from cwd, so this pins
            // resolution deterministically in both layouts.
            let sidecar_cwd = std::env::current_exe().ok().and_then(|exe| {
                let dir = exe.parent().unwrap_or_else(|| std::path::Path::new("."));
                dir.join("node_modules/@libsql")
                    .is_dir()
                    .then(|| dir.to_path_buf())
            })
            .or_else(|| {
                app.path()
                    .resolve("node_modules/@libsql", tauri::path::BaseDirectory::Resource)
                    .ok()
                    .and_then(|dir| dir.parent().map(|p| p.to_path_buf()))
            });
            if let Some(cwd) = sidecar_cwd {
                log::info!("[sidecar] cwd={} (native addon resolution)", cwd.display());
                sidecar = sidecar.current_dir(cwd);
            } else {
                log::warn!(
                    "[sidecar] no node_modules beside exe or in resources — libsql native addon may fail to resolve"
                );
            }

            let (mut rx, child) = sidecar
                .spawn()
                .map_err(|e| format!("[sidecar] spawn failed: {e}"))?;

            // Stash the child so we can kill it on shutdown.
            *SIDECAR_CHILD.lock().unwrap() = Some(child);

            // Drain stdout/stderr events; if init logs enough to look like
            // an error, surface it. We just log everything for now.
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            log::info!("[sidecar stdout] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            log::warn!("[sidecar stderr] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(err) => {
                            log::error!("[sidecar error] {err}");
                        }
                        CommandEvent::Terminated(payload) => {
                            log::warn!(
                                "[sidecar] terminated code={:?} signal={:?}",
                                payload.code, payload.signal
                            );
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // Spawn readiness poll off the main thread so we don't block window creation.
            //
            // The window mounts while this poll is still waiting (the sidecar
            // applies DB migrations before it listens — measured ~15s on a cold
            // start), so every RPC the first paint fires hits a closed port.
            // The frontend's status probe deliberately does not retry, so
            // without this announcement the setup rail reads "backend
            // unreachable" after the backend came up, until the learner
            // presses "re-check". The poll already knows the answer; say it.
            let ready_handle = app.handle().clone();
            std::thread::spawn(move || {
                let ready = wait_for_http(SIDECAR_PORT, READINESS_TIMEOUT);
                if ready {
                    if let Err(e) = ready_handle.emit(SIDECAR_READY_EVENT, ()) {
                        log::warn!("[sidecar] {SIDECAR_READY_EVENT} emit failed: {e}");
                    }
                } else {
                    log::error!(
                        "[sidecar] timeout — /ai calls will fail until sidecar is ready"
                    );
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // TASK-153 AC#1/#2, see `shutdown_sidecar` for what each
            // platform can actually promise about the grace window.
            if let RunEvent::Exit = event {
                if let Ok(mut guard) = SIDECAR_CHILD.lock() {
                    if let Some(child) = guard.take() {
                        shutdown_sidecar(child);
                    }
                }
            }
            // Suppress unused variable on non-exit paths.
            let _ = app_handle;
        });
}
