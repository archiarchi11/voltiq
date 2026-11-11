# Seed dataset

`ev_charging.csv.gz` is the NYC "Electric Vehicle (EV) Charging Data – Municipal Lots and Garages" export
(gzip-compressed, identical content). VoltIQ loads it automatically on startup **only when its database is
empty**, so hosted deployments with ephemeral storage (e.g. Render's free plan) are never blank after a restart.
It runs through exactly the same validation → cleaning → model evaluation as an upload from the UI.

Uncompressed `*.csv` files in this folder are not committed. Disable seeding with `VOLTIQ_SEED_CSV=""`.
