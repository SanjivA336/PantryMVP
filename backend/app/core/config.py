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

    environment: str = "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
