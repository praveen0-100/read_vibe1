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
    # Used only when READVIBE_DATABASE_URL contains nothing but the database password (see database._expand_bare_password):
    # the ReadVibe Supabase project's IPv4 session pooler, which is reachable from Render.
    db_host: str = "aws-0-us-west-1.pooler.supabase.com"
    db_port: int = 5432
    db_user: str = "readvibe.kbuqlibtndllrwewjnht"
    db_name: str = "postgres"
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

    # AI features use free, key-less public LLM endpoints by default (see services/llm.py) and fall back to the built-in
    # local NLP engine. Point these at any OpenAI-compatible service (Groq, OpenRouter, Ollama, …) to use it first.
    llm_enabled: bool = True
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str | None = None
    llm_timeout_seconds: float = 45.0

    # The "Vibe" agent (services/agent): it sticks to one primary model and only switches to a backup when that model
    # keeps failing. With an Anthropic key the primary is agent_model (tool use included) and the backup agent_model_backup;
    # without one it uses READVIBE_LLM_* / the free endpoints, and finally the local engine, so it always answers.
    agent_enabled: bool = True
    anthropic_api_key: str | None = None
    agent_model: str = "claude-sonnet-5-5"
    agent_model_backup: str | None = "claude-haiku-5-5"
    agent_max_steps: int = 4

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
    # Free translation (MyMemory, no key): a real contact e-mail lifts the daily allowance from ~5,000 to ~50,000 characters.
    translate_email: str | None = None

    seed_demo_data: bool = True
    worker_threads: int = 4


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    if settings.database_url.startswith("sqlite:///"):
        Path(settings.database_url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    return settings
