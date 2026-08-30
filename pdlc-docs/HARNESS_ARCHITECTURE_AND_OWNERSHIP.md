# Atlas PDLC Harness Architecture and Ownership

## 1. Purpose

The Harness coordinates product delivery while keeping three concerns separate:

1. **Delivery Model** — what work happens and in what order.
2. **Discipline Model** — who owns the artifacts, mandatory Policies, knowledge, Skills, Agents, and Hooks used by that work.
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
- delivery defaults, including the recommended Requirements profile;
- explicit Integration allow-list constraints.

There is no separate Workflow or User Journey model.

### Discipline

A Discipline is an ownership and organization boundary, such as Product Management, UX, Security, Solution Architecture, or Data Platform. A Discipline may own any combination of:

- Artifact Definitions;
- Policies;
- Knowledge;
- Skills;
- Agents;
- Hooks.

A Discipline does not need content in every category. UX can own Policies, guidance, Defaults, Skills, an Agent, and Stage Hooks. Data Platform can initially own only a Databricks KB.

### Artifact Definition

An Artifact Definition is the governed contract for a deliverable such as Requirements, Story, or Productization Package. The owning Discipline defines format, schema, profiles, templates, and examples. Stages consume and produce Artifact type references rather than copying templates.

### Policy and Control

A Policy is an authored mandatory rule stored under the owning Discipline's `policies/` folder. When applicable to a delivery context, it enters the effective Control chain. Each Policy declares applicability, version, owner Discipline, rules, enforcement type, evidence, exception approvers, and any locked standard default. An applicable Policy/Control must be satisfied or formally excepted.

### Knowledge

Knowledge is useful context but is not mandatory by itself:

- Guidance — recommended practices;
- Default — automatic, normally overrideable decisions;
- Reference — examples and reference implementations;
- KB — concrete organizational or technical knowledge.

If knowledge must become enforceable, the owning team creates a Control that references or requires it.

### Skill, Agent, and Hook

A Skill defines reusable expert procedure. An Agent file provides a Discipline-owned role profile. A Hook binds a required Capability to a canonical Stage, that role profile, and an allowlist of candidate Skills while declaring Flow scope, permissions, handoff, and approval boundaries. These assets live directly under their Discipline; the Capability is a stable Hook identity, not a `capabilities/` directory.

### Integration

An Integration is a top-level, explicitly cataloged package for an external system such as JIRA, Xray, or Databricks. It declares owners, maintainers, Flow/Stage applicability, network and credential requirements, and external-write permissions. It may bundle Skills under `.pdlc/integrations/<id>/skills/`; this lets existing system-specific Skills remain usable without making the Integration a Discipline.

To adopt an existing JIRA or Xray Skill, move the complete Skill directory, including any relative scripts and references, to `.pdlc/integrations/<id>/skills/<skill-id>/`, declare its id and relative path in `integration.json`, and register the Integration in `.pdlc/integrations/catalog.json`. Stage context then returns the canonical Skill path whenever the Integration applies. If an Agent platform needs direct Skill discovery, keep only a thin wrapper under its discovery directory (for example `.agents/skills/`) that points to the canonical Integration Skill; do not maintain a second implementation.

### Project Overlay

The Project Discipline Overlay adds project-specific context under `pdlc/disciplines/<discipline>/`:

- `baseline.json` — approved facts that later Stages should not ask again;
- `policies/` — cumulative project-specific mandatory rules;
- `defaults/` — project preferences that can override shared Defaults;
- `knowledge/` — project-local guidance and references, expressed as metadata plus content and filtered by `appliesTo`.

Project content cannot weaken or replace enterprise Controls.

### Delivery Record

The Delivery Record is the execution truth. It stores Flow state, role assignment, Requirements approval hash, risk and technology context, resolved Controls/Baselines/Defaults/Knowledge/Integrations, exceptions, evidence, and outcome.

## 3. Resolution lifecycle

Before every Stage, the Runner resolves context using the selected Flow, active Stage, risk triggers, technologies, and disciplines:

```text
Flow + Stage + delivery context
  -> enterprise Discipline Policies + project Policies (effective Controls)
  -> Project Baselines
  -> locked Control defaults + project Defaults + Discipline Defaults
  -> relevant Discipline Knowledge + project Knowledge
  -> eligible Discipline Hooks, Capabilities, role profiles, and candidate Skills
  -> one context-bound Stage Agent invocation
  -> eligible top-level Integrations and bundled Skills
  -> Stage execution
```

Resolution is a system operation, not a Stage. This is why the old applicability step is absent from v2.

Default precedence is:

1. locked Control default;
2. Project Default;
3. Discipline Default.

Policies are cumulative. Project Policies never replace enterprise Policies in the effective Control set.

## 4. End-to-End Control Chain

The Harness control model is a chain of distinct authorities. They are evaluated together, but they must not be collapsed into one generic policy type because they have different owners, override rules, and enforcement mechanisms.

### 4.1 Control terminology

| Term | Meaning |
|---|---|
| Harness Invariant | A non-configurable integrity or safety rule enforced by Core code or schema |
| Delivery Flow Control | A rule intrinsic to how one Delivery Flow operates |
| Stage Completion Contract | The stable conditions and outputs that define completion of a canonical Stage |
| Discipline Policy | A mandatory professional or enterprise rule owned by an expert Discipline and selected into the Control set when applicable |
| Project Policy | A mandatory project-specific addition in the Project Overlay |
| Baseline / Default | Resolved delivery context; not a Control by itself, but it must not conflict with one |
| Control Exception | A governed authorization to deviate from one applicable Control; never an implicit override |

`Control` means an effective mandatory obligation. Guidance, Defaults, References, KB, and Skill advice do not become mandatory unless a Policy or Flow explicitly requires them.

### 4.2 The complete chain

```text
1. Harness Invariants
   Schema integrity, registered references, content hashes,
   state mutation boundaries, permission boundaries, audit rules
                |
                v
2. Delivery Flow Controls
   Status model, checkpoints, constraints, role/timebox behavior,
   recommended Requirements profile, Integration allow-list, Flow-local controls
                |
                v
3. Stage Completion Contract
   Canonical Stage intent, role slots, requirements, outputs,
   input/output Artifact types
                |
                v
4. Enterprise Discipline Policies
   Mandatory rules selected into the Control set by Flow, Stage, risk, technology,
   and delivery-discipline context
                |
                v
5. Project Policies
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
   Control rules + enforcement mode + enforcement Stage + required evidence
   + exception approvers + provenance
                |
                v
8. Stage Execution and Enforcement
   Agent and Runner apply automatic checks, collect evidence,
   request approval, or stop for a governed exception
                |
                v
9. Evidence, Exception, Checkpoint, and Audit
   Persist hashed Stage Context Applications and Control applications in the Delivery Record;
   evaluate Checkpoints and append audit events
```

The effective obligations for one Stage are therefore:

```text
Harness Invariants
+ Delivery Flow Controls
+ Stage Completion Contract
+ applicable Enterprise Discipline Policies
+ applicable Project Policies
```

### 4.3 Authority and override rules

| Layer | Primary owner | Ordinary project override? | Exception path |
|---|---|---:|---|
| Harness Invariant | Harness Engineering, with relevant governance review | No | Change the versioned Harness contract; no delivery-local bypass |
| Delivery Flow Control | PDLC Governance / Flow owner | No | Change the Flow or use a different approved Flow |
| Stage Completion Contract | PDLC Governance | No | Change the canonical Stage definition through governed review |
| Enterprise Discipline Policy | Discipline policy approver | No | Use the Policy's declared exception approver and evidence process |
| Project Policy | Project governance for the owning Discipline | No | Use the project's governed exception or change process |
| Project Baseline | Project approver | No conversational override | Approve a new baseline revision |
| Project or Discipline Default | Project or Discipline maintainer | Yes, when not Control-locked | Record the replacement and rationale |

Policies compose cumulatively into the effective Control set. A Project Policy may strengthen or specialize an enterprise Policy, but it cannot remove or weaken it. A Default never outranks a Control. A Project Baseline that conflicts with an applicable Policy is a configuration error, not a question for the delivery user.

### 4.4 Applicability and assembly

Discipline and Project Policies may declare applicability across:

- Delivery Flow;
- Stage;
- risk trigger;
- technology;
- delivery-discipline tag.

Different dimensions are combined with `AND`; multiple values inside one dimension are combined with `OR`. Discipline `defaultApplicability` supplies a dimension only when the asset does not declare it explicitly.

Before every Stage, the Runner must:

1. Validate Harness invariants and load the explicitly registered Delivery Flow.
2. Resolve required and conditional Stages from the delivery context.
3. Load the Flow's intrinsic controls and the current Stage Completion Contract.
4. Select applicable enterprise Discipline Policies.
5. Add applicable Project Policies without replacing enterprise Policies.
6. Resolve Project Baselines and Defaults and reject Control conflicts.
7. Produce one provenance-rich effective Control set.
8. Return Controls separately from Knowledge, Discipline contributions, and Integrations.
9. Require the Agent or Runner to satisfy, evidence, approve, or formally except each applicable obligation at its declared `enforceAt` Stage.
10. At a controlled boundary or after material Discipline/Integration use, validate a receipt against the exact resolved asset set and content hash; record Knowledge, Agent, Skill, and Integration use or an explained `not-used` disposition.
11. Persist Context Applications, Control applications, exception references, evidence, Checkpoint decisions, content hashes, and audit events.

Context resolution is a system operation before each Stage; it is not itself a Stage.

### 4.5 Stage Context assurance

Discovery alone does not prove application. v2 therefore uses a lightweight resolve, execute, receipt, and gate contract:

1. `context <stage>` resolves only the requested Stage and returns its registered Role definitions, exact Policies, Knowledge, Discipline contributions, Integrations, a SHA-256 `contextHash`, and at most one `requiredStageInvocation`. This operation is read-only.
2. When required Capabilities exist, the main Agent invokes one generic Stage subagent. That worker reads each Capability's role profile, chooses one or more declared candidate Skills, performs every Capability, and returns separate evidence-backed results. Multiple Capabilities do not create multiple subagent calls.
3. When provenance is material, the Agent submits a schema-version-2 Stage Context Receipt. Policies are acknowledged; Knowledge and Integrations are marked `used` or `not-used`; every required Capability is `used` and records `selectedSkills` plus evidence. One top-level `stageInvocation` records the execution identity and platform trace. The Runner rejects missing Capability coverage, out-of-set Skill choices, mismatched identity or permissions, bad evidence, and stale context.
4. The Runner stores the validated Context Application in the Delivery Record and appends a `STAGE_CONTEXT_APPLIED` audit event. Build Readiness requires current applications for `requirements-clarification` and `build-readiness`. Verify revalidates those Commit-time applications and additionally requires current applications for `implementation`, `developer-verification`, `acceptance-verification`, and the conditional `security-verification` Stage when active.

This mechanism provides deterministic provenance and evidence; it does not claim to inspect an Agent's hidden reasoning. It keeps startup fast because it performs no network access, loads no future Stage, adds no user question, and does not write receipts for analysis-only Stages merely to prove traversal. A typical current-Stage context call remains a small local-file operation.

### 4.6 Enforcement modes and failure behavior

A Discipline or Project Control rule declares one of these enforcement modes:

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

Each rule also declares `enforceAt`. Applicability determines whether the Policy belongs to the delivery context; `enforceAt` determines the Stage at which its automatic check, evidence, or approval becomes blocking. For example, UX implementation evidence is not demanded during Requirements or Build Readiness.

### 4.7 Provenance and review surface

Control reviewers should be able to trace every effective obligation to its source:

| Review concern | Source of truth |
|---|---|
| Harness integrity and non-bypassable rules | `.pdlc/core/`, `.pdlc/schemas/`, and tests |
| Flow lifecycle and intrinsic controls | `.pdlc/delivery-flows/<flow>/flow.json` and `controls/` |
| Stage completion semantics | `.pdlc/stages/catalog.json` |
| Enterprise professional Policies | `.pdlc/disciplines/<discipline>/policies/` |
| Project Policies and Baselines | `pdlc/disciplines/<discipline>/` |
| Effective applications and exceptions | Delivery Record `resolution.controls` |
| Resolved asset use and freshness | Delivery Record `resolution.contextApplications` and `STAGE_CONTEXT_APPLIED` audit events |
| Evidence and controlled decisions | Delivery Record evidence, Checkpoint data, and append-only audit events |

The final Requirements Artifact or readiness summary must disclose applicable Controls, Baselines, Defaults, exceptions, and provenance. Automatic resolution must not become hidden control application.

### 4.8 Current v2 enforcement status

The v2 implementation currently provides:

- schema and reference invariants;
- explicit Delivery Flow registration;
- executable POC constraints and Build Readiness/Commit;
- Stage Completion Contracts;
- enterprise and Project Control resolution;
- locked-Control versus Default conflict detection;
- Requirements content-hash approval binding;
- per-Stage Control enforcement points;
- Verify evidence and current-context enforcement;
- Verify-time revalidation of the approved Requirements content hash and local/remote evidence-reference integrity without network availability checks;
- Decide outcomes limited to `PARKED` and `PRODUCTIZATION_RECOMMENDED`, with rationale, follow-up, and audit events;
- Productization Package validation, required source/evidence/Control references, reuse dispositions, canonical location, and content-hash binding;
- hashed Stage Context Receipts covering Role definitions, Policies, Knowledge, Agents, Skills, and Integrations;
- Delivery Record and audit infrastructure;
- controlled POC initialization with DRAFT validation, Runner-owned timestamps, current-pointer coordination, `DELIVERY_FLOW_CREATED`, and rollback on persistence failure;
- coordinated Record and Audit persistence for Build Readiness, Context Application, Verify, and Decide, with revision-checked Record rollback when audit persistence fails;
- a read-only audit summary with lifecycle milestones, per-record event filtering, evidence and Control indexes, and missing-event warnings;
- a read-only operational status summary with current Stage, next-action availability, known blockers, applied context, Requirements/evidence readiness, and just-in-time Productization Package readiness;
- Discipline Hook and Integration permission metadata.

The POC path now executes `commit`, `verify`, and `decide`. Implementation and end-to-end PDLC Flows, arbitrary automatic-rule evaluator registration, and production/release integration remain planned. Their absence must not be represented as a passed control.

## 5. Roles and collaboration

### 5.1 What a Role means

A Role is a logical delivery-accountability slot. It is not a job title, person, Discipline, Agent, or approval group. The Role Catalog at `.pdlc/roles/catalog.json` is the source of truth; each entry points to a human-readable responsibility definition in the same folder.

The initial Roles are Product, Developer, and QA. Product owns product intent, Requirements, scope, business rules, acceptance conditions, and approval. Developer owns solution design, implementation, developer verification, and technical evidence. QA owns verification strategy, independent evidence, and acceptance findings. One person may fill multiple slots unless an applicable Control requires separation of duties.

### 5.2 Relationship to the delivery model

| Concept | Role relationship |
|---|---|
| Stage | `roleSlots` declares the accountable or participating Roles for that reusable work unit |
| Delivery Flow | Active Stages determine required Role assignments; a Checkpoint `ownerRole` declares controlled decision authority |
| Delivery Record | `assignments` binds each required logical Role to a concrete identity for one delivery |
| Policy / Control | Control approval and exception approvers are governed identities or groups; they are not implicitly Delivery Roles |
| Discipline | A Discipline owns expert content and governance; it does not automatically create a delivery Role |
| Agent / Skill / Hook | An Agent performs work using Skills when a Hook matches a Stage; it may serve one or more Role responsibilities but is not itself a Role |
| Knowledge / Integration | Resolved by delivery context and Stage, not by Role membership |

The Runner validates every Stage and Checkpoint Role reference against the Role Catalog. It derives required assignments from the currently active Stages plus Checkpoint owners. The configured POC assignment strategy can therefore bind the Build Readiness actor to every required Role without naming Product, Developer, or QA in Core code.

### 5.3 Role versus expert contribution

Do not create a Role merely because an expert team participates. UX, Solution Architecture, Security, and Data Platform normally contribute through Discipline Policies, Knowledge, Skills, Agents, and Hooks. Add a formal Role only when the responsibility needs at least one of the following:

- an explicit identity in every applicable Delivery Record;
- accountable ownership of a Stage result;
- independent Checkpoint decision authority;
- a governed separation-of-duties requirement.

For example, architecture guidance belongs to the Solution Architecture Discipline. An `architect` Role is justified only if a Flow requires an assigned Architect or an Architect-owned controlled decision.

### 5.4 Adding a Role

Adding a Role does not require Core, CLI, TypeScript type, or schema-enum changes:

1. Create `.pdlc/roles/<role-id>.md` with the logical responsibilities and boundaries.
2. Register its id, display name, and definition path in `.pdlc/roles/catalog.json`.
3. Add the Role id to relevant Stage `roleSlots`.
4. Optionally use it as a Delivery Flow Checkpoint `ownerRole` when it owns that decision.
5. Update affected Delivery Record examples or migrations and add a reference/assignment test.

Unknown Role references, missing definition files, unknown Delivery Record assignments, and missing assignments required by an active Flow fail validation or readiness deterministically.

### 5.5 Expert-team collaboration

Expert teams contribute through Discipline ownership rather than attending every delivery:

| Team | Typical ownership |
|---|---|
| Product Management | Requirements, Story, and Productization Package Artifacts, product-quality Policies, authoring guidance |
| UX | Experience Policies, guidance, reference UI, Skills, Agents, and Hooks |
| Solution Architecture | Architecture Policies, design guidance and references |
| Security | Security Policies and verification guidance |
| Data Platform | Platform KB, references, and Discipline expertise |
| Integration Platform | Top-level external-system Integrations and their permission boundaries |
| Harness Engineering | Core registries, schemas, Runner, resolution, tests |
| PDLC Governance | Stage Catalog and Delivery Flow Catalog/definitions |

Ownership metadata explains responsibility. Discipline assets use `ownerDiscipline`; top-level Integrations declare their own `owners` and `maintainers`. GitHub review routing is enforced only after an adopter replaces the sample handles in `.github/CODEOWNERS.template` and installs it as `.github/CODEOWNERS`.

## 6. Folder contract

```text
.pdlc/disciplines/<discipline>/
  discipline.json
  artifacts/<artifact>/
    artifact.json
    schema.json
    templates/
    examples/
  policies/*.policy.json
  knowledge/
    guidance/*.json + content
    defaults/*.json
    references/*.json + content
    kb/*.json + content
  skills/<skill>/SKILL.md
  agents/<agent>.agent.md
  hooks/*.json

.pdlc/integrations/
  catalog.json
  <integration>/
    integration.json
    skills/<skill>/SKILL.md  # optional
```

Only create categories that the Discipline actually owns.

Reusable Harness source and project delivery state use separate namespaces:

```text
pdlc/
  records/
  audit/
  disciplines/<discipline>/
    baseline.json
    policies/
    defaults/
    knowledge/
  requirements/
  evidence/
  artifacts/
  .state/
    inbox/
    current
    locks/
```

Records and audit logs are committed project history. The Runner creates transient `pdlc/.state/` content only when required; it is ignored by version control and is not part of the empty repository skeleton.

## 7. Configure a Project

Project-specific configuration belongs under `pdlc/` in the product repository. It supplements shared assets under `.pdlc/disciplines/`; it does not copy or replace them.

### 7.1 Choose the owning Discipline

Put each decision under the existing shared Discipline that owns the subject. For example:

```text
pdlc/disciplines/solution-architecture/
  baseline.json
  policies/
    repository-boundaries.policy.json
  defaults/
    web-stack.json
  knowledge/
    guidance/
      system-context.json
      system-context.md
```

The folder name must match a Discipline registered under `.pdlc/disciplines/`. The Runner rejects unknown Discipline names. If a project needs a genuinely new professional Discipline, add it to the shared Harness through the normal governance process instead of inventing a project-only Discipline.

### 7.2 Choose the configuration type

| Project need | Location | Runtime meaning |
|---|---|---|
| Record an approved fact or decision that later Stages should not ask again | `baseline.json` | Authoritative project context |
| Add a mandatory project rule | `policies/*.policy.json` | Cumulative blocking Control |
| Preselect a recommended project choice | `defaults/*.json` | Automatically applied, normally overrideable Default |
| Supply project-local explanation, reference, or technical context | `knowledge/guidance/`, `knowledge/references/`, or `knowledge/kb/` | Advisory Knowledge resolved by applicability |

Use one `baseline.json` per configured Discipline. Add only the other subfolders the project actually needs.

Examples:

- An already-approved modular-monolith architecture belongs in the Solution Architecture baseline.
- A mandatory repository boundary belongs in a Solution Architecture project Control.
- The project's standard TypeScript web stack belongs in a Project Default.
- A system landscape diagram or connection guide belongs in project Knowledge.

Every project Knowledge asset must declare `ownerDiscipline`, version, kind, `appliesTo`, and `contentRef`. Loose files directly under `knowledge/` are invalid. This keeps unrelated Knowledge out of a Stage Context and prevents irrelevant changes from invalidating its receipt.

The legacy `pdlc/config/disciplines/` layout is rejected rather than silently ignored. Migrate each Discipline directory directly to `pdlc/disciplines/` before running a Delivery Flow.

Discipline Skills, Agents, and Hooks are shared expert assets, not project configuration. External-system connections remain under `.pdlc/integrations/`. Both receive explicit ownership and permission review.

### 7.3 Precedence and governance rules

- Enterprise and project Controls are cumulative. A project Control may add obligations but cannot weaken or replace an enterprise Control.
- A locked Control decision has higher precedence than every Default.
- A Project Default has higher precedence than a Discipline Default when no locked Control prevents the override.
- Project Knowledge is advisory unless an applicable Control explicitly requires it.
- Baselines and Controls must carry the approval metadata required by their schemas and project governance.
- Keep project configuration in version control with the product so changes are reviewable and auditable.

Effective Default precedence is:

```text
locked Control decision
  > Project Default
  > Discipline Default
```

### 7.4 Configuration workflow

1. Identify the Discipline that owns the decision.
2. Select `baseline`, `policies`, `defaults`, or `knowledge` based on the semantics above.
3. Start from the [Project Configuration example](../.pdlc/examples/project-overlay/README.md) when a structured file is needed.
4. Add the smallest configuration necessary and obtain the appropriate project or Discipline-owner review.
5. Ask the Harness Agent to validate the repository. The Agent runs the internal validation and reports unknown Disciplines, invalid schemas, owner mismatches, and locked-Control conflicts.
6. Commit the configuration with the product repository. On each Stage entry, the Runner resolves it automatically; users should not be asked to reconfirm an approved baseline or an applied Default.

### 7.5 Keep configuration separate from delivery state

`pdlc/disciplines/` is authored as project context. The remaining `pdlc/` folders contain project-owned delivery artifacts and controlled history:

| Path | Ownership |
|---|---|
| `pdlc/records/` | Runner-managed Delivery Records |
| `pdlc/requirements/` | Product Requirements Artifacts maintained through clarification and approval |
| `pdlc/evidence/` | Build, test, review, and approval evidence |
| `pdlc/audit/<record-id>.jsonl` | Runner-managed append-only audit events for one Delivery Record |
| `pdlc/.state/current` | Runner-managed active-record pointer, created only when needed |
| `pdlc/.state/locks/` | Transient Runner locks; never project configuration |
| `pdlc/artifacts/` | Future project-owned Stories, Designs, Plans, and other Artifact instances |

The workspace itself identifies the project, so `pdlc/` does not add a project-name level. Use a separate workspace for another project or POC. One workspace may keep many completed Delivery Records, but only one may be active in a checkout. Completed records, their source revisions, and hash-bound artifacts are shared project history that later Development and QA deliveries may consume.

Do not place configuration in a runtime folder, and do not manually edit controlled state or audit fields to simulate a successful transition.

## 8. Governance Model

Discipline, Owner/Approver/Maintainer, and Contribution Mode are metadata and repository governance, not another runtime layer.

- `discipline.json` declares owners, policy approvers, maintainers, and a contribution mode for Artifacts, Policies, Knowledge, Skills, Agents, and Hooks. Each category is `restricted`, `reviewed`, or `open`.
- An installed `.github/CODEOWNERS` maps folders to review teams; the repository template alone is documentation, not enforcement.
- Asset validators require `ownerDiscipline` consistency.
- Controls declare exception approvers.
- Discipline Hook descriptors and Integration manifests declare permissions.

This gives clear accountability without creating a separate governance folder hierarchy.

## 9. Safety properties

- Only explicitly cataloged Delivery Flows are loadable.
- A Flow references canonical Stage ids and cannot redefine Stage semantics.
- Stage Artifact references must resolve to one Discipline-owned definition.
- An asset's `ownerDiscipline` must match its folder.
- A Project Configuration Overlay may reference only known Disciplines.
- Locked Control defaults cannot be overridden by project or Discipline Defaults.
- Discipline Hook contributions and Integrations retain permission and approval boundaries.
- Requirements approval is content-hash bound.
- Controlled state changes go through the Runner and audit log.
