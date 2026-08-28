# Shared Harness Source

This directory is the platform-neutral source of truth for the Lean PDLC Harness.

| Directory | Purpose | Primary owner |
|---|---|---|
| `core/` | Deterministic validation, readiness, persistence, hash, lock, audit, and state behavior | Harness Engineering |
| `stages/` | Canonical reusable Stage definitions and requirements | PDLC Governance |
| `journeys/` | Ordered User Journey composition and conditional Stage activation | PDLC Governance |
| `workflows/` | Executable status, defaults, constraints, and checkpoints | PDLC Governance |
| `roles/` | Logical delivery responsibilities | PDLC Governance |
| `principles/` | Department-owned enterprise policy | Named professional functions |
| `defaults/harness/` | Generic overrideable defaults | Harness Product Team |
| `templates/` | Shared requirements and questionnaire artifacts | Product Governance |
| `schemas/` | Machine-readable contracts | Harness Engineering |
| `harnesses/` | Platform adapter contracts and portability validation | Developer Experience |
| `integrations/` | External-system contracts and future adapters | Harness Engineering and integration teams |
| `tests/` | Harness regression and conformance tests | Harness Engineering |

`cli.ts` is the only public Runner entry point. Internal modules are not standalone scripts.

See `docs/HARNESS_ARCHITECTURE_AND_OWNERSHIP.md` for the complete architecture and ownership model.
See `docs/STAGE_AND_JOURNEY_MODEL.md` for the Stage catalog, Journey composition, Principle mapping, and change procedure.
