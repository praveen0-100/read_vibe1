"""SQLAlchemy engine, session factory and declarative base."""
import logging
import re
from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import BASE_DIR, get_settings

settings = get_settings()

log = logging.getLogger("readvibe.db")
_POSTGRES_IN_TEXT = re.compile(r"""postgres(?:ql)?(?:\+\w+)?://[^\s'"]+""")


def _clean_url(raw: str) -> str:
    """A dashboard paste often carries extras (quotes, spaces, a line break, even a whole `psql '...'` command)."""
    raw = (raw or "").strip()
    found = _POSTGRES_IN_TEXT.search(raw)
    return found.group(0) if found else raw.strip("'\"").strip()


def _normalise_url(url: str) -> str:
    """Hosted Postgres (Supabase, Neon, Render) hands out postgres:// URLs; SQLAlchemy needs the driver named."""
    url = _clean_url(url)
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url.removeprefix(prefix)
    return url


def _describe_problem(raw: str) -> str:
    """What is wrong with a database address, without ever echoing the password."""
    raw = raw or ""
    scheme = raw.strip().split("://", 1)[0][:20] if "://" in raw else "(no scheme)"
    has_space = bool(re.search(r"\s", raw.strip()))
    return f"scheme={scheme!r}, length={len(raw)}, '@' count={raw.count('@')}, has spaces/newlines={has_space}"


def _resolve_url(raw: str) -> tuple[str, str | None]:
    """The URL to use and, when the configured one is unusable, why. An unusable address falls back to a temporary
    SQLite file (reported on /api/health) instead of crash-looping, so the site stays up while the setting is fixed."""
    url = _normalise_url(raw)
    try:
        make_url(url)
        return url, None
    except ArgumentError:
        error = f"READVIBE_DATABASE_URL is not a valid database address ({_describe_problem(raw)})"
        return f"sqlite:///{(BASE_DIR / 'data' / 'readvibe.db').as_posix()}", error


_url, DB_CONFIG_ERROR = _resolve_url(settings.database_url)
if DB_CONFIG_ERROR:
    log.error("%s — falling back to temporary SQLite storage", DB_CONFIG_ERROR)
    (BASE_DIR / "data").mkdir(parents=True, exist_ok=True)
_is_sqlite = _url.startswith("sqlite")
engine = create_engine(
    _url,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    pool_pre_ping=True,
    **({} if _is_sqlite else {"pool_size": 5, "max_overflow": 5, "pool_recycle": 280}),
)

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401  (registers tables)

    Base.metadata.create_all(bind=engine)
    _add_missing_columns()


def _add_missing_columns() -> None:
    """Additive auto-migration: create columns added to models after a table already existed.

    Covers nullable/defaulted columns only — use Alembic for renames, drops and type changes.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                ddl_type = column.type.compile(dialect=engine.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {ddl_type}'))
                if column.unique or column.index:
                    unique = "UNIQUE " if column.unique else ""
                    conn.execute(text(f'CREATE {unique}INDEX IF NOT EXISTS "ix_{table.name}_{column.name}" ON "{table.name}" ("{column.name}")'))
