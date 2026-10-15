//! Speech domain — sherpa-onnx backed TTS / STT / VAD for manobu.
//!
//! Screaming architecture: this module screams "speech" (not "sherpa" or "audio").
//! Subdomains mirror user intent: `tts` (text → speech for Sensei voice),
//! `stt` (speech → text for pronunciation practice), `vad` (voice activity
//! for turn-taking), `models` (offline model lifecycle).
//!
//! The Tauri shell owns model storage at `app_data_dir/speech/models/` and
//! exposes invoke commands that the `@manobu/speech` TS package calls.
//! No `apps/server` dependency — speech runs 100% offline on-device.

pub mod error;
pub mod models;
pub mod stt;
pub mod tts;
pub mod vad;

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Global speech state — lazily initialized TTS/STT engines.
///
/// `Mutex<Option<T>>` keeps `Send` without `tokio` overhead; Tauri commands
/// are `async` but engines are `!Send` in some sherpa builds, so we `block`
/// inside `spawn_blocking` when calling them.
pub struct SpeechState {
    pub tts: Mutex<Option<tts::TtsEngine>>,
    pub stt: Mutex<Option<stt::SttEngine>>,
    pub vad: Mutex<Option<vad::VadEngine>>,
    /// Streaming recognizer (Zipformer). `None` → stub stream sessions.
    pub stt_online: Mutex<Option<stt::OnlineSttEngine>>,
    /// Live recognition sessions keyed by a frontend-chosen id.
    pub stt_streams: Mutex<HashMap<String, stt::StreamSession>>,
}

impl Default for SpeechState {
    fn default() -> Self {
        Self {
            tts: Mutex::new(None),
            stt: Mutex::new(None),
            vad: Mutex::new(None),
            stt_online: Mutex::new(None),
            stt_streams: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SpeechVersion {
    pub version: String,
    pub git_sha1: String,
    pub git_date: String,
}

#[tauri::command]
pub fn speech_version() -> SpeechVersion {
    SpeechVersion {
        version: sherpa_onnx::version().to_string(),
        git_sha1: sherpa_onnx::git_sha1().to_string(),
        git_date: sherpa_onnx::git_date().to_string(),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SpeechStatus {
    pub tts_ready: bool,
    pub stt_ready: bool,
    pub vad_ready: bool,
    pub models_dir: String,
}

#[tauri::command]
pub fn speech_status(
    state: tauri::State<SpeechState>,
    app: tauri::AppHandle,
) -> Result<SpeechStatus, String> {
    let dir = models::models_dir(&app).map_err(|e| e.to_string())?;
    Ok(SpeechStatus {
        tts_ready: state.tts.lock().map(|g| g.is_some()).unwrap_or(false),
        stt_ready: state.stt.lock().map(|g| g.is_some()).unwrap_or(false),
        vad_ready: state.vad.lock().map(|g| g.is_some()).unwrap_or(false),
        models_dir: dir.display().to_string(),
    })
}
