# Shared Harness source

This directory is the platform-neutral source of truth for the Lean PDLC Harness.

| Directory | Purpose | Primary owner |
|---|---|---|
| `core/` | Registries, resolution, readiness, persistence, locking, state, and audit behavior | Harness Engineering |
| `stages/` | Canonical reusable work units | PDLC Governance |
| `delivery-flows/` | Explicit Flow Catalog, Stage composition, checkpoints, constraints, and Flow Controls | PDLC Governance |
| `domains/` | Domain-owned Artifacts, Controls, Knowledge, Plugins, and Adapters | Named expert teams |
| `roles/` | Logical delivery responsibilities | PDLC Governance |
| `schemas/` | Machine-readable contracts | Harness Engineering |
| `platform-adapters/` | Thin Codex/Copilot adapter contracts and portability checks | Developer Experience |
| `tests/` | Conformance and regression tests | Harness Engineering |

`cli.ts` is the public internal Runner entry point. Platform adapters must not duplicate shared delivery or governance logic.
