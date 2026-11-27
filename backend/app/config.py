from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: Literal["development", "production"] = "development"
    libpq_dir: str | None = None
    database_url: str
    test_database_url: str
    cookie_secure: bool = False
    session_days: int = 30
    auth_provider: str = "local"
    sample_user_password: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
