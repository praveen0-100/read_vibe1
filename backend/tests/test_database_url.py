"""READVIBE_DATABASE_URL pasted from a dashboard: tolerate the usual copy/paste mess, never leak the password."""
import pytest
from sqlalchemy.engine import make_url

from app import database

GOOD = "postgresql+psycopg://readvibe.abc:s3cretpw@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require"


@pytest.mark.parametrize("raw", [
    "postgresql://readvibe.abc:s3cretpw@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require",
    "postgres://readvibe.abc:s3cretpw@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require",
    '  "postgresql://readvibe.abc:s3cretpw@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require"  ',
    "'postgresql://readvibe.abc:s3cretpw@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require'\n",
    "postgresql://readvibe.abc:s3cretpw@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require\r\n",
    "psql 'postgresql://readvibe.abc:s3cretpw@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require'",
    "DATABASE_URL=\"postgresql://readvibe.abc:s3cretpw@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require\"",
])
def test_messy_pastes_become_a_valid_url(raw):
    url = database._normalise_url(raw)
    assert url == GOOD
    assert make_url(url).host == "aws-0-us-west-1.pooler.supabase.com"


def test_sqlite_paths_with_spaces_are_left_alone():
    path = "sqlite:///C:/Users/PRAVEEN PRABAKARN/Desktop/new fold/data/readvibe.db"
    assert database._normalise_url(path) == path
    assert database._normalise_url("  sqlite:////data/readvibe.db \n") == "sqlite:////data/readvibe.db"


def test_problem_description_never_contains_the_password():
    text = database._describe_problem('"postgresql://user:hunter2-secret@host:5432/db"')
    assert "hunter2" not in text and "secret" not in text
    assert "'@' count=1" in text


def test_unparseable_url_falls_back_instead_of_crashing():
    url, error = database._resolve_url("postgresql//missing-colon-and-slashes")
    assert url.startswith("sqlite:///")
    assert error and "READVIBE_DATABASE_URL" in error and "missing-colon" not in error


def test_valid_url_has_no_error():
    url, error = database._resolve_url(" 'postgres://u:p@host:5432/db' ")
    assert url == "postgresql+psycopg://u:p@host:5432/db" and error is None


def test_fallback_location_is_writable_for_any_user():
    import tempfile
    from pathlib import Path

    url, _ = database._resolve_url("not a url at all")
    folder = Path(url.removeprefix("sqlite:///")).parent
    assert folder == Path(tempfile.gettempdir()) and folder.exists()
