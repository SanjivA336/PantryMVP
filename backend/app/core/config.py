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
    # cost on top of inference before it emits a single token.
    ai_request_timeout_seconds: float = 60.0
    ai_max_retries: int = 1

    environment: str = "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
