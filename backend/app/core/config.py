from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven configuration, loaded once and cached.

    Values come from the repo-root `.env` file (gitignored) or real
    environment variables in deployed environments.
    """

    model_config = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""

    # "google_vision" is the only engine actually implemented right now;
    # the field exists so a later swap (or an alternate engine for
    # tests/dev) is a config change, not a code change.
    ocr_engine: str = "google_vision"
    google_vision_api_key: str = ""

    # "ollama" is the only provider actually implemented right now; the
    # field exists so switching providers later is a config change, not a
    # code change (that's the whole point of the AiProvider abstraction).
    ai_provider: str = "ollama"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama2"
    # Deliberately much longer than this app's other timeouts (Google
    # Vision's is 30s) -- a cold-started local model pays a real weight-load
    # cost on top of inference before it emits a single token. Measured
    # 43-68s end to end for llama2 on CPU, so 60s was clipping real (not
    # hung) responses.
    ai_request_timeout_seconds: float = 120.0
    # Whether a malformed AI response gets one repair attempt (a second call
    # asking the model to fix its own output) before giving up. A count in
    # name only -- the code only ever attempts exactly one repair regardless
    # of the value, so this is a plain on/off switch, not a retry budget.
    ai_retry_enabled: bool = True

    environment: str = "development"

    # Comma-separated Supabase auth user ids allowed to use AI/OCR-backed
    # features (recipe generate/import-by-text-or-url/substitutions, receipt
    # scanning) -- real inference/OCR cost, still experimental. A .env value
    # rather than a DB-editable role since there's exactly one such account
    # today; see app/core/auth.py's is_developer/require_developer.
    developer_user_ids: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
