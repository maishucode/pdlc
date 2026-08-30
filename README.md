# Atlas PDLC Harness v2

Atlas PDLC is a portable, policy-aware delivery Harness for running POC, implementation, and end-to-end product delivery through one shared model.

The v2 architecture is intentionally small:

- A **Stage** is a reusable work unit.
- A **Delivery Flow** composes Stages and owns lifecycle controls such as checkpoints, constraints, role-assignment behavior, and timebox.
- A **Role** is a cataloged logical accountability slot used by Stages, Checkpoints, and Delivery Record assignments.
- A **Discipline** is the expert-team ownership boundary for Artifacts, mandatory Policies, advisory Knowledge, Skills, Agents, and Hooks.
- An **Integration** is a cataloged external-system connection such as JIRA, Xray, or Databricks. It may bundle Skills and always declares ownership and permissions.
- A **Project Overlay** records approved project decisions and project-specific additions without copying the shared Harness.
- A **Delivery Record** stores execution state, resolved context, decisions, exceptions, and evidence.

There is no separate Workflow or User Journey model. Both are represented by Delivery Flow. There is no Principle Pack or Plugin runtime concept in v2: mandatory content is a Policy applied as a Control; recommended content is Knowledge; executable expert behavior is represented directly by Discipline Skills, Agents, and Hooks.

`Discipline` is deliberately reserved for professional delivery expertise such as Product Management, Security, Architecture, UX, and Data Platform. A product's business model may use an explicitly named `businessDomain` concept later; it is not part of the Discipline registry or activation tags.

## Architecture at a glance

```text
Delivery Flow
  -> ordered canonical Stages
  -> checkpoints, constraints, artifact profiles, role/timebox defaults

Before each Stage
  -> resolve mandatory Discipline and project Policies as Controls
  -> apply Project Baselines and resolved Defaults
  -> retrieve relevant Guidance, References, and KB
  -> compile required Discipline Capabilities through Hooks
  -> batch them into one generic Stage Agent invocation
  -> resolve eligible top-level Integrations and bundled Skills

Stage execution
  -> selects relevant candidate Skills inside the Stage Agent
  -> returns one evidence-backed result per Capability
  -> reads and produces Discipline-owned Artifacts
  -> applies a hashed Stage Context Receipt after the work is done
  -> updates the Delivery Record and evidence
```

The four context channels remain separate because they have different semantics:

| Channel | Meaning | Blocking? |
|---|---|---|
| Policies / Controls | Policies are authored rules; applicable mandatory rules enter the Control chain | Yes |
| Project Baselines and Defaults | Approved project facts and automatic choices | Baselines are authoritative; Defaults are overrideable unless Control-locked |
| Knowledge | Guidance, defaults, references, and concrete KB | No, unless referenced by a Control |
| Execution contributions | Discipline Skills/Agents/Hooks plus top-level Integrations | Only when applicable to the Flow and Stage |

## Repository layout

```text
.pdlc/
  package.json
  bun.lock
  tsconfig.json
  stages/catalog.json
  delivery-flows/
    catalog.json
    poc/flow.json
    implementation/flow.json
    pdlc/flow.json
  disciplines/
    product-management/
      artifacts/
      policies/
      knowledge/
      skills/
      agents/
      hooks/
    ux/
    solution-architecture/
    security/
    data-platform/
  integrations/
    catalog.json
    databricks/integration.json
  roles/
    catalog.json
    product.md
    developer.md
    qa.md
  schemas/
  core/
  tests/
  cli.ts

pdlc/
  records/                 # versioned Delivery Records
  audit/                   # append-only, per-record audit logs
  disciplines/<discipline>/
    baseline.json
    policies/
    defaults/
    knowledge/               # metadata + content, filtered by appliesTo
  requirements/
  evidence/
  artifacts/
  .state/                  # local current pointer, inbox, and locks; not committed
```

The ownership rule is: `.pdlc/` contains reusable Harness definitions, code, and its package/tooling metadata; `pdlc/` contains one product project's versioned delivery history and local Runner state. A workspace supports one project, but may retain many terminal Delivery Records. There is at most one active Delivery Record in a checkout. Every shared professional asset lives under its owning Discipline inside `.pdlc/disciplines/`.

## Current implementation

The POC and Product Requirements Analysis Delivery Flows are executable. Implementation and end-to-end PDLC Flows are registered and validated but remain planned until their checkpoint and integration behavior is implemented.

Bundled Disciplines demonstrate the model:

- Product Management owns Requirements, Story, Sprint Scope, Change Proposal, and Productization Package Artifact Definitions, requirements quality Policies, and authoring guidance.
- UX owns experience Policies, design guidance, web-POC Defaults, Skills, an Agent, and Stage Hooks.
- Solution Architecture owns reversible-delivery Controls and minimum-design guidance/defaults.
- Security owns credential and sensitive-data Controls.
- Data Platform owns the Databricks connectivity KB example; the external connection is registered separately under `.pdlc/integrations/databricks/`.

The Knowledge and Integration remain separate assets: the KB explains company usage, while the Integration declares connection permissions and applicability.

## Runner

The Agent owns Runner calls; end users should not be asked to execute Bun commands.

Internal Runner operations include:

```text
bun .pdlc/cli.ts init --root <project> --input pdlc/.state/inbox/<POC-ID>.json --actor <identity>
bun .pdlc/cli.ts validate
bun .pdlc/cli.ts status --root <project>
bun .pdlc/cli.ts audit summary --root <project> [--record <id>]
bun .pdlc/cli.ts migrate storage --root <project>
bun .pdlc/cli.ts artifacts bind --root <project> --input <binding.json> --actor <identity>
bun .pdlc/cli.ts context <stage-id> --root <project>
bun .pdlc/cli.ts context-apply <stage-id> --root <project> --receipt <receipt.json> --actor <identity>
bun .pdlc/cli.ts readiness build --root <project> --record <id> --actor <identity>
bun .pdlc/cli.ts discipline list
bun .pdlc/cli.ts discipline sync --root <project>
bun .pdlc/cli.ts integration list
```

`context` is the normal Stage-resolution API. It returns the current Stage's registered Roles, Controls, Baselines, Defaults, Knowledge, Discipline contributions, Integrations, a deterministic `contextHash`, and at most one `requiredStageInvocation`. That invocation batches every required same-Stage Capability into one generic subagent call; each Capability keeps a separate selected-Skill result and evidence record. After the Stage work, `context-apply` validates the execution identity, Capability coverage, selected Skill subsets, evidence integrity, and context freshness. Build Readiness and verification reject missing, invalid, or stale receipts. `guidance` is the narrower Discipline-contribution view.

`audit summary` is a read-only projection over the selected Delivery Record and append-only Audit Log. It reports the current conclusion, Build Readiness, Verify and Decide milestones, a concise timeline, evidence references, satisfied, excepted, and pending Controls, and warnings when record state has no matching audit event. It never replaces or modifies the underlying Audit Events.

`status` is the read-only operational view. It reports the current canonical Stage and state, allowed and unavailable next actions, known blockers, Requirements approval, evidence readiness, applied Policies/Knowledge/Skills, Control dispositions, and Productization Package readiness. It derives routine status from the current Delivery Record and recorded Context Applications; only a verified POC triggers the just-in-time package check.

Before Verify, the Runner re-hashes the approved Requirements document and rejects any unapproved content change. It also validates that local evidence references stay inside the project workspace and resolve to readable regular files; URL and CI evidence must be valid HTTP or HTTPS references, but no network availability check is performed. Build Readiness, Context Application, Verify, and Decide persist the updated Record and matching Audit Event through one coordinated mutation boundary. If audit persistence fails, the previous Record revision is restored.

`init` is the only supported new-delivery state creation path. It validates a revision-zero DRAFT from `pdlc/.state/inbox/`, confirms that its Requirements shell exists inside the project workspace, assigns Runner-owned timestamps, creates the Delivery Record, makes it current, and appends the content-hash-bound `DELIVERY_FLOW_CREATED` event. Invalid input causes no state write; a later persistence failure rolls back the new Record and current pointer. The consumed inbox file is removed after success.

Product Requirements Analysis approves Requirements, binds versioned Story snapshots, and approves a hash-bound Sprint Scope. JIRA keys are optional mappings; this phase performs no external writes. A downstream delivery consumes an explicit subset of the approved Story hashes plus the upstream Record, source revision, and Scope hash. Material changes use a Change Proposal and a new Scope version; a selected Story change blocks downstream work until it explicitly rebases.

`migrate storage` is the one-time controlled move from legacy `.pdlc/runtime/` data into the project-owned layout. It refuses ambiguous merges when both layouts contain data and splits the legacy global audit stream into per-record logs.

This assurance does not add startup questions, network calls, or a full-Harness scan. The Runner hashes only the already-resolved local files for the current Stage, and receipt persistence happens after Stage work rather than before the first clarification round.

## Adding an asset

- New Stage: add it once to `.pdlc/stages/catalog.json`, then reference it from registered Delivery Flows and applicable Discipline assets.
- New Delivery Flow: create and register `.pdlc/delivery-flows/<id>/flow.json`. Configuration-only lifecycles run on the generic engine; special deterministic behavior belongs in a Flow-owned `executor.ts` declared by `runtime.executor`, without Core or CLI changes.
- New Role: add its definition under `.pdlc/roles/`, register it in `.pdlc/roles/catalog.json`, and reference it from the relevant Stage or Checkpoint. Core code does not change.
- New mandatory Policy or Knowledge asset: place it in the owning Discipline and declare applicability metadata.
- New expert behavior: add a Skill or Agent directly under the Discipline and bind it to Stages through `hooks/`.
- New external system: create `.pdlc/integrations/<id>/integration.json`, optionally include `skills/`, and register it in `.pdlc/integrations/catalog.json`.
- Project-specific decision or Knowledge: place it under the owning `pdlc/disciplines/<discipline>/`; do not fork shared definitions or create a top-level Knowledge dump.

See [Harness Architecture and Ownership](pdlc-docs/HARNESS_ARCHITECTURE_AND_OWNERSHIP.md), [Delivery Flow Model](pdlc-docs/DELIVERY_FLOW_MODEL.md), and [Target Architecture](pdlc-docs/HARNESS_TARGET_ARCHITECTURE.md).

## Validate

```bash
bun run --cwd .pdlc typecheck
bun run --cwd .pdlc test
bun .pdlc/cli.ts validate
```

The leading `./` in the test path is required because Bun otherwise treats the hidden Harness directory as a non-path filter.
