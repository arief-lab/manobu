use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SpeechError {
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for SpeechError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for SpeechError {}

impl From<SpeechError> for String {
    fn from(e: SpeechError) -> Self {
        e.message
    }
}

pub fn not_initialized(what: &str) -> SpeechError {
    SpeechError {
        code: "NOT_INITIALIZED".to_string(),
        message: format!(
            "{what} not initialized · call speech_init_* first or check model files in app_data_dir/speech/models/"
        ),
    }
}

pub fn model_missing(path: &std::path::Path) -> SpeechError {
    SpeechError {
        code: "MODEL_MISSING".to_string(),
        message: format!("model file not found: {}", path.display()),
    }
}
