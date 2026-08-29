# Lean PDLC Harness Architecture and Ownership

## 1. Purpose

The Harness coordinates product delivery while keeping three concerns separate:

1. **Delivery Model** — what work happens and in what order.
2. **Domain Model** — who owns the artifacts, mandatory rules, knowledge, and capabilities used by that work.
3. **Execution State** — what this delivery resolved, decided, approved, and evidenced.

This separation lets the platform stay small while allowing expert teams and project teams to contribute independently.

## 2. Core concepts

### Stage

A Stage is a canonical reusable work unit. It defines stable intent, role slots, requirements, outputs, and optional input/output Artifact types. It does not define sequence and is not automatically a human checkpoint.

### Delivery Flow

A Delivery Flow is the single lifecycle composition concept. It contains:

- ordered Stage references;
- required or conditional inclusion;
- activation tags;
- statuses and terminal outcomes for executable Flows;
- checkpoints;
- Flow constraints;
- role-assignment and timebox behavior;
- Artifact profiles and required Capabilities.

There is no separate Workflow or User Journey model.

### Domain

A Domain is an ownership and organization boundary, such as Product Management, UX, Security, Solution Architecture, or Data Platform. A Domain may own any combination of:

- Artifact Definitions;
- Controls;
- Knowledge;
- Plugins;
- Integration Adapters.

A Domain does not need content in every category. UX can own Controls, guidance, Defaults, and a Plugin. Data Platform can initially own only a Databricks KB.

### Artifact Definition

An Artifact Definition is the governed contract for a deliverable such as Requirements or Story. The owning Domain defines format, schema, profiles, templates, and examples. Stages consume and produce Artifact type references rather than copying templates.

### Control

A Control is mandatory. Each policy declares applicability, version, owner Domain, rules, enforcement type, evidence, exception approvers, and any locked standard default. An applicable Control must be satisfied or formally excepted.

### Knowledge

Knowledge is useful context but is not mandatory by itself:

- Guidance — recommended practices;
- Default — automatic, normally overrideable decisions;
- Reference — examples and reference implementations;
- KB — concrete organizational or technical knowledge.

If knowledge must become enforceable, the owning team creates a Control that references or requires it.

### Plugin

A Plugin contributes Stage-aware agent behavior and Skills. It declares owner Domain, supported Delivery Flows, permissions, Stage bindings, and approval boundaries. A Plugin extends the Harness; it does not own Flow state or governance decisions.

### Integration Adapter

An Integration Adapter encapsulates authenticated access to an external system and declares network, credential, and external-write permissions. It remains distinct from Plugin because connection concerns and orchestration concerns evolve differently. A Plugin may invoke an Adapter.

### Project Overlay

The Project Configuration Overlay adds project-specific context under `.pdlc/config/domains/<domain>/`:

- `baseline.json` — approved facts that later Stages should not ask again;
- `controls/` — cumulative project-specific mandatory rules;
- `defaults/` — project preferences that can override shared Defaults;
- `knowledge/` — project-local guidance and references.

Project content cannot weaken or replace enterprise Controls.

### Delivery Record

The Delivery Record is the execution truth. It stores Flow state, role assignment, Requirements approval hash, risk and technology context, resolved Controls/Baselines/Defaults/Knowledge/Capabilities, exceptions, evidence, and outcome.

## 3. Resolution lifecycle

Before every Stage, the Runner resolves context using the selected Flow, active Stage, risk triggers, technologies, and domains:

```text
Flow + Stage + delivery context
  -> enterprise Controls + project Controls
  -> Project Baselines
  -> locked Control defaults + project Defaults + Domain Defaults
  -> relevant Domain Knowledge + project Knowledge
  -> eligible Plugins and Integration Adapters
  -> Stage execution
```

Resolution is a system operation, not a Stage. This is why the old applicability step is absent from v2.

Default precedence is:

1. locked Control default;
2. Project Default;
3. Domain Default.

Controls are cumulative. Project Controls never replace enterprise Controls.

## 4. End-to-End Control Chain

The Harness control model is a chain of distinct authorities. They are evaluated together, but they must not be collapsed into one generic policy type because they have different owners, override rules, and enforcement mechanisms.

### 4.1 Control terminology

| Term | Meaning |
|---|---|
| Harness Invariant | A non-configurable integrity or safety rule enforced by Core code or schema |
| Delivery Flow Control | A rule intrinsic to how one Delivery Flow operates |
| Stage Completion Contract | The stable conditions and outputs that define completion of a canonical Stage |
| Domain Control | A mandatory professional or enterprise rule owned by an expert Domain |
| Project Control | A mandatory project-specific addition in the Project Overlay |
| Baseline / Default | Resolved delivery context; not a Control by itself, but it must not conflict with one |
| Control Exception | A governed authorization to deviate from one applicable Control; never an implicit override |

`Control` means mandatory. Guidance, Defaults, References, KB, and Plugin advice do not become mandatory unless a Control or Flow explicitly requires them.

### 4.2 The complete chain

```text
1. Harness Invariants
   Schema integrity, registered references, content hashes,
   state mutation boundaries, permission boundaries, audit rules
                |
                v
2. Delivery Flow Controls
   Status model, checkpoints, constraints, role/timebox behavior,
   Artifact profiles, required Capabilities, Flow-local controls
                |
                v
3. Stage Completion Contract
   Canonical Stage intent, role slots, requirements, outputs,
   input/output Artifact types
                |
                v
4. Enterprise Domain Controls
   Mandatory rules selected by Flow, Stage, risk, technology,
   and delivery-domain context
                |
                v
5. Project Controls
   Additional mandatory rules from the Project Overlay;
   cumulative with enterprise Controls
                |
                v
6. Baseline and Default Conflict Resolution
   Apply approved Project Baselines and resolved Defaults;
   reject conflicts with locked or applicable Controls
                |
                v
7. Effective Control Set
   Control rules + enforcement mode + required evidence
   + exception approvers + provenance
                |
                v
8. Stage Execution and Enforcement
   Agent and Runner apply automatic checks, collect evidence,
   request approval, or stop for a governed exception
                |
                v
9. Evidence, Exception, Checkpoint, and Audit
   Persist applications and references in the Delivery Record;
   evaluate Checkpoints and append audit events
```

The effective obligations for one Stage are therefore:

```text
Harness Invariants
+ Delivery Flow Controls
+ Stage Completion Contract
+ applicable Enterprise Domain Controls
+ applicable Project Controls
```

### 4.3 Authority and override rules

| Layer | Primary owner | Ordinary project override? | Exception path |
|---|---|---:|---|
| Harness Invariant | Harness Engineering, with relevant governance review | No | Change the versioned Harness contract; no delivery-local bypass |
| Delivery Flow Control | PDLC Governance / Flow owner | No | Change the Flow or use a different approved Flow |
| Stage Completion Contract | PDLC Governance | No | Change the canonical Stage definition through governed review |
| Enterprise Domain Control | Domain policy approver | No | Use the Control's declared exception approver and evidence process |
| Project Control | Project governance for the owning Domain | No | Use the project's governed exception or change process |
| Project Baseline | Project approver | No conversational override | Approve a new baseline revision |
| Project or Domain Default | Project or Domain maintainer | Yes, when not Control-locked | Record the replacement and rationale |

Controls compose cumulatively. A Project Control may strengthen or specialize an enterprise Control, but it cannot remove or weaken it. A Default never outranks a Control. A Project Baseline that conflicts with an applicable Control is a configuration error, not a question for the delivery user.

### 4.4 Applicability and assembly

Domain and Project Controls may declare applicability across:

- Delivery Flow;
- Stage;
- risk trigger;
- technology;
- delivery-domain tag.

Different dimensions are combined with `AND`; multiple values inside one dimension are combined with `OR`. Domain `defaultApplicability` supplies a dimension only when the asset does not declare it explicitly.

Before every Stage, the Runner must:

1. Validate Harness invariants and load the explicitly registered Delivery Flow.
2. Resolve required and conditional Stages from the delivery context.
3. Load the Flow's intrinsic controls and the current Stage Completion Contract.
4. Select applicable enterprise Domain Controls.
5. Add applicable Project Controls without replacing enterprise Controls.
6. Resolve Project Baselines and Defaults and reject Control conflicts.
7. Produce one provenance-rich effective Control set.
8. Return Controls separately from Knowledge and Capabilities.
9. Require the Agent or Runner to satisfy, evidence, approve, or formally except each applicable obligation at the appropriate point.
10. Persist Control applications, exception references, evidence, Checkpoint decisions, content hashes, and audit events.

Context resolution is a system operation before each Stage; it is not itself a Stage.

### 4.5 Enforcement modes and failure behavior

A Domain or Project Control rule declares one of these enforcement modes:

| Mode | Expected behavior |
|---|---|
| `automatic` | The Runner or deterministic validator evaluates the rule |
| `evidence` | Delivery supplies traceable evidence and the relevant Stage or Checkpoint evaluates it |
| `approval` | An authorized role or policy owner explicitly approves the rule's disposition |

If an applicable Control cannot be satisfied:

1. stop the affected Stage or Checkpoint;
2. identify the exact Control and rule;
3. identify missing evidence or the declared exception approver;
4. record an approved exception reference if one is granted;
5. never convert the failure into an ordinary Default override.

Harness Invariants do not use the delivery-level Control exception mechanism. Failing an invariant blocks execution until the Harness definition, state, or referenced asset is corrected.

### 4.6 Provenance and review surface

Control reviewers should be able to trace every effective obligation to its source:

| Review concern | Source of truth |
|---|---|
| Harness integrity and non-bypassable rules | `pdlc/core/`, `pdlc/schemas/`, and tests |
| Flow lifecycle and intrinsic controls | `pdlc/delivery-flows/<flow>/flow.json` and `controls/` |
| Stage completion semantics | `pdlc/stages/catalog.json` |
| Enterprise professional Controls | `pdlc/domains/<domain>/controls/` |
| Project Controls and Baselines | `.pdlc/config/domains/<domain>/` |
| Effective applications and exceptions | Delivery Record `resolution.controls` |
| Evidence and controlled decisions | Delivery Record evidence, Checkpoint data, and append-only audit events |

The final Requirements Artifact or readiness summary must disclose applicable Controls, Baselines, Defaults, exceptions, and provenance. Automatic resolution must not become hidden control application.

### 4.7 Current v2 enforcement status

The v2 implementation currently provides:

- schema and reference invariants;
- explicit Delivery Flow registration;
- executable POC constraints and Build Readiness;
- Stage Completion Contracts;
- enterprise and Project Control resolution;
- locked-Control versus Default conflict detection;
- Requirements content-hash approval binding;
- Delivery Record and audit infrastructure;
- Plugin and Integration Adapter permission metadata.

Formal `commit`, `verify`, and `decide` state transitions, generalized per-rule evidence evaluation, and production/release integration remain planned. Their absence must not be represented as a passed control.

## 5. Roles and collaboration

Product owns product intent, Requirements, scope, business rules, acceptance conditions, and approval. Developer owns solution design, implementation, developer verification, and technical evidence. QA owns verification strategy, independent evidence, and acceptance findings. One person may fill multiple slots unless an applicable Control requires separation of duties.

Expert teams contribute through Domain ownership rather than attending every delivery:

| Team | Typical ownership |
|---|---|
| Product Management | Requirements and Story Artifacts, product-quality Controls, authoring guidance |
| UX | Experience Controls, guidance, reference UI, UX Plugin |
| Solution Architecture | Architecture Controls, design guidance and references |
| Security | Security Controls and verification guidance |
| Data Platform | Platform KB, references, and Integration Adapters |
| Harness Engineering | Core registries, schemas, Runner, resolution, tests |
| PDLC Governance | Stage Catalog and Delivery Flow Catalog/definitions |

Ownership metadata explains responsibility. CODEOWNERS enforces review routing. Runtime resolution uses `ownerDomain`, not team names.

## 6. Folder contract

```text
pdlc/domains/<domain>/
  domain.json
  artifacts/<artifact>/
    artifact.json
    schema.json
    templates/
    examples/
  controls/*.policy.json
  knowledge/
    guidance/*.json + content
    defaults/*.json
    references/*.json + content
    kb/*.json + content
  capabilities/
    plugins/<plugin>/plugin.json
    adapters/<adapter>/adapter.json
```

Only create categories that the Domain actually owns.

Project-specific configuration and persistent delivery state use a separate namespace:

```text
.pdlc/
  config/domains/<domain>/
    baseline.json
    controls/
    defaults/
    knowledge/
  records/
  requirements/
  evidence/
  audit/
```

The Runner creates the transient `.pdlc/locks/` directory and the `.pdlc/current` active-record pointer only when required. They are not part of the empty repository skeleton.

## 7. Configure a Project

Project-specific configuration belongs under `.pdlc/config/` in the product repository. It supplements shared assets under `pdlc/domains/`; it does not copy or replace them.

### 7.1 Choose the owning Domain

Put each decision under the existing shared Domain that owns the subject. For example:

```text
.pdlc/config/domains/solution-architecture/
  baseline.json
  controls/
    repository-boundaries.policy.json
  defaults/
    web-stack.json
  knowledge/
    system-context.md
```

The folder name must match a Domain registered under `pdlc/domains/`. The Runner rejects unknown Domain names. If a project needs a genuinely new professional Domain, add it to the shared Harness through the normal governance process instead of inventing a project-only Domain.

### 7.2 Choose the configuration type

| Project need | Location | Runtime meaning |
|---|---|---|
| Record an approved fact or decision that later Stages should not ask again | `baseline.json` | Authoritative project context |
| Add a mandatory project rule | `controls/*.policy.json` | Cumulative blocking Control |
| Preselect a recommended project choice | `defaults/*.json` | Automatically applied, normally overrideable Default |
| Supply project-local explanation, reference, or technical context | `knowledge/` | Advisory Knowledge |

Use one `baseline.json` per configured Domain. Add only the other subfolders the project actually needs.

Examples:

- An already-approved modular-monolith architecture belongs in the Solution Architecture baseline.
- A mandatory repository boundary belongs in a Solution Architecture project Control.
- The project's standard TypeScript web stack belongs in a Project Default.
- A system landscape diagram or connection guide belongs in project Knowledge.

Plugins and Integration Adapters are not project configuration. They remain under the owning shared Domain's `capabilities/` directory so their permissions, dependencies, and approval boundaries receive expert-team review.

### 7.3 Precedence and governance rules

- Enterprise and project Controls are cumulative. A project Control may add obligations but cannot weaken or replace an enterprise Control.
- A locked Control decision has higher precedence than every Default.
- A Project Default has higher precedence than a Domain Default when no locked Control prevents the override.
- Project Knowledge is advisory unless an applicable Control explicitly requires it.
- Baselines and Controls must carry the approval metadata required by their schemas and project governance.
- Keep project configuration in version control with the product so changes are reviewable and auditable.

Effective Default precedence is:

```text
locked Control decision
  > Project Default
  > Domain Default
```

### 7.4 Configuration workflow

1. Identify the Domain that owns the decision.
2. Select `baseline`, `controls`, `defaults`, or `knowledge` based on the semantics above.
3. Start from the [Project Configuration example](../pdlc/examples/project-overlay/README.md) when a structured file is needed.
4. Add the smallest configuration necessary and obtain the appropriate project or Domain-owner review.
5. Ask the Harness Agent to validate the repository. The Agent runs the internal validation and reports unknown Domains, invalid schemas, owner mismatches, and locked-Control conflicts.
6. Commit the configuration with the product repository. On each Stage entry, the Runner resolves it automatically; users should not be asked to reconfirm an approved baseline or an applied Default.

### 7.5 Keep configuration separate from delivery state

Only `.pdlc/config/` is authored as project configuration. The other `.pdlc/` paths serve the running Delivery Flow:

| Path | Ownership |
|---|---|
| `.pdlc/records/` | Runner-managed Delivery Records |
| `.pdlc/requirements/` | Product Requirements Artifacts maintained through clarification and approval |
| `.pdlc/evidence/` | Build, test, review, and approval evidence |
| `.pdlc/audit/` | Runner-managed append-only audit events |
| `.pdlc/current` | Runner-managed active-record pointer, created only when needed |
| `.pdlc/locks/` | Transient Runner locks; never project configuration |

Do not place configuration in a runtime folder, and do not manually edit controlled state or audit fields to simulate a successful transition.

## 8. Governance Model

Domain, Owner/Approver/Maintainer, and Contribution Mode are metadata and repository governance, not another runtime layer.

- `domain.json` declares owners, policy approvers, maintainers, and a contribution mode for Artifacts, Controls, Knowledge, and Capabilities. Each category is `restricted`, `reviewed`, or `open`.
- CODEOWNERS maps folders to review teams.
- Asset validators require `ownerDomain` consistency.
- Controls declare exception approvers.
- Plugin and Adapter manifests declare permissions.

This gives clear accountability without creating a separate governance folder hierarchy.

## 9. Safety properties

- Only explicitly cataloged Delivery Flows are loadable.
- A Flow references canonical Stage ids and cannot redefine Stage semantics.
- Stage Artifact references must resolve to one Domain-owned definition.
- An asset's `ownerDomain` must match its folder.
- A Project Configuration Overlay may reference only known Domains.
- Locked Control defaults cannot be overridden by project or Domain Defaults.
- Plugin contributions retain permission and approval boundaries.
- Requirements approval is content-hash bound.
- Controlled state changes go through the Runner and audit log.
