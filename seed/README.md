# Seed dataset (optional)

Place a charging-session CSV here as `ev_charging.csv` to have VoltIQ load it automatically on startup
whenever its database is empty (the hosted demo uses this so a restarted container is never blank).
It goes through exactly the same validation → cleaning → model evaluation as an upload from the UI.

CSV files in this folder are not committed to git. Disable seeding with `VOLTIQ_SEED_CSV=""`.
