"""Application configuration, read from environment variables (optionally via a .env file)."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent

# Load the project-level .env first, then backend/.env (later values do not override earlier ones).
load_dotenv(PROJECT_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _path(name: str, default: Path) -> Path:
    value = os.getenv(name)
    path = Path(value) if value else default
    if not path.is_absolute():
        path = (PROJECT_DIR / path).resolve()
    return path


DATA_DIR: Path = _path("VOLTIQ_DATA_DIR", PROJECT_DIR / "data")
UPLOAD_DIR: Path = DATA_DIR / "uploads"
CLEANED_DIR: Path = DATA_DIR / "cleaned"
MODEL_DIR: Path = DATA_DIR / "models"

DATABASE_URL: str = os.getenv("VOLTIQ_DATABASE_URL", f"sqlite:///{(DATA_DIR / 'voltiq.db').as_posix()}")

CORS_ORIGINS: list[str] = [
    o.strip()
    for o in os.getenv("VOLTIQ_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]

MAX_UPLOAD_MB: int = int(os.getenv("VOLTIQ_MAX_UPLOAD_MB", "200"))

# Built React app (``npm run build``) served by FastAPI so the whole platform runs as one website.
FRONTEND_DIST: Path = _path("VOLTIQ_FRONTEND_DIST", PROJECT_DIR / "frontend" / "dist")

# Optional CSV loaded automatically on startup when the database is empty (used by hosted demos).
# Defaults to seed/ev_charging.csv (or .csv.gz) if present; set VOLTIQ_SEED_CSV="" to disable.
def _default_seed() -> Path:
    for name in ("ev_charging.csv", "ev_charging.csv.gz"):
        if (PROJECT_DIR / "seed" / name).is_file():
            return PROJECT_DIR / "seed" / name
    return PROJECT_DIR / "seed" / "ev_charging.csv"


SEED_CSV: Path | None = (
    None if os.getenv("VOLTIQ_SEED_CSV") == "" else _path("VOLTIQ_SEED_CSV", _default_seed())
)

# Pre-computed data directory (built into the Docker image by prepare_snapshot.py). Copied into an empty
# DATA_DIR at startup so hosted cold starts need no cleaning or model evaluation.
SNAPSHOT_DIR: Path = _path("VOLTIQ_SNAPSHOT_DIR", PROJECT_DIR / "snapshot")

# Run the full validation/test model evaluation automatically after preprocessing.
AUTO_EVALUATE: bool = _bool("VOLTIQ_AUTO_EVALUATE", True)

# Minimum number of daily observations required before models are fitted.
MIN_DAILY_OBSERVATIONS: int = int(os.getenv("VOLTIQ_MIN_DAILY_OBSERVATIONS", "60"))

DEFAULT_DATABASE = DATA_DIR / "voltiq.db"
USING_DEFAULT_DATABASE: bool = "VOLTIQ_DATABASE_URL" not in os.environ

for _d in (DATA_DIR, UPLOAD_DIR, CLEANED_DIR, MODEL_DIR):
    _d.mkdir(parents=True, exist_ok=True)
