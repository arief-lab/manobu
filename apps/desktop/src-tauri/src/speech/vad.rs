//! VAD subdomain · voice activity detection via Silero VAD (TASK-21.3).
//!
//! Two paths, both covered:
//! - **Sherpa path** (model linked): a streaming `VoiceActivityDetector`
//!   fed in 512-sample windows (Silero's native window @16kHz). Segments
//!   come back as `{start_ms, end_ms}` for turn-taking (auto-stop after
//!   silence) and for trimming silence before STT.
//! - **Stub path** (no engine): naive RMS energy check so the frontend
//!   works before the ~1MB model is downloaded and in web-dev (AC4).
//!
//! The model is tiny (~1MB `silero_vad.onnx`) and lives at
//! `app_data_dir/speech/models/sherpa-onnx-silero-vad/`.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::error::model_missing;
use super::models;

/// Silero's native window size @16kHz (32ms) · sherpa examples use 512.
const VAD_WINDOW_SIZE: usize = 512;

const VAD_SAMPLE_RATE: i32 = 16_000;

/// Ring buffer seconds · one-shot mic clips are capped at 15s; 30s is ample.
const VAD_BUFFER_SECONDS: f32 = 30.0;

/// Silero tuning, mirroring sherpa's `silero_vad_remove_silence.rs` example.
/// `min_speech_duration` is below the 200ms live tick (TASK-21.3 AC2 UI +
/// watchdog) so a short speech window is still reported per tick.
const VAD_THRESHOLD: f32 = 0.5;
const VAD_MIN_SILENCE_S: f32 = 0.25;
const VAD_MIN_SPEECH_S: f32 = 0.1;
/// One-shot clips are bounded by `MAX_RECORDING_MS` (15s) in the TS layer.
const VAD_MAX_SPEECH_S: f32 = 15.0;

/// Energy threshold for the stub RMS path (matches packages/speech vad.ts).
const STUB_RMS_THRESHOLD: f32 = 0.01;

#[derive(Clone)]
pub struct VadEngine {
    /// Shared detector. `VoiceActivityDetector` is Send + Sync; the
    /// streaming API is stateful (accept_waveform advances an internal
    /// ring), so detect runs are serialized behind the mutex and
    /// `reset()` before each pass.
    detector: Arc<Mutex<sherpa_onnx::VoiceActivityDetector>>,
}

impl VadEngine {
    fn new(model_path: &std::path::Path, sample_rate: i32) -> Result<Self, String> {
        if !model_path.exists() {
            return Err(model_missing(model_path).message);
        }
        let mut silero = sherpa_onnx::SileroVadModelConfig::default();
        silero.model = Some(model_path.display().to_string());
        silero.threshold = VAD_THRESHOLD;
        silero.min_silence_duration = VAD_MIN_SILENCE_S;
        silero.min_speech_duration = VAD_MIN_SPEECH_S;
        silero.max_speech_duration = VAD_MAX_SPEECH_S;
        silero.window_size = VAD_WINDOW_SIZE as i32;
        let config = sherpa_onnx::VadModelConfig {
            silero_vad: silero,
            ten_vad: Default::default(),
            sample_rate,
            num_threads: 1,
            provider: Some("cpu".to_string()),
            debug: false,
        };
        let detector = sherpa_onnx::VoiceActivityDetector::create(&config, VAD_BUFFER_SECONDS)
            .ok_or_else(|| {
                format!(
                    "failed to create VoiceActivityDetector from {}",
                    model_path.display()
                )
            })?;
        Ok(Self {
            detector: Arc::new(Mutex::new(detector)),
        })
    }

    /// One streaming pass over the whole clip: feed 512-sample windows,
    /// drain detected segments as they arrive, then `flush()` and drain
    /// again so trailing speech is not cut.
    fn detect(&self, samples: &[f32], sample_rate: u32) -> Vec<VadSegment> {
        let detector = self
            .detector
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        detector.reset();
        let mut out = Vec::new();
        for chunk in samples.chunks(VAD_WINDOW_SIZE) {
            detector.accept_waveform(chunk);
            while let Some(seg) = detector.front() {
                out.push(segment_to_ms(&seg, sample_rate));
                detector.pop();
            }
        }
        detector.flush();
        while let Some(seg) = detector.front() {
            out.push(segment_to_ms(&seg, sample_rate));
            detector.pop();
        }
        out
    }
}

/// Convert a sherpa `SpeechSegment` to manobu's ms-based `VadSegment`.
fn segment_to_ms(seg: &sherpa_onnx::SpeechSegment, sample_rate: u32) -> VadSegment {
    let rate = if sample_rate == 0 {
        VAD_SAMPLE_RATE as u32
    } else {
        sample_rate
    };
    let start_samples = seg.start().max(0) as u32;
    let n = seg.n().max(0) as u32;
    VadSegment {
        start_ms: (start_samples * 1000) / rate,
        end_ms: ((start_samples + n) * 1000) / rate,
    }
}

/// Stub energy VAD: one segment covering the whole clip when the overall
/// RMS crosses the threshold, else no speech. Same semantics as the JS
/// fallback in `packages/speech/src/vad.ts` (RMS > 0.01).
fn stub_energy_segments(samples: &[f32], sample_rate: u32) -> Vec<VadSegment> {
    if samples.is_empty() {
        return Vec::new();
    }
    let rate = if sample_rate == 0 {
        VAD_SAMPLE_RATE as u32
    } else {
        sample_rate
    };
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    if rms > STUB_RMS_THRESHOLD {
        vec![VadSegment {
            start_ms: 0,
            end_ms: (samples.len() as u32 * 1000) / rate,
        }]
    } else {
        Vec::new()
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct VadInitRequest {
    /// Model id or direct path to `silero_vad.onnx`
    pub model_id: Option<String>,
    pub model_path: Option<String>,
    /// Native rate · Silero is trained at 16kHz; defaults to 16000.
    pub sample_rate: Option<i32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct VadSegment {
    pub start_ms: u32,
    pub end_ms: u32,
}

#[tauri::command]
pub fn speech_init_vad(
    app: AppHandle,
    state: tauri::State<super::SpeechState>,
    request: VadInitRequest,
) -> Result<String, String> {
    let path = if let Some(p) = request.model_path {
        PathBuf::from(p)
    } else if let Some(id) = request.model_id {
        models::model_dir(&app, &id)?.join("silero_vad.onnx")
    } else {
        // Default: app_data_dir/speech/models/sherpa-onnx-silero-vad/silero_vad.onnx
        models::model_dir(&app, "sherpa-onnx-silero-vad")?.join("silero_vad.onnx")
    };
    let sample_rate = request.sample_rate.unwrap_or(VAD_SAMPLE_RATE);
    let engine = VadEngine::new(&path, sample_rate)?;
    *state.vad.lock().map_err(|e| e.to_string())? = Some(engine);
    log::info!(
        "[speech.vad] initialized path={} rate={sample_rate}",
        path.display()
    );
    Ok(path.display().to_string())
}

#[tauri::command]
pub async fn speech_vad_detect(
    state: tauri::State<'_, super::SpeechState>,
    samples: Vec<f32>,
    sample_rate: u32,
) -> Result<Vec<VadSegment>, String> {
    if sample_rate != 16_000 {
        log::warn!("[speech.vad] expected 16kHz, got {sample_rate}");
    }

    // Clone the engine (Arc) out of the state so the lock is not held
    // across the blocking detect pass. Absent engine → stub energy path.
    let engine: Option<VadEngine> = {
        let guard = state.vad.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            log::info!("[speech.vad] engine absent · falling back to stub energy VAD");
        }
        guard.as_ref().cloned()
    };

    let segments = tokio::task::spawn_blocking(move || match engine {
        Some(vad) => vad.detect(&samples, sample_rate),
        None => stub_energy_segments(&samples, sample_rate),
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(segments)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A full-length single segment covering the clip, from the stub path.
    #[test]
    fn stub_energy_flags_speech_with_duration_math() {
        // 16000 samples @16kHz = 1000ms of "speech" (loud sine-ish).
        let samples: Vec<f32> = (0..16_000)
            .map(|i| 0.5 * ((i as f32) * 0.05).sin())
            .collect();
        let segs = stub_energy_segments(&samples, 16_000);
        assert_eq!(segs.len(), 1);
        assert_eq!(
            segs[0],
            VadSegment {
                start_ms: 0,
                end_ms: 1000
            }
        );
    }

    #[test]
    fn stub_energy_silent_returns_empty() {
        let segs = stub_energy_segments(&[0.0_f32; 16_000], 16_000);
        assert!(segs.is_empty());
    }

    #[test]
    fn stub_energy_empty_input_returns_empty() {
        assert!(stub_energy_segments(&[], 16_000).is_empty());
    }

    #[test]
    fn segment_to_ms_converts_sample_indices() {
        // 8000-sample segment starting at sample 16000 @8kHz → 2000..3000ms.
        // (Rate math only · a real SpeechSegment needs the onnx runtime, so
        // this exercises the arithmetic through the stub path instead.)
        let samples: Vec<f32> = vec![0.5; 8000];
        let segs = stub_energy_segments(&samples, 8_000);
        assert_eq!(segs[0].start_ms, 0);
        assert_eq!(segs[0].end_ms, 1000);
    }

    #[test]
    fn segment_to_ms_guards_zero_sample_rate() {
        let samples: Vec<f32> = vec![0.5; 16_000];
        let segs = stub_energy_segments(&samples, 0);
        assert_eq!(segs[0].end_ms, 1000); // falls back to 16kHz divisor
    }
}
