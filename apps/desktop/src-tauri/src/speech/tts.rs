//! TTS subdomain — text → speech via sherpa-onnx `OfflineTts` (Supertonic 3).
//!
//! The engine is lazily initialized with `speech_init_tts` which loads the
//! Supertonic file set (`SUPERTONIC_FILES` in `models.rs`) from
//! `app_data_dir/speech/models/<id>/`. Subsequent `speech_tts` calls are
//! `spawn_blocking` to avoid blocking Tauri's async runtime (sherpa is
//! CPU-bound). Supertonic 3 outputs 44.1 kHz mono; the samples are encoded
//! here as a 16-bit PCM RIFF WAV for the frontend to play through WebAudio
//! (`playWavBytes` in `packages/speech/src/tts.ts` — not
//! `new Audio(url).play()`, which WebKitGTK rejects after an `await`).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sherpa_onnx::{
    GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsModelConfig,
    OfflineTtsSupertonicModelConfig,
};

use super::error::{model_missing, not_initialized};
use super::models;

/// Handle to the sherpa-onnx Supertonic engine.
///
/// `OfflineTts` is `Send + Sync` (the C library is thread-safe for
/// single-object usage), so `speech_tts` clones the `Arc` out of the state
/// lock and generates on a blocking thread without holding the mutex.
pub struct TtsEngine {
    #[allow(dead_code)]
    model_dir: PathBuf,
    tts: Arc<OfflineTts>,
}

impl TtsEngine {
    /// Load a Supertonic 3 model directory. Any missing stage file is a hard
    /// error: a half-extracted archive must not produce a silent engine.
    fn new(model_dir: PathBuf) -> Result<Self, String> {
        for file in models::SUPERTONIC_FILES {
            let path = model_dir.join(file);
            if !path.exists() {
                return Err(model_missing(&path).message);
            }
        }
        let stage = |name: &str| Some(model_dir.join(name).display().to_string());
        let config = OfflineTtsConfig {
            model: OfflineTtsModelConfig {
                supertonic: OfflineTtsSupertonicModelConfig {
                    duration_predictor: stage("duration_predictor.int8.onnx"),
                    text_encoder: stage("text_encoder.int8.onnx"),
                    vector_estimator: stage("vector_estimator.int8.onnx"),
                    vocoder: stage("vocoder.int8.onnx"),
                    tts_json: stage("tts.json"),
                    unicode_indexer: stage("unicode_indexer.bin"),
                    voice_style: stage("voice.bin"),
                },
                num_threads: 2,
                debug: false,
                ..Default::default()
            },
            ..Default::default()
        };
        let tts = OfflineTts::create(&config).ok_or_else(|| {
            format!(
                "sherpa failed to load Supertonic model from {}",
                model_dir.display()
            )
        })?;
        Ok(Self {
            model_dir,
            tts: Arc::new(tts),
        })
    }

    fn handle(&self) -> Arc<OfflineTts> {
        Arc::clone(&self.tts)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct TtsInitRequest {
    /// Model id under `app_data_dir/speech/models/<id>`
    /// (e.g. `sherpa-onnx-supertonic-3-tts-int8-2026-05-11`)
    pub model_id: String,
    /// Optional override for the full model directory (advanced)
    pub model_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TtsRequest {
    pub text: String,
    /// 0.0 = slow, 1.0 = normal, 2.0 = fast
    pub speed: Option<f32>,
    /// Speaker id: Supertonic 3 ships 10 built-in voices (sid 0..9)
    pub sid: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TtsResponse {
    /// 16-bit PCM wav bytes (RIFF header included) — frontend can do
    /// `URL.createObjectURL(new Blob([bytes], {type: "audio/wav"}))`.
    pub wav: Vec<u8>,
    pub sample_rate: u32,
    pub num_samples: u32,
}

/// Supertonic `num_steps` used by manobu — the value proven audible and
/// intelligible in the TASK-174 spike (the crate default of 5 is lower).
const SUPERTONIC_NUM_STEPS: i32 = 8;

#[tauri::command]
pub fn speech_init_tts(
    app: tauri::AppHandle,
    state: tauri::State<super::SpeechState>,
    request: TtsInitRequest,
) -> Result<String, String> {
    let dir = if let Some(d) = request.model_dir {
        PathBuf::from(d)
    } else {
        models::model_dir(&app, &request.model_id)?
    };
    let engine = TtsEngine::new(dir.clone())?;
    *state.tts.lock().map_err(|e| e.to_string())? = Some(engine);
    log::info!(
        "[speech.tts] initialized model_id={} dir={}",
        request.model_id,
        dir.display()
    );
    Ok(dir.display().to_string())
}

#[tauri::command]
pub async fn speech_tts(
    state: tauri::State<'_, super::SpeechState>,
    request: TtsRequest,
) -> Result<TtsResponse, String> {
    // Clone the engine handle (Arc) out so the lock is not held across the
    // blocking generation pass. Absent engine → NOT_INITIALIZED error, which
    // the frontend surfaces as the "no voice" state (never silent audio).
    let tts = {
        let guard = state.tts.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            Some(engine) => engine.handle(),
            None => return Err(not_initialized("TTS").message),
        }
    };
    let sample_rate = tts.sample_rate();
    let text = request.text;
    let speed = request.speed.unwrap_or(1.0);
    let sid = request.sid.unwrap_or(0);

    let samples = tokio::task::spawn_blocking(move || {
        // Japanese is selected per-generation through Supertonic's `extra`
        // JSON; the model itself is multilingual (31 languages). The key is
        // `lang` and the value `"ja"`: proven by the TASK-174 spike on this
        // exact pinned crate (sherpa-onnx 1.13.7) — synthesizing
        // "明日は雨ですから、早く帰宅しましょう。" with `{lang: "ja"}` + sid 0
        // produced audio that SenseVoice transcribed back to the same string.
        // The in-app silence was never this key; it is the WebKitGTK
        // autoplay gate on the playback side (see packages/speech tts.ts).
        let mut extra = HashMap::new();
        extra.insert("lang".to_string(), serde_json::json!("ja"));
        let gen_config = GenerationConfig {
            extra: Some(extra),
            num_steps: SUPERTONIC_NUM_STEPS,
            sid,
            speed,
            ..Default::default()
        };
        let audio = tts
            .generate_with_config(&text, &gen_config, None::<fn(&[f32], f32) -> bool>)
            .ok_or_else(|| format!("TTS generation failed for text of {} bytes", text.len()))?;
        Ok::<Vec<f32>, String>(audio.samples().to_vec())
    })
    .await
    .map_err(|e| e.to_string())??;

    let wav = encode_wav_pcm16(&samples, sample_rate);
    Ok(TtsResponse {
        num_samples: samples.len() as u32,
        sample_rate: sample_rate as u32,
        wav,
    })
}

/// Encode f32 samples (`[-1, 1]`) as a minimal RIFF WAV: PCM16 mono.
///
/// Header is 44 bytes at the engine's native rate (Supertonic 3: 44100 Hz).
/// The frontend plays the bytes directly via a Blob URL.
fn encode_wav_pcm16(samples: &[f32], sample_rate: i32) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let file_len = 36 + data_len;
    let rate = sample_rate as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&file_len.to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes()); // byte rate
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        let clipped = s.clamp(-1.0, 1.0);
        let pcm = (clipped * 32767.0).round() as i16;
        out.extend_from_slice(&pcm.to_le_bytes());
    }
    out
}

#[tauri::command]
pub fn speech_tts_is_ready(state: tauri::State<super::SpeechState>) -> bool {
    state.tts.lock().map(|g| g.is_some()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_wav_pcm16_header_matches_samples() {
        let samples = vec![0.0f32, 1.0, -1.0, 0.5];
        let wav = encode_wav_pcm16(&samples, 44_100);
        assert_eq!(wav.len(), 44 + samples.len() * 2);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 44_100);
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 8);
        // Full-scale samples quantize to the i16 extremes.
        assert_eq!(i16::from_le_bytes(wav[46..48].try_into().unwrap()), 32767);
        assert_eq!(i16::from_le_bytes(wav[48..50].try_into().unwrap()), -32767);
    }

    #[test]
    fn encode_wav_pcm16_clamps_out_of_range_samples() {
        let wav = encode_wav_pcm16(&[2.0f32, -2.0], 16_000);
        assert_eq!(i16::from_le_bytes(wav[44..46].try_into().unwrap()), 32767);
        assert_eq!(i16::from_le_bytes(wav[46..48].try_into().unwrap()), -32767);
    }

    #[test]
    fn engine_new_reports_missing_stage_file() {
        let tmp = std::env::temp_dir().join("manobu-test-tts-no-model");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let err = TtsEngine::new(tmp.clone())
            .err()
            .expect("empty dir must not initialize an engine");
        assert!(err.contains("model file not found"), "got: {err}");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
