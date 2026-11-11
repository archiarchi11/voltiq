"""Build-time snapshot for hosted deployments.

Loads the seed dataset and runs the full model evaluation (plus the automatic 30-day forecast) once,
writing everything into VOLTIQ_DATA_DIR. The Docker image ships that directory as /app/snapshot, and the
app copies it into its empty data directory at startup, so cold starts on small CPUs are instant.

    VOLTIQ_DATA_DIR=snapshot VOLTIQ_SEED_CSV=seed/ev_charging.csv.gz python prepare_snapshot.py   # paths relative to the project root
"""
from __future__ import annotations

import sys

from sqlalchemy import text

import config
from database import SessionLocal, engine, init_db
from services import data_service, dataset_ops, evaluation


def main() -> int:
    seed = config.SEED_CSV
    if seed is None or not seed.is_file():
        print(f"No seed dataset at {seed}; skipping snapshot.")
        return 0
    init_db()
    dataset_ops.seed_from_csv(seed, evaluate_in_background=False)
    with SessionLocal() as db:
        ds = data_service.get_active_dataset(db)
        if ds is None:
            print("Seeding failed: no active dataset.", file=sys.stderr)
            return 1
        run = evaluation.latest_run(db, ds.id)
        if run is None or run.status != "completed":
            print(f"Evaluation did not complete: {run.message if run else 'no run'}", file=sys.stderr)
            return 1
        print(f"Snapshot ready: dataset #{ds.id}, selected model {run.best_model_key}, data dir {config.DATA_DIR}")
    # Fold the WAL into the main database file so the snapshot is self-contained.
    with engine.connect() as conn:
        conn.execute(text("PRAGMA wal_checkpoint(TRUNCATE)"))
    engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
