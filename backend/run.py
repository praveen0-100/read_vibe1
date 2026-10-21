"""Development entrypoint: `python backend/run.py` (or `uvicorn app.main:app` from backend/)."""
import os
import sys
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parent))

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "5000")),
        reload=os.getenv("RELOAD", "1") == "1",
        app_dir=str(Path(__file__).resolve().parent),
    )
