# Atlas PDLC Maintainers

> Draft for pilot review — August 31, 2026

**Documentation:** [User Guide](ATLAS_PDLC_README.md) · [Architecture](ATLAS_PDLC_ARCHITECTURE.md) · [Maintainers](ATLAS_PDLC_MAINTAINERS.md)

## Purpose

Atlas PDLC is an extensible Harness framework for AI-assisted software product delivery whose Core Engine, Delivery Flows, PDLC Stages, Disciplines, Skills, Integrations, and Coding Agent Adapters are governed through separate ownership boundaries. The full framework introduction is in the [User Guide](ATLAS_PDLC_README.md), and the underlying model is explained in [Atlas PDLC Architecture](ATLAS_PDLC_ARCHITECTURE.md). The reusable one-page view is the [Atlas PDLC architecture diagram](docs/images/atlas-pdlc-architecture.png).

### Architecture at a glance

![Atlas PDLC architecture overview](docs/images/atlas-pdlc-architecture.png)

[Open the full-resolution Atlas PDLC architecture diagram](docs/images/atlas-pdlc-architecture.png). Use the diagram to identify whether a proposed change belongs to the Delivery Model, Governance and Disciplines, the Core Engine and Runner, a Coding Agent Adapter, or the product-owned workspace.

This guide is for people who maintain or extend Atlas PDLC:

- Harness Engineering;
- PDLC Governance and Stage owners;
- Delivery Flow owners;
- Discipline owners;
- Integration owners;
- project teams maintaining an Atlas Project Overlay.

Read the Architecture before changing a shared contract. Installation and POC operation are covered by the User Guide.

## Corp AI governance boundary

Atlas maintainers operate within Corp's established AI-use governance. Corp determines which Coding Agents, accounts, data classes, environments, external services, and usage patterns are approved. GitHub Copilot is the current approved Coding Agent for the Pilot.

Atlas assets may encode or strengthen Corp requirements, but no Stage, Flow, Discipline asset, Integration, Project Overlay, exception, or Coding Agent Adapter may weaken or bypass them. When a Corp rule must be made enforceable in Atlas, represent it through the owning Policy and Control path with traceable ownership rather than copying informal guidance into multiple Flows or Adapters.

## Current repository baseline

Before extending Atlas, distinguish bundled implementation from extension potential. As of August 31, 2026, the repository contains:

- Pilot Ready `poc` Delivery Flow;
- Developing `product-requirements-analysis` Flow with an active technical implementation and a target during the week of August 31, 2026;
- Developing `implementation` and `pdlc` Flow definitions, targeted for the weeks of August 31 and September 7, 2026 respectively;
- Product Management, UX, Solution Architecture, Security, and Data Platform Discipline packages;
- three UX Skills, one UX Agent, and one UX Hook; other registered Disciplines currently contribute Artifacts, Policies, Knowledge, or no executable contribution as declared by their manifests;
- one Databricks Integration definition with no bundled Integration Skills;
- Product, Developer, and QA Role slots.

Engineering and QA are not currently registered Disciplines. Java, Python, JIRA, and XRAY capabilities are not bundled executable assets. Maintainers may add them through the contracts in this guide, but documentation and Coding Agent Adapters must not present extension potential as installed capability.

## Ownership model

| Owner | Primary responsibilities |
|---|---|
| Harness Engineering | Core, CLI, schemas, persistence, locking, hashing, audit, portability, and the generic extension contracts. |
| PDLC Governance | Canonical Stages, Role Catalog, shared lifecycle semantics, and governance review. |
| Delivery Flow Owner | Stage composition, Flow controls, defaults, constraints, Checkpoints, Record contract, Executor behavior, and lifecycle tests. |
| Discipline Owner | Artifact Definitions, Policies, Knowledge, Skills, Agents, Hooks, applicability, professional approval boundaries, and asset versioning. |
| Integration Owner | External-system manifest, permissions, credential references, bundled Skills, applicability, and connection governance. |
| Project Governance | Approved Baselines, additional Project Policies, Project Defaults, local Knowledge, and project-specific exceptions. |

Ownership metadata supports validation and accountability. Repository review enforcement requires an installed `.github/CODEOWNERS` with real organization users or teams; `.github/CODEOWNERS.template` is not enforcement by itself.

## Stability rules

The Atlas base engine should not change merely because a maintainer adds:

- a canonical Stage;
- a Delivery Flow;
- a Role;
- a Discipline Artifact, Policy, Knowledge asset, Skill, Agent, or Hook;
- an Integration;
- project-specific context.

Core changes are appropriate only when adding or changing a genuinely shared primitive such as lifecycle dispatch, storage, audit, locking, security, schema infrastructure, or the executor contract.

Never add a branch such as `if (deliveryFlow === "...")` to Core or CLI for one Flow's rules. Put specialized deterministic behavior in that Flow's directory and expose it through the executor contract.

## Repository contracts

```text
.pdlc/                         Shared Atlas Harness
  stages/                      Canonical Stage Catalog
  delivery-flows/              Registered Flow definitions and Flow-owned runtime
  disciplines/                 Shared professional assets
  integrations/                Registered external-system boundaries
  roles/                       Role Catalog and definitions
  schemas/                     Portable machine contracts
  core/                        Generic engine and invariant services
  commands/                    Cross-Flow commands
  tests/                       Conformance and regression tests

pdlc/                          Product-project ownership
  disciplines/                 Project Overlay
  requirements/
  evidence/
  artifacts/
  records/
  audit/
  .state/                      Ignored transient state
```

Shared assets belong under `.pdlc/`. Product-specific context and delivery history belong under `pdlc/`. Do not copy a shared Policy or Flow into the Project Overlay.

## Add a Stage

A Stage is reusable work semantics, not lifecycle sequence or approval state.

### 1. Define the Stage

Add one entry to `.pdlc/stages/catalog.json`:

```json
{
  "id": "architecture-spike-review",
  "name": "Architecture spike review",
  "description": "Review the evidence and trade-offs produced by a bounded architecture spike.",
  "phase": "verify",
  "roleSlots": ["developer", "qa"],
  "requirements": [
    "The tested options, evidence, limitations, and recommendation are documented."
  ],
  "outputs": [
    "A reviewed architecture spike conclusion."
  ]
}
```

Use a stable kebab-case ID. Reference only registered Roles and Artifact types.

### 2. Review semantics

Confirm that the Stage:

- represents reusable work rather than one Flow's state transition;
- does not duplicate an existing Stage;
- does not exist only to run context resolution;
- does not imply a human Checkpoint unless a Flow declares one;
- has stable requirements and outputs across its intended Flows.

### 3. Add Flow references

Reference the Stage from each relevant Flow as required or conditional. Conditional references declare activation tags such as technology or risk tags.

### 4. Review applicable assets

Ask each relevant Discipline and Integration owner whether existing assets apply to the new Stage. Update applicability metadata rather than copying assets into the Stage or Flow.

### 5. Test

Add tests for Stage validation, Flow resolution, Role and Artifact references, conditional activation, and applicable context.

## Add a Delivery Flow

A Flow owns lifecycle composition and controls. It never redefines Stage requirements or outputs.

### 1. Choose a stable ID and status

Create:

```text
.pdlc/delivery-flows/<flow-id>/flow.json
```

Use `planned` while a Flow is incomplete. A planned Flow defines composition but must not claim executable lifecycle behavior. Use `active` only after controls, runtime behavior, tests, documentation, and owner approval are complete.

`flow.status` is executable implementation status. The current schema does not provide a separate `preview`, `internal`, or `public` support state. If organizational release scope is narrower than executable status, record that distinction consistently in release documentation and Coding Agent Adapters. Do not leave a Flow marked active and executable in the canonical Skill while public documentation says it must not be used.

### 2. Define a configuration-only Flow

The generic Flow Engine can execute standard lifecycle transitions without a Flow-specific module:

```json
{
  "schemaVersion": 2,
  "id": "architecture-spike",
  "name": "Architecture Spike",
  "description": "Run and review a bounded architecture experiment.",
  "status": "active",
  "stageSequence": [
    { "stageId": "solution-design", "inclusion": "required" },
    { "stageId": "implementation", "inclusion": "required" },
    { "stageId": "developer-verification", "inclusion": "required" },
    { "stageId": "architecture-spike-review", "inclusion": "required" }
  ],
  "controls": {
    "initialStatus": "DRAFT",
    "terminalStatuses": ["APPROVED"],
    "checkpoints": [
      {
        "id": "begin",
        "from": ["DRAFT"],
        "to": "IN_PROGRESS",
        "ownerRole": "developer"
      },
      {
        "id": "approve",
        "from": ["IN_PROGRESS"],
        "to": "APPROVED",
        "ownerRole": "qa"
      }
    ],
    "deliveryDefaults": {
      "roleAssignmentMode": "approval-actor-all-roles",
      "timebox": "2 working days",
      "collectDuringRequirements": false
    },
    "constraints": {
      "productionUse": false,
      "externalIntegrations": [],
      "allowSinglePersonAllRoles": true
    }
  }
}
```

The validator rejects duplicate Checkpoint IDs, an initial state that is terminal, unreachable Checkpoint sources or terminal states, and reachable non-terminal dead ends.

### 3. Register the Flow

Add it explicitly to `.pdlc/delivery-flows/catalog.json`:

```json
{
  "id": "architecture-spike",
  "definition": "architecture-spike/flow.json"
}
```

Creating a directory is not registration. Explicit registration prevents copied, incomplete, or experimental definitions from becoming available accidentally.

### 4. Add a Flow-owned Executor when necessary

Add an `executor.ts` only when the Flow needs deterministic behavior beyond generic transitions. Supported responsibilities include:

- `validateConfiguration`;
- `validateRecord`;
- `prepareInitialization`;
- `checkpoint`;
- `action`;
- `status`;
- `auditSummary`;
- `operationalIssues`;
- terminal-state specialization when declarative terminal states are insufficient.

Declare the runtime in `flow.json`:

```json
{
  "runtime": {
    "executor": "executor.ts",
    "recordSchema": "schemas/architecture-spike-record.schema.json",
    "actions": ["evidence-bind"]
  }
}
```

The executor and its supporting files must remain inside the Flow directory. Keep reusable professional Policy and Knowledge in the owning Discipline, not in the Executor.

### 5. Define the Record contract

Use the generic Delivery Record envelope when it is sufficient. A specialized Flow keeps its additional type, schema, validator, and migration logic inside its Flow directory.

The Record must retain the shared identity, Flow, status, revision, timestamp, assignment, and source fields required by the Flow Engine.

### 6. Validate lifecycle compatibility

Review:

- sequence and conditional Stage tags;
- all reachable states and terminal outcomes;
- Checkpoint authority;
- assignment behavior and separation-of-duty requirements;
- timebox and Requirements profile defaults;
- production and Integration constraints;
- Control, Knowledge, Hook, and Integration applicability;
- compatibility with existing active and terminal Records;
- initialization, status, audit, and operational-integrity behavior.

### 7. Prove extension without base changes

Add an E2E fixture that registers the Flow in a temporary Harness, initializes a Record, resolves Stage context, performs authorized Checkpoints, rejects an unauthorized actor, reaches a terminal state, and preserves Core/CLI fingerprints.

## Change an existing Delivery Flow

A Flow change can alter delivery obligations without changing any Stage definition. Treat it as a governed contract change.

Before merging:

1. document the reason and affected delivery population;
2. review active Record compatibility;
3. add a migration or fail-closed compatibility rule where necessary;
4. review newly applicable or removed Controls and Integrations;
5. update lifecycle and E2E tests;
6. update the public capability table if support status changes;
7. obtain Flow Owner and PDLC Governance approval.

Never silently reinterpret an active Record under a materially changed Flow.

## Discipline Owner Guide

A Discipline Owner turns professional standards, methods, and expertise into reusable Atlas assets. The Discipline owns its content and professional governance; it does not own Delivery Flow state, Core behavior, or Coding Agent Adapter behavior.

### What a Discipline Owner owns

```text
.pdlc/disciplines/<discipline>/
  discipline.json
  artifacts/
  policies/
  knowledge/
    guidance/
    defaults/
    references/
    kb/
  skills/
  agents/
  hooks/
```

The owner is accountable for:

- the Discipline's purpose, maintainers, and professional approval authorities;
- stable asset IDs, semantic versions, and compatibility;
- correct `ownerDiscipline` metadata and safe repository-relative references;
- applicability across Flow, Stage, risk, technology, and Discipline tags;
- required evidence, enforcement behavior, and exception authorities;
- executable-contribution permissions and handoff boundaries;
- tests for discovery, resolution, conflicts, enforcement, and provenance;
- periodic review, deprecation, and migration of its assets.

### Choose the correct asset type

Use the smallest asset type that expresses the professional need clearly:

| Need | Atlas asset | Use it for |
|---|---|---|
| Governed deliverable contract | Artifact Definition | Requirements, Story, ADR, Scope, Package, or another typed deliverable. |
| Mandatory rule | Policy | A requirement that becomes an applicable Control and may require evidence, approval, or a formal exception. |
| Recommended practice | Knowledge: Guidance | Advice that improves Stage work but does not block progress by itself. |
| Automatic replaceable choice | Knowledge: Default | A value Atlas may apply automatically unless a stronger authority locks or replaces it. |
| Example or reusable source | Knowledge: Reference or KB | Reference implementations, examples, standards summaries, or concrete organizational facts. |
| Reusable expert procedure | Skill | A repeatable method the main Agent applies during relevant Stage work. |
| Expert execution behavior | Discipline Agent | Specialized behavior, boundaries, and handoff expectations for a Discipline contribution. |
| Stage activation and permissions | Hook | Binding an Agent and Skills to canonical Stages for eligible Flows with explicit permissions. |

Do not use Knowledge for a mandatory obligation. Do not create a Skill when static Guidance is sufficient, and do not create a Discipline Agent merely to represent a Role or job title.

### End-to-end change workflow

For every new or changed Discipline asset:

1. **Confirm ownership.** Verify that the subject belongs to this Discipline. Coordinate with the other owner instead of duplicating cross-Discipline content.
2. **Identify the delivery need.** Name the affected canonical Stages, Delivery Flows, technologies, risks, and expected outcome.
3. **Choose the asset type.** Use the decision table above. Separate mandatory Policy from advisory Knowledge.
4. **Define applicability.** Scope the asset narrowly enough to resolve only when relevant, without hard-coding lifecycle sequence inside the Discipline.
5. **Author the asset.** Use a stable ID and semantic version, correct ownership metadata, resolvable local references, and the minimum content needed to make it usable.
6. **Define governance.** For mandatory behavior, specify enforcement Stage, evidence, approval or exception authority, and any locked default. For executable behavior, declare permissions and handoff boundaries.
7. **Bind execution only when needed.** Add or update a Hook when a Skill or Discipline Agent must participate in Stage work. Static Artifacts, Policies, and Knowledge do not need a Hook merely to be discoverable.
8. **Test resolution and failure behavior.** Cover positive applicability, non-applicability, invalid references, conflicts, required evidence, permissions, and stale-context behavior as relevant.
9. **Review compatibility.** Determine whether existing Delivery Records, context receipts, adopters, or Project Overlays need migration or fail-closed handling.
10. **Obtain review and release.** Use the review matrix and checklist below, run the repository validation suite, and update capability documentation if the bundled inventory changed.

### Asset-specific guidance

#### Artifact Definitions

Use an Artifact Definition for a governed deliverable contract such as Requirements, a Story, ADR, Scope, or Package. Include only the schemas, profiles, templates, examples, and references required to make the contract usable.

Do not store delivery instances under the shared definition. Project Artifact instances belong under `pdlc/`.

#### Policies

Use a Policy for a mandatory professional, enterprise, or Corp rule. Declare:

- owning Discipline and version;
- applicability and enforcement Stage;
- rules and enforcement mode;
- required evidence;
- approval or exception authority;
- any locked standard default.

An applicable Policy enters the effective Control set. A Discipline Policy may operationalize or strengthen Corp governance, but it cannot weaken it.

#### Knowledge

Use Knowledge for advisory Guidance, replaceable Defaults, References, and KB content. Declare applicability narrowly enough that irrelevant Stages do not resolve it or invalidate their context hashes.

Knowledge does not become blocking merely because it is useful. Create or reference a Policy when enforcement is mandatory.

#### Skills and Discipline Agents

A Skill defines a reusable expert method. A Discipline Agent defines specialized execution behavior and boundaries. Keep each asset self-contained within its Discipline and ensure Skill names match their directories.

These assets advise or perform Stage work. They do not approve Requirements, own Checkpoints, redefine a Stage, or write controlled Record or Audit state.

#### Hooks

A Hook binds an Agent and Skills to canonical Stages. It declares:

- enabled state and version;
- eligible Delivery Flows;
- filesystem, network, and external-write permissions;
- Stage bindings;
- execution mode and handoff;
- approval boundary.

One Discipline may bind a Stage once in one Hook resolution. References must resolve inside the same Discipline. An unbound Stage continues with Core behavior.

### Day-to-day operating responsibilities

Discipline Owners should regularly:

- review assets when Corp policy, professional standards, technology, risk, or supported Flows change;
- verify that applicability still includes the intended work and excludes unrelated Stages;
- review permission grants and remove unused network or external-write access;
- investigate validation failures, Control conflicts, stale context, and recurring exceptions involving their assets;
- version breaking changes and provide an adopter migration path;
- deprecate obsolete assets without silently reusing their IDs;
- keep owner and approver assignments current;
- ensure bundled capability claims match what the Discipline actually provides.

### Discipline asset release checklist

- [ ] The asset belongs to the declared Discipline and has an accountable owner.
- [ ] The correct asset type is used; mandatory requirements are Policies rather than Knowledge.
- [ ] ID, version, metadata, references, and folder placement are valid.
- [ ] Flow, Stage, risk, technology, and Discipline applicability is explicit and tested.
- [ ] Evidence, enforcement, approvals, and exception authority are defined where required.
- [ ] Skill, Agent, and Hook permissions follow least privilege.
- [ ] Corp AI governance and enterprise Policies are preserved or strengthened.
- [ ] Positive, negative, conflict, permission, and provenance tests are proportionate to the change.
- [ ] Breaking-change compatibility, migration, and deprecation are addressed.
- [ ] Documentation and bundled capability inventory are updated when needed.

### Review expectations

| Change | Minimum review |
|---|---|
| Artifact contract | Discipline Owner plus affected Flow and Stage owners |
| Policy | Discipline Policy Approver plus affected governance owner |
| Knowledge | Discipline maintainer |
| Skill or Discipline Agent | Discipline Owner and execution or Coding Agent Adapter reviewer |
| Hook or permission | Discipline Owner, Flow Owner, and Security review when permissions increase |

### Discipline Owner prohibited patterns

Do not:

- change Delivery Flow state, Checkpoint transitions, or Flow-owned defaults from a Discipline asset;
- redefine canonical Stage meaning, requirements, or outputs;
- write controlled Delivery Record or Audit state directly;
- hide a mandatory obligation in advisory Knowledge;
- weaken Corp governance, enterprise Policies, or locked Control decisions;
- copy the same professional rule into multiple Flows, Hooks, or Coding Agent Adapters;
- request network, filesystem, or external-write permissions that the contribution does not need;
- store credentials, secrets, or delivery-specific Artifact instances in the shared Discipline package;
- mark an asset as used without reading or executing it and recording required provenance.

## Add an Integration

Create and explicitly register:

```text
.pdlc/integrations/<integration-id>/
  integration.json
  skills/
    <skill-id>/SKILL.md
```

The Integration owner declares stable identity, version, owners, maintainers, applicability, network requirements, credential references, external-write permission, and bundled Skills.

Do not store credentials or secrets. Do not embed an Integration inside a Discipline. Discipline assets reference the Integration by ID; Flow constraints determine whether it is allowed.

Add tests for registration, applicability, Skill-path safety, permissions, Flow constraints, and any unavailable or fail-closed behavior.

## Configure a Project Overlay

Project-specific context belongs under the shared Discipline that owns the subject:

```text
pdlc/disciplines/<discipline>/
  baseline.json
  policies/
  defaults/
  knowledge/
    guidance/
    references/
    kb/
```

- Use a Baseline for an approved fact that later Stages should not ask again.
- Use a Project Policy for an additional mandatory obligation.
- Use a Project Default for an automatic but replaceable choice.
- Use Project Knowledge for locally relevant advisory context.

The Project Overlay may reference only registered Disciplines. It cannot replace a shared asset, introduce a hidden Integration, weaken an enterprise Policy, or override a locked Control decision.

Project Knowledge uses metadata plus a content reference and must declare applicability. Loose unowned files are invalid.

## Role maintenance

Add a Role only when a delivery needs a formally assigned responsibility or controlled decision right. Do not create a Role merely because a Discipline contributes expertise.

To add a Role:

1. create its human-readable definition under `.pdlc/roles/`;
2. register ID, name, and path in `.pdlc/roles/catalog.json`;
3. reference it from relevant Stage `roleSlots` or Checkpoint `ownerRole`;
4. update Record examples, assignment behavior, and tests;
5. obtain governance review.

## Maintain a Coding Agent Adapter

Coding Agent Adapters expose Atlas through a coding agent's discovery, prompt, tool, and permission conventions. They must remain thin and must load the shared Harness rather than restating its delivery behavior.

The canonical `.agents/skills/lean-pdlc/SKILL.md` is the shared operational contract. `AGENTS.md`, `.github/`, and `.codex/` may provide discovery and permission mapping, but they must not redefine executable Flows, Stages, Checkpoints, Policies, or lifecycle state.

When a Flow or conversational intent becomes executable:

1. update the canonical Skill and executable Flow metadata together;
2. decide which Coding Agent Adapter shortcuts explicitly advertise it;
3. ensure unsupported shortcuts defer to the shared Skill or clearly state their narrower surface;
4. test natural-language activation and supported slash-command forms on each claimed platform;
5. update the User Guide and Architecture capability snapshots.

The current canonical Skill recognizes `poc`, `product-requirements-analysis`, `resume`, `status`, `audit`, and `help`. The current GitHub Copilot `/pdlc` prompt explicitly advertises only `poc`, `resume`, `status`, and `help`. Treat that as a known Coding Agent Adapter exposure difference until the Adapter is deliberately expanded.

`resume <record-id>` currently targets an existing Record conversationally; the Runner does not expose a persistent record-selection operation. A Coding Agent Adapter must not claim that resume changes `pdlc/.state/current` unless such a controlled operation is added and tested.

## Validation and tests

Run from the repository root:

```sh
bun install --cwd .pdlc
bun run --cwd .pdlc typecheck
bun run --cwd .pdlc test
bun run --cwd .pdlc test:e2e
bun .pdlc/cli.ts validate
```

The normal test command already includes the E2E suite; the dedicated command is useful for focused stability verification.

Changes should provide evidence proportional to their impact:

| Change | Required evidence |
|---|---|
| Schema | Positive and negative validation tests; TypeScript and JSON Schema alignment |
| Stage | Catalog validation, references, Flow resolution, and applicable-context tests |
| Flow | Graph validation, initialization, authorized transitions, terminal state, status/audit, and E2E lifecycle |
| Discipline asset | Ownership, applicability, discovery, resolution, enforcement or provenance tests |
| Hook | Agent/Skill resolution, permission boundary, context receipt, and audit tests |
| Integration | Registration, applicability, permission, path, and Flow-constraint tests |
| Core primitive | Focused unit tests, cross-Flow regression tests, portability, rollback, and concurrency tests where relevant |

Validation must fail closed for unknown references, stale context, unsafe paths, missing authority, invalid state graphs, and locked-Control conflicts.

## Release a Delivery Flow

Before advertising a Flow as Pilot Ready:

- [ ] Flow ownership and purpose are explicit.
- [ ] Corp AI, security, privacy, legal, intellectual-property, and data-handling requirements are satisfied.
- [ ] The Flow has complete executable behavior and appropriate implementation status; technical registration alone is not treated as readiness.
- [ ] Canonical Stage sequence is reviewed.
- [ ] Conditional activation tags are tested.
- [ ] State graph has no duplicates, unreachable terminal states, unreachable sources, or dead ends.
- [ ] Checkpoint Roles and assignments are validated.
- [ ] Constraints and delivery defaults are approved.
- [ ] Record schema and migrations are complete.
- [ ] Executor behavior remains inside the Flow directory.
- [ ] Applicable Policies, Knowledge, Hooks, and Integrations resolve correctly.
- [ ] Initialization, status, audit, actions, and operational integrity are tested.
- [ ] A realistic E2E lifecycle passes.
- [ ] Core and CLI do not contain new Flow-ID branches.
- [ ] User and architecture capability tables are updated.
- [ ] Canonical Skill and claimed Coding Agent Adapter entry points agree, or any intentional subset is documented.
- [ ] Pilot limitations and unsupported external writes are explicit.
- [ ] Flow Owner, PDLC Governance, and relevant Discipline/Integration owners approve the release.

## Compatibility and versioning

Treat Stage, Flow, schema, Policy, Artifact, and Record changes as versioned contracts.

- Prefer additive changes that preserve existing Records.
- Do not rename stable IDs without a migration.
- Do not reuse an ID for different semantics.
- Keep deprecated compatibility identifiers until all Coding Agent Adapters and adopting repositories have migrated.
- Reject ambiguous storage or Record migrations rather than guessing.
- Bind controlled approvals and handoffs to content hashes and source revisions.
- Record breaking changes and the required adopter action in the release notes.

The current `lean-pdlc` Skill directory and Coding Agent Adapter filenames are compatibility identifiers. A future rename to Atlas-specific identifiers must update discovery files, validation, documentation, and adopters as one planned migration.

## Prohibited patterns

Do not:

- add Flow-specific ID dispatch to Core or CLI;
- redefine Stage semantics inside a Flow, Hook, Integration, or Coding Agent Adapter;
- treat every Stage as a human Checkpoint;
- put mandatory obligations in advisory Knowledge without a Policy;
- let Project content weaken enterprise Policies;
- store credentials in Integration definitions, Records, or evidence;
- copy shared assets into Coding Agent Adapter folders;
- manually edit controlled Record state or Audit Events to imitate a transition;
- run arbitrary project scripts through the Atlas Runner;
- mark a planned Flow available before its lifecycle and E2E tests pass;
- describe a POC productization recommendation as production approval.
