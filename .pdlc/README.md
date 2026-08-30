# Shared Harness source

This hidden directory is owned by the Atlas PDLC Harness and Runner. Product teams author project configuration and delivery artifacts under the visible `pdlc/` workspace instead of editing Harness files here.

| Directory | Purpose | Primary owner |
|---|---|---|
| `package.json`, `bun.lock`, `tsconfig.json` | Harness-local package boundary, dependency lock, and TypeScript configuration | Harness Engineering |
| `commands/` | Cross-Flow context, validation, and compatibility commands | Harness Engineering |
| `core/` | Data-driven Flow Engine, registries, persistence, locking, state, and audit primitives | Harness Engineering |
| `stages/` | Canonical reusable work units | PDLC Governance |
| `delivery-flows/` | Explicit Flow Catalog, Stage composition, checkpoints, constraints, and Flow Controls | PDLC Governance |
| `disciplines/` | Discipline-owned Artifacts, Policies, Knowledge, Skills, Agents, and Hooks | Named expert teams |
| `integrations/` | Cataloged external-system connections and their optional bundled Skills | Integration Platform and named owners |
| `roles/` | Explicit Role Catalog and logical delivery responsibility definitions | PDLC Governance |
| `schemas/` | Machine-readable contracts | Harness Engineering |
| `platform-adapters/` | Thin Codex/Copilot adapter contracts and portability checks | Developer Experience |
| `tests/` | Conformance and regression tests | Harness Engineering |

`cli.ts` is the public internal Runner entry point. Platform adapters must not duplicate shared delivery or governance logic.

Harness package metadata stays inside `.pdlc/` so an adopting product repository remains free to own its root package manifest, lockfile, and TypeScript configuration. Maintainer scripts run with `.pdlc/` as their working directory; direct Runner calls continue to use `bun .pdlc/cli.ts` from the project root.

In this model, a Discipline is a professional delivery practice, not a product business domain. Future business decomposition should use an explicit project-owned `businessDomain` concept rather than entering the shared Discipline registry.

Runner-managed project data lives with the project: versioned Records and audit logs under `pdlc/records/` and `pdlc/audit/`, and transient pointers, inbox drafts, and locks under ignored `pdlc/.state/`. The Harness never owns project delivery state under `.pdlc/`.

## Runtime architecture

The Runner uses four dependency layers:

1. `cli.ts` parses arguments, invokes the Flow Engine or a cross-Flow command, and normalizes errors.
2. `core/flow-engine.ts` resolves the selected Flow, loads its optional executor, derives terminal state from Flow controls, and coordinates generic initialization, checkpoint, status, action, audit, and validation behavior.
3. `delivery-flows/<id>/flow.json` owns lifecycle data. A Flow that needs rules beyond generic transitions keeps an `executor.ts` in the same folder and declares it through `runtime.executor`; the CLI and Core do not import individual Flows.
4. `commands/` contains cross-Flow context and validation operations, while the remaining Core modules provide reusable registries, context resolution, locking, and atomic Record-plus-audit primitives.

A configuration-only Flow needs no executor. Declare its Stage sequence, statuses, checkpoints, owners, defaults, and constraints, then register it. Add a Flow-owned executor only for special validation, initialization, actions, checkpoint gates, status projections, or operational-integrity checks. A new Flow or new requirements-analysis rule must not add an `if (deliveryFlow === ...)` branch to Core or CLI.

Read-only checks may run in parallel. Controlled mutations remain serialized through optimistic revision checks and locks. A command loads each required model view once; startup and ordinary conversational work remain just-in-time.

Discipline Hooks declare required Capabilities, Agent role profiles, and candidate Skills. Context resolution batches all same-Stage Capabilities into one generic subagent invocation. The worker selects Skills per Capability, while one Stage-level execution Receipt and separate Capability contributions provide the evidence checked by Flow readiness and checkpoints.
