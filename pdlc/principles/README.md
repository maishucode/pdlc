# Principle Pack Ownership

Each subfolder is owned by the professional function named in `ownership.json`. Professional functions define standards but do not normally participate in every delivery.

A folder becomes executable policy only when it contains a valid, reviewed `pack.json`. Reserved folders contain ownership guidance only and are not loaded by the Harness.

Behavioral changes require a semantic version increase. Locked enterprise constraints cannot be weakened by project or Harness defaults.

Each pack maps itself to canonical Stage ids through `appliesTo.stages`. The Runner validates these references against `pdlc/stages/catalog.json` and derives the reverse Stage-to-Pack view; do not maintain a competing mapping file.
