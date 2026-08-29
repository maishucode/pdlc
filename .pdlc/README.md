# Shared Harness source

This hidden directory is owned by the Lean PDLC Harness and Runner. Product teams author project configuration and delivery artifacts under the visible `pdlc/` workspace instead of editing Harness files here.

| Directory | Purpose | Primary owner |
|---|---|---|
| `commands/` | Use-case orchestration behind the thin Runner entry point | Harness Engineering |
| `core/` | Registries, resolution, readiness, persistence, locking, state, and audit behavior | Harness Engineering |
| `stages/` | Canonical reusable work units | PDLC Governance |
| `delivery-flows/` | Explicit Flow Catalog, Stage composition, checkpoints, constraints, and Flow Controls | PDLC Governance |
| `domains/` | Domain-owned Artifacts, Policies, Knowledge, Skills, Agents, and Hooks | Named expert teams |
| `integrations/` | Cataloged external-system connections and their optional bundled Skills | Integration Platform and named owners |
| `roles/` | Explicit Role Catalog and logical delivery responsibility definitions | PDLC Governance |
| `schemas/` | Machine-readable contracts | Harness Engineering |
| `platform-adapters/` | Thin Codex/Copilot adapter contracts and portability checks | Developer Experience |
| `tests/` | Conformance and regression tests | Harness Engineering |
| `runtime/` | Runner-managed Delivery Records, Stage Context Applications, audit events, active pointer, and transient locks | Harness Engineering |

`cli.ts` is the public internal Runner entry point. Platform adapters must not duplicate shared delivery or governance logic.

## Runtime architecture

The Runner uses three dependency layers:

1. `cli.ts` is the composition root: it parses arguments, routes commands, and normalizes errors. It does not load registries or construct context snapshots directly.
2. `commands/` contains use-case orchestration. Context/resource operations and full validation are separate modules with shared command option types.
3. `core/` owns reusable models and invariants. `harness-context.ts` provides command-scoped model views, project overlay composition, Stage resolution, snapshot creation, and parallel receipt-freshness checks. `flow-guard.ts`, `approval-contract.ts`, and `controlled-mutation.ts` own authorization, approved-contract integrity, and atomic Record-plus-audit persistence respectively.

Read-only checks may run in parallel. Controlled mutations remain serialized through optimistic revision checks and locks. A command loads each required model view once; startup and ordinary conversational work remain just-in-time.
