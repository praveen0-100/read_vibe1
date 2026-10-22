"""Application settings, loaded from environment variables (prefix READVIBE_) or backend/.env."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", env_prefix="READVIBE_", extra="ignore")

    app_name: str = "ReadVibe API"
    environment: str = "development"
    debug: bool = False

    database_url: str = f"sqlite:///{(BASE_DIR / 'data' / 'readvibe.db').as_posix()}"
    storage_dir: Path = BASE_DIR / "data" / "storage"

    jwt_secret: str = "change-me-in-production-use-a-long-random-string"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60 * 24 * 7

    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]

    max_upload_mb: int = 5 * 1024  # 5 GB; uploads stream to disk in chunks
    rate_limit_per_minute: int = 600
    ai_rate_limit_per_minute: int = 40

    # Optional Claude integration. Without a key the built-in local NLP engine is used.
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5-5"
    ai_effort: str = "low"

    # Natural read-aloud voices: Microsoft neural voices (edge-tts) work with no key; add an OpenAI key to unlock its voices too.
    openai_api_key: str | None = None
    openai_tts_model: str = "gpt-4o-mini-tts"

    # Google sign-in: OAuth 2.0 "Web application" client ID from Google Cloud Console.
    # Leave unset to hide the Google button.
    google_client_id: str | None = None

    # External research providers (public APIs, no key required)
    research_timeout_seconds: float = 8.0
    research_online: bool = True
    semantic_scholar_api_key: str | None = None
    contact_email: str = "readvibe@example.com"

    seed_demo_data: bool = True
    worker_threads: int = 4


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    if settings.database_url.startswith("sqlite:///"):
        Path(settings.database_url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    return settings
