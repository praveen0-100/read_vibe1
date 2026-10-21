import os
import sys
import tempfile
from pathlib import Path

import pytest

_tmp = tempfile.mkdtemp(prefix="readvibe-test-")
os.environ["READVIBE_DATABASE_URL"] = f"sqlite:///{Path(_tmp, 'test.db').as_posix()}"
os.environ["READVIBE_STORAGE_DIR"] = str(Path(_tmp, "storage"))
os.environ["READVIBE_RESEARCH_ONLINE"] = "false"
os.environ["READVIBE_RATE_LIMIT_PER_MINUTE"] = "100000"
os.environ["READVIBE_AI_RATE_LIMIT_PER_MINUTE"] = "100000"
os.environ["READVIBE_ANTHROPIC_API_KEY"] = ""
os.environ.pop("ANTHROPIC_API_KEY", None)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services import jobs  # noqa: E402

jobs.run_inline(True)


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def auth(client):
    r = client.post("/api/auth/register", json={"name": "Test Reader", "email": "reader@example.com", "password": "supersecret1"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def demo(client):
    r = client.post("/api/auth/demo")
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
