//! STT subdomain · speech → text via sherpa-onnx `OfflineRecognizer` / `OnlineRecognizer`.
//!
//! Two modes:
//! - `speech_stt_file` · offline, whole file at once (SenseVoice, Paraformer, Whisper)
//! - `speech_stt_stream*` · streaming, chunked (Zipformer, TASK-21.5): the
//!   frontend feeds Float32 chunks from the mic; each `accept` returns the
//!   current partial text and flags a final when endpoint detection fires.
//!   Sessions live in a per-state map keyed by a frontend-chosen id so any
//!   invoke can feed the stream without holding a lock across awaits.
//!
//! Like TTS, engines are lazily initialized: `speech_init_stt` (offline)
//! and `speech_init_stt_stream` (streaming Zipformer). Mic input flows:
//! `getUserMedia` → 16kHz mono PCM → temp wav (offline) or Float32 chunks
//! (streaming).

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sherpa_onnx::{
    OfflineRecognizer, OfflineRecognizerConfig, OfflineSenseVoiceModelConfig, OnlineRecognizer,
    OnlineRecognizerConfig, Wave,
};
use tauri::AppHandle;

use super::error::{model_missing, not_initialized};
use super::models;

/// Holds the validated model directory plus the lazily created sherpa
/// recognizer. `OfflineRecognizer` is `Send + Sync` (unsafe impl in the
/// crate), so it can live behind the shared `SpeechState` mutex.
#[allow(dead_code)]
pub struct SttEngine {
    model_dir: PathBuf,
    /// SenseVoice recognizer created at init when the model dir validates.
    /// `None` = placeholder engine (model files not linked yet) · callers
    /// fall back to the stub round-trip below. `Arc` because the
    /// recognizer is `Send + Sync` but not `Clone`; the blocking task
    /// borrows it via the handle while `SpeechState` stays free.
    inner: Option<Arc<OfflineRecognizer>>,
}

impl SttEngine {
    fn new(model_dir: PathBuf) -> Result<Self, String> {
        // Offline models need at least `model.onnx` or `encoder.onnx` + `decoder.onnx`
        let has_model = model_dir.join("model.onnx").exists()
            || model_dir.join("encoder.onnx").exists()
            || model_dir.join("model.int8.onnx").exists();
        if !has_model {
            return Err(model_missing(&model_dir.join("model.onnx")).message);
        }
        if !model_dir.join("tokens.txt").exists() {
            log::warn!("[speech.stt] tokens.txt missing in {}", model_dir.display());
        }

        // Real recognizer only when the SenseVoice layout is complete.
        // A placeholder dir (model present but no tokens.txt) keeps the
        // engine stub-only so dev builds still round-trip invokes.
        let inner = Self::try_recognizer(&model_dir);

        Ok(Self { inner, model_dir })
    }

    /// Build the SenseVoice offline recognizer from `model_dir`.
    /// Returns `None` when the required files are absent · the command then
    /// serves the stub transcription instead of failing the whole invoke.
    fn try_recognizer(model_dir: &PathBuf) -> Option<Arc<OfflineRecognizer>> {
        let model = ["model.int8.onnx", "model.onnx"]
            .iter()
            .map(|f| model_dir.join(f))
            .find(|p| p.exists())?;
        let tokens = model_dir.join("tokens.txt");
        if !tokens.exists() {
            log::info!(
                "[speech.stt] tokens.txt absent in {} · stub STT active",
                model_dir.display()
            );
            return None;
        }

        let mut config = OfflineRecognizerConfig::default();
        config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
            model: Some(model.display().to_string()),
            language: Some("ja".to_string()),
            use_itn: true,
        };
        config.model_config.tokens = Some(tokens.display().to_string());
        config.model_config.num_threads = 2;

        match OfflineRecognizer::create(&config) {
            Some(recognizer) => {
                log::info!(
                    "[speech.stt] SenseVoice recognizer ready (dir={})",
                    model_dir.display()
                );
                Some(Arc::new(recognizer))
            }
            None => {
                log::warn!(
                    "[speech.stt] OfflineRecognizer::create failed for {} · stub STT active",
                    model_dir.display()
                );
                None
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SttInitRequest {
    pub model_id: String,
    pub model_dir: Option<String>,
    /// For SenseVoice / Whisper: language hint like "ja", "zh", "en", "auto"
    pub language: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SttFileRequest {
    /// Absolute path to a wav file (16kHz, mono, PCM16) on the local filesystem.
    /// Tauri's `core:default` already allows reading `app_data_dir`, but
    /// arbitrary paths need `fs` capability · we keep it to app_data for now.
    pub wav_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SttResponse {
    pub text: String,
    pub language: Option<String>,
}

#[tauri::command]
pub fn speech_init_stt(
    app: AppHandle,
    state: tauri::State<super::SpeechState>,
    request: SttInitRequest,
) -> Result<String, String> {
    let dir = if let Some(d) = request.model_dir {
        PathBuf::from(d)
    } else {
        models::model_dir(&app, &request.model_id)?
    };
    let engine = SttEngine::new(dir.clone())?;
    let real = engine.inner.is_some();
    *state.stt.lock().map_err(|e| e.to_string())? = Some(engine);
    log::info!(
        "[speech.stt] initialized model_id={} dir={} lang={:?} real={real}",
        request.model_id,
        dir.display(),
        request.language
    );
    Ok(dir.display().to_string())
}

#[tauri::command]
pub async fn speech_stt_file(
    app: AppHandle,
    state: tauri::State<'_, super::SpeechState>,
    request: SttFileRequest,
) -> Result<SttResponse, String> {
    let (recognizer, stem) = {
        let guard = state.stt.lock().map_err(|e| e.to_string())?;
        let engine = guard
            .as_ref()
            .ok_or_else(|| not_initialized("STT").message)?;
        // Validate the wav before decoding; stem feeds the stub echo.
        let wav_path = PathBuf::from(&request.wav_path);
        if !wav_path.exists() {
            return Err(format!("wav file not found: {}", wav_path.display()));
        }
        let stem = wav_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("audio")
            .to_string();
        (engine.inner.clone(), stem)
    };

    let _app_dir = models::models_dir(&app).ok();

    let result = tokio::task::spawn_blocking(move || {
        // Real recognition path · SenseVoice model present and linked.
        // The `Arc` handle keeps the recognizer shared with `SpeechState`
        // without holding the mutex during the CPU-bound decode.
        if let Some(recognizer) = recognizer.as_ref() {
            let wav = Wave::read(&request.wav_path)
                .ok_or_else(|| format!("failed to decode wav: {}", request.wav_path))?;
            let sample_rate = wav.sample_rate();
            let stream = recognizer.create_stream();
            stream.accept_waveform(sample_rate, wav.samples());
            recognizer.decode(&stream);
            let text = stream
                .get_result()
                .map(|r| r.text)
                .ok_or_else(|| "recognition failed".to_string())?;
            log::info!("[speech.stt] decoded {} chars", text.chars().count());
            return Ok::<String, String>(text);
        }

        // Stub: echo filename as "transcription" so frontend can test the
        // invoke round-trip without a model. Replaced by the recognizer
        // branch above once SenseVoice is present.
        log::info!("[speech.stt] stub file={stem} -> text stub");
        Ok(format!(
            "[stub STT] transcription of {stem} (model not yet linked)"
        ))
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(SttResponse {
        text: result,
        language: None,
    })
}

#[tauri::command]
pub fn speech_stt_is_ready(state: tauri::State<super::SpeechState>) -> bool {
    state.stt.lock().map(|g| g.is_some()).unwrap_or(false)
}

#[derive(Debug, Clone, Deserialize)]
pub struct WriteTempWavRequest {
    /// Raw PCM16 mono bytes captured from the mic (16kHz after downmix).
    pub pcm: Vec<u8>,
    /// Sample rate of the captured PCM (frontend downsamples to 16000).
    pub sample_rate: u32,
    /// File stem, e.g. `drill-a` · final path is
    /// `sanitize_stem(stem)-<unix_ms>.wav`.
    pub stem: String,
}

/// Persist a mic recording as a 16-bit mono PCM WAV under
/// `app_data_dir/speech/tmp/` so `speech_stt_file` can read it without any
/// extra `fs` capability (app_data is already allowed). Returns the
/// absolute path for the subsequent transcribe call.
#[tauri::command]
pub fn speech_write_temp_wav(
    app: AppHandle,
    request: WriteTempWavRequest,
) -> Result<String, String> {
    let dir = models::models_dir(&app)?
        .parent()
        .map(|p| p.join("tmp"))
        .unwrap_or_else(|| PathBuf::from("speech-tmp"));
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {dir:?}: {e}"))?;

    let unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let path = dir.join(format!("{}-{unix_ms}.wav", sanitize_stem(&request.stem)));

    let bytes = pcm_to_wav_bytes(&request.pcm, request.sample_rate);
    std::fs::write(&path, &bytes).map_err(|e| format!("write {path:?}: {e}"))?;
    log::info!(
        "[speech.stt] temp wav {} ({} bytes, {}Hz)",
        path.display(),
        bytes.len(),
        request.sample_rate
    );
    Ok(path.display().to_string())
}

/// Filesystem-safe form of a client-supplied stem. Everything outside
/// `[A-Za-z0-9._-]` is dropped: that removes the path separators that made
/// `stem` a traversal on any platform, and the `* ? " < > |` set Windows
/// rejects in a file name outright. Leading dots go too, so `../x` cannot
/// survive its separators as `..x`. A stem that empties out becomes `rec`,
/// and 64 characters bounds the name.
fn sanitize_stem(stem: &str) -> String {
    let cleaned = stem
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .take(64)
        .collect::<String>()
        .trim_start_matches('.')
        .to_string();
    if cleaned.is_empty() {
        "rec".to_string()
    } else {
        cleaned
    }
}

/// Wrap raw PCM16 mono bytes in a 44-byte RIFF/WAVE header.
fn pcm_to_wav_bytes(pcm: &[u8], sample_rate: u32) -> Vec<u8> {
    let data_len = pcm.len() as u32;
    let file_len = 36 + data_len;
    let mut out = Vec::with_capacity(44 + pcm.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&file_len.to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    out.extend_from_slice(pcm);
    out
}

// ---------------------------------------------------------------------------
// Streaming STT (TASK-21.5) · chunked OnlineRecognizer for shadowing and
// live conversation. Additive to the offline path above; both engines can
// be initialized independently (Settings may hold either model).

/// Streaming engine wrapping a Zipformer `OnlineRecognizer`. The model dir
/// must contain `encoder/decoder/joiner .onnx` + `tokens.txt` (ReazonSpeech
/// JA layout); otherwise the engine stays stub-only like the offline one.
#[allow(dead_code)]
pub struct OnlineSttEngine {
    model_dir: PathBuf,
    inner: Option<Arc<OnlineRecognizer>>,
}

impl OnlineSttEngine {
    pub(crate) fn new(model_dir: PathBuf) -> Result<Self, String> {
        let has_transducer = ["encoder.onnx", "encoder.int8.onnx"]
            .iter()
            .any(|f| model_dir.join(f).exists())
            && ["decoder.onnx", "decoder.int8.onnx"]
                .iter()
                .any(|f| model_dir.join(f).exists())
            && ["joiner.onnx", "joiner.int8.onnx"]
                .iter()
                .any(|f| model_dir.join(f).exists());
        if !has_transducer {
            return Err(model_missing(&model_dir.join("encoder.onnx")).message);
        }
        if !model_dir.join("tokens.txt").exists() {
            log::warn!(
                "[speech.stt.stream] tokens.txt missing in {}",
                model_dir.display()
            );
        }
        let inner = Self::try_recognizer(&model_dir);
        Ok(Self { inner, model_dir })
    }

    /// Build the streaming Zipformer recognizer. `None` → stub session
    /// echoes so dev builds round-trip the invoke contract without a model.
    fn try_recognizer(model_dir: &PathBuf) -> Option<Arc<OnlineRecognizer>> {
        let pick = |names: &[&str]| names.iter().map(|f| model_dir.join(f)).find(|p| p.exists());
        let encoder = pick(&["encoder.int8.onnx", "encoder.onnx"])?;
        let decoder = pick(&["decoder.int8.onnx", "decoder.onnx"])?;
        let joiner = pick(&["joiner.int8.onnx", "joiner.onnx"])?;
        let tokens = model_dir.join("tokens.txt");
        if !tokens.exists() {
            return None;
        }

        let mut config = OnlineRecognizerConfig::default();
        config.model_config.transducer.encoder = Some(encoder.display().to_string());
        config.model_config.transducer.decoder = Some(decoder.display().to_string());
        config.model_config.transducer.joiner = Some(joiner.display().to_string());
        config.model_config.tokens = Some(tokens.display().to_string());
        config.model_config.num_threads = 2;
        config.model_config.provider = Some("cpu".to_string());
        config.decoding_method = Some("greedy_search".to_string());
        // Endpointing: utterance ends after 0.5s trailing silence (already
        // decoded) or 0.75s (utb) · matches the frontend turn-taking budget.
        config.enable_endpoint = true;
        config.rule1_min_trailing_silence = 0.5;
        config.rule2_min_trailing_silence = 0.75;

        match OnlineRecognizer::create(&config) {
            Some(recognizer) => {
                log::info!(
                    "[speech.stt.stream] Zipformer recognizer ready (dir={})",
                    model_dir.display()
                );
                Some(Arc::new(recognizer))
            }
            None => {
                log::warn!(
                    "[speech.stt.stream] OnlineRecognizer::create failed for {} · stub active",
                    model_dir.display()
                );
                None
            }
        }
    }
}

/// One live recognition session: an `OnlineStream` fed by mic chunks.
/// Chunk counters let `speech_stt_stream_accept` decide when to drain.
pub struct StreamSession {
    stream: sherpa_onnx::OnlineStream,
    #[allow(dead_code)]
    chunks_accepted: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SttStreamInitRequest {
    pub model_id: String,
    pub model_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SttStreamChunkResult {
    /// True when endpoint detection fired and the stream was reset ·
    /// `text` is the finalized utterance; subsequent chunks start fresh.
    /// (`final` is a reserved Rust keyword; the serialized name stays
    /// `final` for the frontend contract.)
    #[serde(rename = "final")]
    pub final_: bool,
    /// Current hypothesis (partial text, or the finalized utterance when
    /// `final` is true).
    pub text: String,
}

#[tauri::command]
pub fn speech_init_stt_stream(
    app: AppHandle,
    state: tauri::State<super::SpeechState>,
    request: SttStreamInitRequest,
) -> Result<String, String> {
    let dir = if let Some(d) = request.model_dir {
        PathBuf::from(d)
    } else {
        models::model_dir(&app, &request.model_id)?
    };
    init_stt_stream_state(state.inner(), dir, &request.model_id)
}

/// Testable core of `speech_init_stt_stream` · takes raw state so unit
/// tests can drive a stub engine without an `AppHandle`.
pub(crate) fn init_stt_stream_state(
    state: &super::SpeechState,
    dir: PathBuf,
    model_id: &str,
) -> Result<String, String> {
    let engine = OnlineSttEngine::new(dir.clone())?;
    let real = engine.inner.is_some();
    *state.stt_online.lock().map_err(|e| e.to_string())? = Some(engine);
    log::info!(
        "[speech.stt.stream] initialized model_id={model_id} dir={} real={real}",
        dir.display()
    );
    Ok(dir.display().to_string())
}

#[tauri::command]
pub fn speech_stt_stream_is_ready(state: tauri::State<super::SpeechState>) -> bool {
    state
        .stt_online
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false)
}

/// Open a recognition session. `session_id` is frontend-chosen (e.g. the
/// shadowing line index) so re-invokes are idempotent on reconnects.
#[tauri::command]
pub fn speech_stt_stream_create(
    state: tauri::State<super::SpeechState>,
    session_id: String,
) -> Result<(), String> {
    stt_stream_create_in(state.inner(), &session_id)
}

#[derive(Debug, Clone, Deserialize)]
pub struct SttStreamAcceptRequest {
    pub session_id: String,
    /// 16kHz mono Float32 samples (mic downmix chunk, ~200ms ticks).
    pub samples: Vec<f32>,
    pub sample_rate: u32,
}

/// Feed one mic chunk and drain the decoder. Returns the current partial,
/// or the finalized utterance when endpoint detection fires (the stream is
/// reset so the session continues with the next utterance).
#[tauri::command]
pub async fn speech_stt_stream_accept(
    state: tauri::State<'_, super::SpeechState>,
    request: SttStreamAcceptRequest,
) -> Result<SttStreamChunkResult, String> {
    if request.sample_rate != 16_000 {
        log::warn!(
            "[speech.stt.stream] expected 16kHz, got {}",
            request.sample_rate
        );
    }

    // Stub engine → echo the chunk length so the frontend contract stays
    // testable without a model. No session bookkeeping involved.
    let engine_is_stub = {
        let guard = state.stt_online.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            None => return Err(not_initialized("STT stream").message),
            Some(engine) => engine.inner.is_none(),
        }
    };
    if engine_is_stub {
        let utterance_chars = request.samples.len() / 320; // ~20ms per char at 16k
        return Ok(SttStreamChunkResult {
            final_: false,
            text: format!("[stub stream] {utterance_chars}"),
        });
    }

    // Snapshot the Arc so the blocking task does not hold SpeechState locks.
    let recognizer = {
        let guard = state.stt_online.lock().map_err(|e| e.to_string())?;
        guard
            .as_ref()
            .and_then(|engine| engine.inner.clone())
            .ok_or_else(|| "streaming STT model not linked".to_string())?
    };

    // Take the session out momentarily so the blocking decode does not
    // block other invokes on the sessions mutex.
    let session = {
        let mut sessions = state.stt_streams.lock().map_err(|e| e.to_string())?;
        sessions
            .remove(&request.session_id)
            .ok_or_else(|| format!("no such stream session: {}", request.session_id))?
    };
    let session_id = request.session_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        let stream = &session.stream;
        stream.accept_waveform(request.sample_rate as i32, &request.samples);
        while recognizer.is_ready(stream) {
            recognizer.decode(stream);
        }
        let mut text = recognizer
            .get_result(stream)
            .map(|r| r.text)
            .unwrap_or_default();
        let mut is_final = false;
        if recognizer.is_endpoint(stream) {
            text = recognizer
                .get_result(stream)
                .map(|r| r.text)
                .unwrap_or(text);
            is_final = true;
            recognizer.reset(stream);
        }
        (
            SttStreamChunkResult {
                final_: is_final,
                text,
            },
            session,
        )
    })
    .await
    .map_err(|e| e.to_string())?;
    let (result, session) = result;

    // Put the session back (fresh stream on final · reset already cleared it).
    state
        .stt_streams
        .lock()
        .map_err(|e| e.to_string())?
        .insert(session_id, session);

    Ok(result)
}

/// Flush trailing audio and finalize the session: 0.3s tail padding +
/// `input_finished` so the recognizer emits the last partial as final.
#[tauri::command]
pub async fn speech_stt_stream_finish(
    state: tauri::State<'_, super::SpeechState>,
    session_id: String,
) -> Result<SttStreamChunkResult, String> {
    let recognizer = {
        let guard = state.stt_online.lock().map_err(|e| e.to_string())?;
        let engine = guard
            .as_ref()
            .ok_or_else(|| not_initialized("STT stream").message)?;
        engine
            .inner
            .as_ref()
            .ok_or_else(|| "streaming STT model not linked".to_string())?
            .clone()
    };
    let session = {
        let mut sessions = state.stt_streams.lock().map_err(|e| e.to_string())?;
        sessions
            .remove(&session_id)
            .ok_or_else(|| format!("no such stream session: {session_id}"))?
    };

    let result = tokio::task::spawn_blocking(move || {
        let stream = &session.stream;
        // Tail padding so the encoder context flushes the last phoneme,
        // then `input_finished` before the final decode drain.
        let tail = vec![0.0_f32; 16_000 * 3 / 10];
        stream.accept_waveform(16_000, &tail);
        stream.input_finished();
        while recognizer.is_ready(stream) {
            recognizer.decode(stream);
        }
        let text = recognizer
            .get_result(stream)
            .map(|r| r.text)
            .unwrap_or_default();
        SttStreamChunkResult { final_: true, text }
    })
    .await
    .map_err(|e| e.to_string())?;

    // Session dropped · the frontend re-creates for the next line.
    let _ = session;
    Ok(result)
}

#[tauri::command]
pub fn speech_stt_stream_close(
    state: tauri::State<super::SpeechState>,
    session_id: String,
) -> Result<bool, String> {
    stt_stream_close_in(state.inner(), &session_id)
}

/// Testable session-map helpers · the `#[tauri::command]` wrappers above
/// delegate here so unit tests can drive stub engines without an
/// `AppHandle` or Tauri `State`.
pub(crate) fn stt_stream_create_in(
    state: &super::SpeechState,
    session_id: &str,
) -> Result<(), String> {
    let guard = state.stt_online.lock().map_err(|e| e.to_string())?;
    let engine = guard
        .as_ref()
        .ok_or_else(|| not_initialized("STT stream").message)?;
    let recognizer = engine.inner.as_ref().ok_or_else(|| {
        "streaming STT model not linked · download the Zipformer JA model".to_string()
    })?;
    let mut sessions = state.stt_streams.lock().map_err(|e| e.to_string())?;
    if !sessions.contains_key(session_id) {
        sessions.insert(
            session_id.to_string(),
            StreamSession {
                stream: recognizer.create_stream(),
                chunks_accepted: 0,
            },
        );
        log::info!("[speech.stt.stream] session {session_id} created");
    }
    Ok(())
}

pub(crate) fn stt_stream_close_in(
    state: &super::SpeechState,
    session_id: &str,
) -> Result<bool, String> {
    let removed = state
        .stt_streams
        .lock()
        .map_err(|e| e.to_string())?
        .remove(session_id)
        .is_some();
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::{
        init_stt_stream_state, pcm_to_wav_bytes, sanitize_stem, stt_stream_close_in,
        stt_stream_create_in, SttStreamChunkResult,
    };
    use crate::speech::SpeechState;
    use std::path::PathBuf;

    /// The stem arrives from the WebView, so it is not a filename yet:
    /// separators would escape `speech/tmp`, and Windows rejects
    /// `* ? " < > |` outright. Every one of those has to go, on both
    /// platforms, and an all-dots stem must not become `.` or `..`.
    #[test]
    fn sanitize_stem_drops_separators_and_windows_illegal_chars() {
        assert_eq!(sanitize_stem("drill-a"), "drill-a");
        assert_eq!(sanitize_stem("drill_a.2"), "drill_a.2");
        assert_eq!(sanitize_stem("../../../etc/passwd"), "etcpasswd");
        assert_eq!(
            sanitize_stem("..\\..\\windows\\system32"),
            "windowssystem32"
        );
        assert_eq!(sanitize_stem("a*b?c\"d<e>f|g"), "abcdefg");
        assert_eq!(sanitize_stem(""), "rec");
        assert_eq!(sanitize_stem("."), "rec");
        assert_eq!(sanitize_stem(".."), "rec");
        assert_eq!(sanitize_stem("///"), "rec");
        assert_eq!(sanitize_stem("読解"), "rec");
        assert_eq!(sanitize_stem(&"x".repeat(200)).len(), 64);
    }

    #[test]
    fn wav_header_is_44_bytes_pcm16_mono() {
        let pcm = [0u8; 4];
        let wav = pcm_to_wav_bytes(&pcm, 16_000);
        assert_eq!(wav.len(), 48);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        // mono, PCM, 16-bit
        assert_eq!(u16::from_le_bytes([wav[22], wav[23]]), 1);
        assert_eq!(u16::from_le_bytes([wav[34], wav[35]]), 16);
        assert_eq!(
            u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]),
            16_000
        );
        // data chunk holds the raw pcm
        assert_eq!(&wav[44..48], &pcm[..]);
    }

    fn temp_dir_unique(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("manobu-stt-stream-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn init_requires_transducer_layout() {
        let dir = temp_dir_unique("empty");
        let state = SpeechState::default();
        let err = init_stt_stream_state(&state, dir.clone(), "bad").unwrap_err();
        assert!(err.contains("encoder.onnx"), "unexpected error: {err}");
        assert!(state.stt_online.lock().unwrap().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Stub degradation is detected *before* `OnlineRecognizer::create`
    /// (missing tokens.txt) · dummy ONNX payloads would make sherpa throw
    /// a foreign C++ exception and abort the process, so the corrupt-model
    /// case is guarded upstream by `speech_validate_model` instead.
    #[test]
    fn init_degrades_to_stub_when_tokens_missing() {
        let dir = temp_dir_unique("stub");
        for f in ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx"] {
            std::fs::write(dir.join(f), b"stub").unwrap();
        }
        let state = SpeechState::default();
        init_stt_stream_state(&state, dir.clone(), "zipformer-stub").unwrap();
        let guard = state.stt_online.lock().unwrap();
        let engine = guard.as_ref().unwrap();
        assert!(
            engine.inner.is_none(),
            "missing tokens.txt must degrade to stub"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_requires_initialized_engine() {
        let state = SpeechState::default();
        let err = stt_stream_create_in(&state, "line-1").unwrap_err();
        assert!(err.contains("not initialized"), "unexpected error: {err}");
    }

    #[test]
    fn create_requires_linked_recognizer() {
        let dir = temp_dir_unique("stub-create");
        for f in ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx"] {
            std::fs::write(dir.join(f), b"stub").unwrap();
        }
        let state = SpeechState::default();
        init_stt_stream_state(&state, dir.clone(), "stub").unwrap();
        let err = stt_stream_create_in(&state, "line-1").unwrap_err();
        assert!(err.contains("not linked"), "unexpected error: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn close_is_idempotent_and_reports_missing_sessions() {
        let state = SpeechState::default();
        assert!(!stt_stream_close_in(&state, "ghost").unwrap());
        assert!(!stt_stream_close_in(&state, "ghost").unwrap());
    }

    #[test]
    fn chunk_result_serializes_final_for_the_frontend() {
        let result = SttStreamChunkResult {
            final_: true,
            text: "こんにちは".to_string(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(
            json.contains("\"final\":true"),
            "frontend expects `final`, got: {json}"
        );
    }
}
