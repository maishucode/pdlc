# PDLC Harness Target Architecture

> Status: v2 architecture baseline, implemented on the `v2` branch
> Purpose: Define the Harness platform model for product teams and provide the design baseline for continued evolution.
> Important: The foundational contracts, registries, Domain assets, Project Overlay, context resolution, Runner integration, and POC path are implemented. Some domain breadth and the planned Implementation/PDLC execution paths remain future work.

## 1. Purpose

The PDLC Harness is not intended to encode the entire delivery lifecycle in one large script, nor does it require every project to follow the same heavyweight process. It is a composable, governed, and extensible delivery platform that enables an Agent to:

- Select an appropriate Delivery Flow for the delivery objective.
- Perform delivery work through reusable Stages.
- Automatically apply enterprise and project rules, approved decisions, and defaults.
- Ask users only about product decisions that remain unresolved.
- Enforce deterministic validation, approvals, evidence, and audit at material control points.
- Load relevant domain knowledge, reference implementations, Plugins, and Integration Adapters.
- Preserve the same delivery semantics across Codex, GitHub Copilot, and other Agent platforms.

This document serves two audiences:

- Product and delivery teams, who need to understand how the Harness reduces repeated decisions while preserving necessary governance.
- Harness and professional domain teams, who need a clear target model for shared assets, ownership, runtime behavior, and repository structure.

## 2. Executive Summary

The target architecture is based on the following decisions:

1. Use one orchestration concept, `Delivery Flow`. Do not maintain separate Workflow and User Journey models.
2. A `Stage` is a reusable unit of delivery work. A Stage is not automatically a human Checkpoint.
3. A `Delivery Flow` composes Stages and defines the controls that belong to that type of delivery.
4. Organize professional assets around stable `Domains`, such as UX, Security, Product Management, and Solution Architecture.
5. Use a Domain-first, Type-second repository structure.
6. Keep mandatory controls separate from content that enables or accelerates delivery.
7. Remove `Principle Pack` as a first-class concept in the target model.
8. Principles may remain as natural-language Guidance.
9. Define Requirements, Stories, ADRs, and similar deliverables through `Artifact Definitions`.
10. Treat Plugins and Integration Adapters as Capabilities, while preserving their distinct contracts and permission boundaries.
11. Treat Governance as cross-cutting ownership metadata and repository enforcement, not as a separate runtime layer or content hierarchy.
12. Let projects provide approved baselines, project rules, defaults, and local knowledge through a `Project Overlay`.
13. Keep the Runner focused on deterministic resolution, enforcement, state transitions, evidence, and audit. It must not become an arbitrary project script executor.

In one sentence:

> Delivery Flows orchestrate delivery, Stages define reusable work, Domains provide Artifacts, Controls, Knowledge, and Capabilities, Project Overlays provide project-specific decisions and rules, the Runner enforces deterministic behavior, and the Agent provides the collaborative delivery experience.

## 3. Architecture at a Glance

```text
Delivery User / Agent
          |
          v
Platform Adapter
Codex / GitHub Copilot / Other Agent Platforms
          |
          v
Delivery Model
Delivery Flow + Canonical Stages + Delivery Roles
          |
          v
Context Resolution
Flow + Stage + Risk + Technology + Domain + Project Overlay
          |
          +-------------------+--------------------+
          |                   |                    |
          v                   v                    v
Controls & Guardrails   Knowledge & Enablement   Capabilities
Mandatory outcomes      Agent context and help   Executable extensions
          |                   |                    |
          v                   v                    v
Runner Enforcement       Agent Context       Permission Boundary
          |                   |                    |
          +-------------------+--------------------+
                              |
                              v
                  Delivery Record / Artifacts
                  Evidence / Decisions / Audit
```

For product teams, the platform can be understood as two broad content areas:

- `Controls & Guardrails`: what must be satisfied.
- `Enablement`: how teams can deliver faster and more effectively.

Internally, Enablement is separated into two runtime channels:

- `Knowledge`: read-only Guidance, Defaults, Reference Implementations, and organization-specific knowledge.
- `Capabilities`: Plugins and Adapters that execute behavior or access external systems.

This internal separation is necessary because knowledge and executable extensions have different trust, permission, versioning, and failure models.

## 4. Core Concepts

### 4.1 Stage

A Stage is a reusable unit of delivery work. It defines:

- The intent of the work.
- The primary delivery role slots.
- Input and output Artifact types.
- The basic conditions required to complete the work.

A Stage does not define its position in every Delivery Flow and does not copy professional Domain Policies.

A Stage is also not automatically a human approval. Most Stages can be completed continuously with Agent assistance. Only material decisions should become controlled Checkpoints.

### 4.2 Delivery Flow

Delivery Flow is the single delivery orchestration concept. It represents paths such as POC, Implementation, and end-to-end PDLC.

A Delivery Flow is responsible for:

- Selecting and ordering Canonical Stages.
- Activating Conditional Stages from delivery context.
- Defining Flow-owned Checkpoints.
- Defining delivery controls such as role collection, timebox, and requirements depth.
- Selecting required Artifact Profiles and Capabilities.

A Delivery Flow must not redefine Stage semantics or copy UX, Security, Architecture, or other Domain Policies.

### 4.3 Delivery Role

A Delivery Role represents logical accountability within one delivery, for example:

- Product.
- Developer.
- QA.
- A risk-specific Approver.

One person may fill multiple Delivery Roles unless an applicable Policy requires separation of duties.

Delivery Roles are different from Domain Owners, Policy Approvers, and Maintainers. The former execute a delivery; the latter govern reusable shared assets.

### 4.4 Domain

A Domain represents a stable professional capability and organizational ownership boundary, for example:

- Product Management.
- UX.
- Solution Architecture.
- Security.
- Quality.
- Data Platform.
- Operations.
- AI Governance.

A Domain is the primary organizational unit for shared professional assets. A team should be able to inspect its Domain folder and understand all of the following assets that it owns:

- Artifact Definitions.
- Controls.
- Knowledge.
- Capabilities.

Every asset has one owning Domain, but it may apply to multiple Stages, Delivery Flows, technologies, risks, or consumer Domains.

### 4.5 Artifact Definition

An Artifact Definition describes the logical contract of a delivery artifact, such as:

- Requirements Document.
- Story.
- Architecture Decision Record.
- Test Plan.
- Release Evidence.

It defines:

- Logical fields or required sections.
- Required data and structural validation.
- Supported Profiles, such as lightweight, standard, and comprehensive.
- Default templates.
- Examples.

An Artifact Definition does not own approval policy or writing guidance. Approval and quality thresholds belong to Controls. Authoring advice belongs to Guidance.

### 4.6 Controls & Guardrails

A Control represents a mandatory outcome or rule. Policy is the primary declaration form for Controls.

A Policy should state:

- The concrete outcome that must be satisfied.
- When it applies.
- How it is enforced.
- What evidence is required.
- Who may approve an exception.

The enforcement model should remain small and explicit:

```text
automatic   The Runner or another tool can validate it automatically.
evidence    Auditable evidence must be supplied.
approval    An authorized role must approve it.
```

A conditional requirement is expressed through `appliesTo` or another explicit condition. The target model does not need a mixed `risk-based principle` concept.

### 4.7 Knowledge & Enablement

Knowledge helps people and Agents perform work effectively, but it does not directly block a delivery. It contains four categories:

```text
guidance/     Best practices, principles, and methods.
defaults/     Default decisions or implementations that may be replaceable.
references/   Reference implementations, examples, and reusable samples.
kb/           How-to guides, FAQs, runbooks, and organization-specific knowledge.
```

A Principle may continue to exist as a form of Guidance. When a Principle is made concrete and enforceable, it becomes a Policy.

### 4.8 Capability

A Capability is an extension that can execute behavior. The target architecture has two primary Capability types.

#### Plugin

A Plugin provides specialized Agent capability during applicable Stages, for example:

- Requirements Analysis.
- UX Review.
- Architecture Review.
- Security Review.

A Plugin may contribute Agents, Skills, tools, or Stage bindings. It must not bypass the Runner, applicable Policy, Checkpoints, or controlled state boundaries.

#### Integration Adapter

An Integration Adapter connects the Harness to an external enterprise system, for example:

- JIRA.
- XRAY.
- Databricks.
- Figma.
- CI/CD.
- Deployment platforms.

An Adapter remains distinct from a Plugin because it commonly involves network access, credentials, external writes, and system permissions. A Plugin may request an Adapter capability, but it must not privately own credentials or bypass the Capability Runtime.

### 4.9 Platform Adapter

A Platform Adapter exposes the shared Harness to Codex, GitHub Copilot, or another Agent platform.

It is responsible only for:

- Entry points and discovery.
- Platform capability declarations.
- Mapping platform approval interactions.

It must not define or copy Delivery Flows, Stages, Domain Policies, or Runner behavior.

### 4.10 Runner and Core

The Runner is the deterministic internal Harness API. It is responsible for:

- Schema and reference validation.
- Delivery Flow and Conditional Stage resolution.
- Domain and Project Overlay resolution.
- Separate Control, Knowledge, and Capability outputs.
- Readiness and Checkpoint validation.
- Controlled state transitions, concurrency protection, and atomic writes.
- Artifact content hashes and approval binding.
- Evidence and audit.

The Runner must not run arbitrary project builds, tests, deployments, or dependency installation commands. Those remain responsibilities of the project toolchain and CI/CD environment.

## 5. Domain-First Content Model

Shared professional content uses a Domain-first, Type-second structure:

```text
domains/
  <domain>/
    domain.json
    artifacts/
    controls/
    knowledge/
    capabilities/
```

This structure has several benefits:

- A professional team maintains one clearly owned folder.
- Domain Policies, Knowledge, and Capabilities can evolve together in one change.
- CODEOWNERS and approval responsibilities are easier to configure.
- Every shared asset has an obvious accountable owner.
- The runtime can still resolve each internal type independently and apply its own permission model.

The following Type-first structure is not recommended as the primary organization model:

```text
controls/ux/
knowledge/ux/
plugins/ux/
adapters/ux/
```

It distributes one professional team's assets across several top-level folders and makes ownership and coordinated changes harder to manage.

## 6. Domain Structure

Each Domain uses the following internal structure:

```text
<domain>/
├── domain.json
├── artifacts/
├── controls/
├── knowledge/
│   ├── guidance/
│   ├── defaults/
│   ├── references/
│   └── kb/
└── capabilities/
    ├── plugins/
    └── adapters/
```

Empty folders do not need to be created. A Domain should contain only the asset types it actually owns and maintains.

### 6.1 Domain Manifest

`domain.json` is the Domain's governance and discovery entry point:

```json
{
  "id": "ux",
  "name": "User Experience",
  "owners": ["ux-team"],
  "policyApprovers": ["ux-governance"],
  "maintainers": ["ux-practice"],
  "contributionMode": {
    "artifacts": "reviewed",
    "controls": "restricted",
    "knowledge": "open",
    "capabilities": "reviewed"
  },
  "defaultApplicability": {
    "technologies": ["web-ui", "mobile-ui"]
  }
}
```

The Domain manifest does not need to list every file. The folder conventions and per-asset metadata remain the source of discovery, while the manifest provides stable ownership and default applicability.

## 7. UX Domain Example

A mature UX Domain may contain Controls, Knowledge, and Capabilities, but every category is optional.

```text
domains/ux/
  domain.json

  controls/
    accessibility.policy.json
    dark-patterns.policy.json
    usability-validation.policy.json

  knowledge/
    guidance/
      ux-principles.md
      form-design.md
    defaults/
      design-system.json
    references/
      accessible-form/
    kb/
      requesting-ux-review.md
      accessibility-testing.md

  capabilities/
    plugins/
      ux-review/
    adapters/
      figma/
```

The placement test is simple:

| UX asset | Location | Runtime meaning |
|---|---|---|
| User interfaces must meet the enterprise accessibility baseline | `controls/` | Failure blocks delivery or requires an exception |
| Form design best practices | `knowledge/guidance/` | Recommended practice |
| Enterprise Design System | `knowledge/defaults/` | Default implementation |
| Accessible Form sample | `knowledge/references/` | Reference implementation |
| How to request UX Review | `knowledge/kb/` | Organization-specific knowledge |
| Automated UX Review | `capabilities/plugins/` | Specialized Agent capability |
| Figma access | `capabilities/adapters/` | External system capability |

Controls define non-negotiable outcomes. Knowledge provides ways to achieve them. The same statement should not be duplicated in both locations.

## 8. Product Management and Requirements

Requirement is not itself a Domain. A Requirements Document is an Artifact produced by a Requirements-related Stage.

Product Management is a Domain because it represents a stable professional capability and ownership boundary. It may own:

- Requirements and Story Artifact Definitions.
- Requirements quality and approval Policies.
- Authoring Guidance, templates, and examples.
- Requirements Analysis and Story Review Plugins.

Target structure:

```text
domains/product-management/
  domain.json

  artifacts/
    requirements/
      artifact.json
      schema.json
      templates/
        lightweight.md
        default.md
      examples/
        example-requirements.md

    story/
      artifact.json
      schema.json
      templates/
        default.md
      examples/
        example-story.md

  controls/
    requirements-quality.policy.json
    requirements-approval.policy.json
    story-readiness.policy.json

  knowledge/
    guidance/
      requirements-writing.md
      story-writing.md
      acceptance-criteria.md
      clarification-method.md

  capabilities/
    plugins/
      requirements-analysis/
      story-review/
```

The responsibilities are separated as follows:

| Question | Authoritative location |
|---|---|
| Which sections must a Requirements Document contain? | Artifact schema |
| Which logical fields must a Story contain? | Artifact schema |
| What should the default document look like? | Artifact template |
| Must contradictions be resolved and decisions traceable? | Domain Control |
| How should Acceptance Criteria be written? | Guidance |
| How does the Agent detect ambiguity? | Plugin |
| How many questions may a POC ask in one round? | Delivery Flow Control |
| Where is a delivery's Requirements Document stored? | `.pdlc/` runtime Artifact |

A Stage references Artifact types without copying their internal structure:

```json
{
  "id": "requirements-clarification",
  "produces": ["product-management.requirements"]
}
```

A Delivery Flow may select an Artifact Profile. For example, a POC may use `lightweight`, while formal end-to-end PDLC may use `comprehensive`.

## 9. Governance and Ownership

Governance is not a separate content layer and does not require a top-level `governance/` hierarchy. It is expressed through Domain metadata and repository enforcement.

The relevant governance identities are:

- `Owner`: accountable for the Domain as a whole.
- `Policy Approver`: authorized to approve formal Control and Policy changes.
- `Maintainer`: responsible for routine maintenance of Knowledge, Artifact Definitions, and Capabilities.

Who may propose a change is a repository contribution concern. Who may approve official content is a governance concern enforced through CODEOWNERS, Branch Protection, and review policy.

The Harness may validate ownership metadata and display provenance in delivery records. It should not attempt to replace Git platform authorization.

Governance identities are different from Delivery Roles:

| Identity type | Question answered |
|---|---|
| Domain Owner or Policy Approver | Who defines and approves a reusable rule? |
| Delivery Role holder | Who performs or accepts the work for this delivery? |

Professional owners do not need to participate in every delivery. Their approved assets are resolved automatically. Direct involvement is required only for policy changes, exceptions, or escalated risks.

## 10. Project Overlay

Shared Domains define enterprise-wide rules, knowledge, and capabilities. A project adds approved architecture, project rules, defaults, and local knowledge under `.pdlc/project/` as a sparse overlay.

```text
.pdlc/project/
  project.json

  domains/
    solution-architecture/
      baseline.json
      controls/
        module-boundaries.policy.json
      defaults/
        implementation-defaults.json
      knowledge/
        architecture-overview.md
        module-map.md

    ux/
      baseline.json
      controls/
        design-system.policy.json
      defaults/
        ux-defaults.json
      knowledge/
        product-ux-guide.md

    data-platform/
      baseline.json
      controls/
        databricks-access.policy.json
      defaults/
        data-platform-defaults.json
      knowledge/
        project-databricks.md
```

The Project Overlay distinguishes four kinds of project content.

### 10.1 Project Baseline

A Baseline records an approved and stable project decision, such as:

- Architecture style.
- Frontend framework.
- Backend runtime.
- Persistence technology.
- Deployment platform.
- API style.

The Resolver treats an approved Baseline as resolved context. Future Delivery Flows do not ask the user to decide it again. Changing it requires the appropriate project change process.

Example:

```json
{
  "domain": "solution-architecture",
  "status": "approved",
  "approvedBy": "project-architecture-owner",
  "approvedAt": "2026-08-29",
  "decisions": {
    "architectureStyle": "modular-monolith",
    "frontendFramework": "React",
    "backendRuntime": "Java 21",
    "persistence": "PostgreSQL",
    "deploymentPlatform": "Kubernetes",
    "apiStyle": "REST"
  },
  "references": [
    "knowledge/architecture-overview.md",
    "knowledge/module-map.md"
  ]
}
```

### 10.2 Project Control

A Project Control is a project-specific mandatory rule, for example:

- A module must not directly query tables owned by another module.
- Cross-module calls must use a public interface.
- New pages must use the project's approved Design System.

Project Controls are added to enterprise Controls. They cannot remove or weaken enterprise constraints.

### 10.3 Project Default

A Project Default is automatically applied but may be replaced for a specific delivery with a recorded rationale, for example:

- Default test framework.
- Default logging format.
- Default API documentation tool.

### 10.4 Project Knowledge

Project Knowledge contains information that is specific to the current project, for example:

- Module maps.
- Project terminology.
- Deployment topology.
- Databricks workspace, catalog, and schema usage.
- Project-specific runbooks.

Credentials must never be stored in Project Knowledge. It may record a Secret reference or the approved process for obtaining access.

## 11. Resolution and Precedence

Before entering a Stage, the Harness resolves applicable content from:

```text
Delivery Flow
+ Active Stage
+ Risk
+ Technology
+ Business or Technical Domain
+ Project Overlay
= Resolved Execution Context
```

The Resolver returns three independent runtime channels:

```text
controls      -> enforced by the Runner
knowledge     -> loaded into the Agent context
capabilities  -> exposed only after permission validation
```

### 11.1 Control Composition

Controls are cumulative:

```text
Delivery Flow Controls
+ Enterprise Domain Controls
+ Project Domain Controls
= Final Controls
```

A project configuration cannot replace or weaken a locked enterprise Control.

### 11.2 Decision and Default Resolution

The recommended precedence is:

```text
1. Locked Enterprise Constraint
2. Approved Project Baseline
3. Project Default
4. Shared Domain Default
5. Harness Fallback
6. Ask the user only if the decision is still unresolved
```

If a Project Baseline conflicts with an Enterprise Constraint, the Resolver must report a configuration conflict. It must not silently override either value or ask an ordinary delivery user to choose between them.

Every automatically applied Baseline, Control, and Default must be disclosed with its provenance in the final Requirements, design summary, or Delivery Record. Automatic resolution must not become hidden decision-making.

### 11.3 Fixed Decisions Versus Defaults

| Project item | Ask again? | Override behavior |
|---|---:|---|
| Approved Baseline | No | Requires approved project change |
| Project Control | No | Requires a Policy Exception |
| Project Default | No | May be replaced with rationale |
| Undefined decision | Yes | Decided by the current delivery |

## 12. End-to-End Control Chain

This section is the primary review surface for teams responsible for Harness, Flow, Stage, enterprise, or project controls. It defines how every control source becomes an effective delivery obligation.

### 12.1 Control categories

The architecture deliberately distinguishes five mandatory layers:

| Layer | Purpose | Representation |
|---|---|---|
| Harness Invariant | Preserve integrity, safety, reference validity, permission boundaries, state correctness, and auditability | Core code, schemas, registries, validators, and tests |
| Delivery Flow Control | Define how one delivery type operates | `flow.json` controls and Flow-local `controls/` |
| Stage Completion Contract | Define what must be true or produced for a canonical work unit | Stage Catalog requirements, outputs, and Artifact references |
| Enterprise Domain Control | Apply mandatory professional or enterprise policy | Domain-owned Control Policy selected through applicability |
| Project Control | Add mandatory rules specific to one project | Project Overlay Control Policy |

Project Baselines and Defaults participate in resolution but are not additional Control layers. A Baseline is an approved fact. A Default is an automatic choice. Neither may conflict with an applicable Control.

### 12.2 Control assembly chain

```text
Harness Invariants
Schema, catalog, reference, hash, permission, state, audit
        |
        v
Delivery Flow Controls
Statuses, checkpoints, constraints, role/timebox behavior,
Artifact profiles, required Capabilities, Flow-local rules
        |
        v
Stage Completion Contract
Intent, role slots, requirements, outputs, Artifact IO
        |
        v
Enterprise Domain Controls
Selected by Flow + Stage + risk + technology + domain tags
        |
        v
Project Controls
Added cumulatively; never replace enterprise Controls
        |
        v
Baseline and Default Resolution
Apply approved project facts and automatic choices;
reject conflicts with applicable or locked Controls
        |
        v
Effective Control Set
Rules + enforcement + evidence + exception authority + provenance
        |
        v
Stage Execution
Automatic validation, evidence collection, approval,
or governed exception
        |
        v
Checkpoint and Persistence
Delivery Record + evidence refs + exception refs
+ content hashes + checkpoint decision + append-only audit
```

For one Stage, the effective mandatory set is:

```text
Harness Invariants
+ Delivery Flow Controls
+ Stage Completion Contract
+ applicable Enterprise Domain Controls
+ applicable Project Controls
```

Knowledge and Capabilities are resolved in parallel but remain separate. Guidance is not mandatory by itself. A Plugin cannot approve its own obligation or bypass a Control. An Integration Adapter cannot bypass credential, network, or external-write permissions.

### 12.3 Applicability

Domain and Project Controls can declare applicability by:

- Delivery Flow;
- Stage;
- risk trigger;
- technology;
- delivery-domain tag.

Different dimensions use `AND`; values within one dimension use `OR`. A Domain manifest may supply default applicability when an asset omits a dimension.

Flow Controls are intrinsic to their Flow and do not need Domain-style applicability. Stage Completion Contracts are intrinsic to their Stage. Harness Invariants apply wherever their Core contract is used.

### 12.4 Authority, override, and exception rules

| Source | Owner | Project override | Governed deviation |
|---|---|---:|---|
| Harness Invariant | Harness Engineering with relevant governance review | Never | Change the versioned Harness contract; no delivery-local exception |
| Delivery Flow Control | PDLC Governance / Flow owner | Never | Change or select an approved Flow |
| Stage Completion Contract | PDLC Governance | Never | Change the canonical Stage definition |
| Enterprise Domain Control | Domain policy approver | Never | Use the rule's declared exception approver and evidence path |
| Project Control | Project governance for the owning Domain | Never | Use the project's governed exception/change process |
| Project Baseline | Named project approver | No conversational override | Approve a new baseline revision |
| Project or Domain Default | Project or Domain maintainer | Yes, unless Control-locked | Record replacement and rationale |

Control composition is cumulative:

```text
Effective Controls = Enterprise Controls + Project Controls
```

There is no last-writer-wins behavior for Controls. A Project Control may strengthen or specialize an enterprise rule, but cannot delete or weaken it. A Default never outranks a Control. A Control Exception is an explicit governed artifact, not an override flag.

### 12.5 Resolution and enforcement algorithm

Before every Stage, the Runner must:

1. validate Harness invariants and load only explicitly registered definitions;
2. resolve the Delivery Flow and conditional Stage set;
3. load intrinsic Flow Controls;
4. load the current Stage Completion Contract;
5. select applicable enterprise Domain Controls;
6. add applicable Project Controls cumulatively;
7. apply Project Baselines and resolve Defaults;
8. reject Baseline or Default conflicts with Controls;
9. output one effective Control set with source and ownership provenance;
10. output Knowledge and Capabilities through separate channels;
11. enforce each obligation through automatic validation, evidence, approval, or a formal exception;
12. persist applications, exceptions, evidence, Checkpoint decisions, content hashes, and audit events.

Context resolution is not a Stage. It is an internal operation repeated before each Stage so that risk, technology, project context, and applicable policy cannot become stale.

### 12.6 Enforcement modes

Control Policy rules support:

| Enforcement | Meaning |
|---|---|
| `automatic` | A deterministic Runner or validator check decides whether the rule passes |
| `evidence` | Delivery supplies traceable evidence evaluated at the relevant Stage or Checkpoint |
| `approval` | An authorized role or policy owner explicitly approves the disposition |

When a Control cannot be satisfied, the affected Stage or Checkpoint stops. The Harness reports the exact Control and rule, missing evidence, and declared exception authority. If an exception is approved, its reference and scope are recorded. A Control failure must never be silently converted into a Default override or advisory warning.

Harness Invariant failures do not use ordinary Control exceptions. The Harness definition, state, or reference must be corrected.

### 12.7 Provenance, evidence, and review

Control reviewers must be able to trace every effective obligation end to end:

| Review question | Source |
|---|---|
| Which non-bypassable Harness rule applied? | Core, schema, registry, validator, and test |
| Which Flow behavior applied? | Registered Flow definition and Flow-local controls |
| What made the Stage complete? | Canonical Stage definition |
| Which enterprise policy applied? | Domain Control and applicability metadata |
| Which project policy or approved fact applied? | Project Overlay Control or Baseline |
| How was the obligation handled? | Delivery Record Control application |
| Was there a governed deviation? | Exception reference and approver |
| What proves the result? | Evidence reference and relevant Checkpoint |
| What changed state? | Content hash, transition decision, and append-only audit event |

The Requirements Artifact and readiness summary must disclose applicable Controls, Project Baselines, resolved Defaults, exception references, and provenance. Automatic resolution must not become hidden control application.

### 12.8 Current v2 enforcement scope

Implemented now:

- schema, catalog, cross-reference, permission, and portability invariants;
- explicit Delivery Flow registration;
- executable POC constraints and Build Readiness;
- Stage Completion Contracts;
- enterprise and Project Control resolution;
- locked-Control conflict detection;
- Requirements content-hash approval binding;
- Delivery Record and audit infrastructure;
- Plugin and Integration Adapter permission declarations.

Still planned:

- formal `commit`, `verify`, and `decide` state transitions;
- generalized per-rule evidence evaluation across all Stages;
- production, release, JIRA, XRAY, CI/CD, and deployment control integrations.

An unimplemented control mechanism must be reported as unavailable; it must never be represented as passed.

## 13. Runtime Data

Shared Harness definitions and delivery runtime data must remain separate.

- Shared definitions live under `pdlc/`.
- Project configuration and delivery state live under `.pdlc/`.

Runtime data includes:

- Delivery Records.
- Requirements, Stories, Designs, and other Artifact instances.
- Evidence references.
- Approvals and content hashes.
- Policy Exceptions.
- Checkpoints and disposition decisions.
- Append-only audit events.

The Delivery Record is the state and decision index for one Delivery Flow. It must not become a container for pasted documents, full logs, or conversation transcripts. Large artifacts and tool outputs remain independent and are linked as Evidence.

## 14. Target Repository Structure

The tree below shows conceptual ownership and grouping. The v2 implementation deliberately keeps the small Core modules flat under `pdlc/core/`; splitting them into `registry/`, `resolvers/`, `enforcement/`, and `runtime/` subfolders is unnecessary until Core size makes that move valuable.

```text
PDLC/
├── AGENTS.md
├── README.md
├── HARNESS_TARGET_ARCHITECTURE.md
│
├── pdlc/
│   ├── cli.ts
│   │
│   ├── core/
│   │   ├── registry/
│   │   │   ├── stage-registry.ts
│   │   │   ├── delivery-flow-registry.ts
│   │   │   └── domain-registry.ts
│   │   ├── resolvers/
│   │   │   ├── context-resolver.ts
│   │   │   ├── control-resolver.ts
│   │   │   ├── knowledge-resolver.ts
│   │   │   └── capability-resolver.ts
│   │   ├── enforcement/
│   │   │   ├── policy-engine.ts
│   │   │   ├── readiness.ts
│   │   │   └── checkpoints.ts
│   │   └── runtime/
│   │       ├── records.ts
│   │       ├── artifacts.ts
│   │       ├── evidence.ts
│   │       └── audit.ts
│   │
│   ├── stages/
│   │   └── catalog.json
│   │
│   ├── delivery-flows/
│   │   ├── catalog.json
│   │   ├── poc/
│   │   │   ├── flow.json
│   │   │   └── controls/
│   │   ├── implementation/
│   │   │   ├── flow.json
│   │   │   └── controls/
│   │   └── pdlc/
│   │       ├── flow.json
│   │       └── controls/
│   │
│   ├── roles/
│   │   ├── product.md
│   │   ├── developer.md
│   │   └── qa.md
│   │
│   ├── domains/
│   │   ├── product-management/
│   │   │   ├── domain.json
│   │   │   ├── artifacts/
│   │   │   ├── controls/
│   │   │   ├── knowledge/
│   │   │   └── capabilities/
│   │   ├── ux/
│   │   ├── solution-architecture/
│   │   ├── security/
│   │   ├── quality/
│   │   ├── data-platform/
│   │   ├── operations/
│   │   └── ai-governance/
│   │
│   ├── schemas/
│   │   ├── stage.schema.json
│   │   ├── delivery-flow.schema.json
│   │   ├── role.schema.json
│   │   ├── domain.schema.json
│   │   ├── artifact-definition.schema.json
│   │   ├── control-policy.schema.json
│   │   ├── knowledge-metadata.schema.json
│   │   ├── plugin.schema.json
│   │   ├── integration-adapter.schema.json
│   │   └── delivery-record.schema.json
│   │
│   ├── examples/
│   └── tests/
│
├── .pdlc/
│   ├── project/
│   │   ├── project.json
│   │   └── domains/
│   ├── records/
│   ├── artifacts/
│   ├── evidence/
│   └── audit/
│
├── .agents/
│   └── skills/
│       └── lean-pdlc/
│
├── .codex/                       # Thin Codex Platform Adapter
├── .github/
│   ├── CODEOWNERS
│   ├── agents/                   # Thin Copilot Platform Adapter
│   └── workflows/                # Harness validation and CI
│
└── docs/
```

### 14.1 Content That Remains Outside Domains

Not every Harness file belongs to a professional Domain:

| Content | Location | Reason |
|---|---|---|
| Runner and Core | `pdlc/core/`, `pdlc/cli.ts` | Platform engine, not professional content |
| Canonical Stages | `pdlc/stages/` | Shared delivery vocabulary |
| Delivery Flows | `pdlc/delivery-flows/` | Delivery orchestration |
| Delivery Roles | `pdlc/roles/` | Per-delivery accountability |
| Platform Adapters | `.codex/`, `.github/` | Agent platform exposure |
| Runtime data | `.pdlc/` | Project and delivery instances |

## 15. Target State of Principle Pack

The current `Principle Pack` concept combines Domain ownership, applicability, mandatory rules, and advisory guidance. It is not retained as a first-class concept in the target architecture.

The migration mapping is:

| Current Principle Pack content | Target location |
|---|---|
| Owner and version | `domain.json` or distribution metadata |
| `appliesTo` | Artifact, Control, Knowledge, or Capability metadata |
| Required principle | Domain Control Policy |
| Risk-based principle | Conditional Policy or Conditional Guidance |
| Advisory principle | Knowledge Guidance |
| Examples and explanations | Reference or KB |

Principles remain useful as professional guidance, for example `knowledge/guidance/ux-principles.md`. The Runner does not need to interpret an abstract Principle. It enforces only concrete, testable Controls.

## 16. Capability Ownership and Cross-Domain Use

Domain-first placement describes ownership, not exclusive consumption.

For example, an Architecture Review Plugin may be owned by Solution Architecture but apply to every relevant Domain:

```json
{
  "id": "architecture-review",
  "kind": "plugin",
  "ownerDomain": "solution-architecture",
  "appliesTo": {
    "stages": ["solution-design"],
    "domains": ["*"]
  }
}
```

It is stored once:

```text
domains/solution-architecture/capabilities/plugins/architecture-review/
```

Consumer Domains reference or resolve it; they do not copy it.

Domain-owned Integration Adapters follow the same principle:

```text
domains/data-platform/capabilities/adapters/databricks/
domains/ux/capabilities/adapters/figma/
```

Codex and GitHub Copilot adapters are different. They expose the Harness itself and therefore remain thin Platform Adapters outside professional Domains.

## 17. Product Team Experience

Product teams do not need to understand Runner commands or repository internals. A typical experience is:

1. Select a POC, Implementation, or PDLC Delivery Flow.
2. The Harness loads approved Project Baselines, Controls, and Defaults.
3. The Harness asks only about unresolved product requirements and delivery decisions.
4. The Agent applies relevant Domain Knowledge and Capabilities during each Stage.
5. The Runner validates Policies, Artifacts, Evidence, and approvals at material control points.
6. Final Requirements and Delivery Records disclose all automatically applied standards, project decisions, and approved exceptions.

Product teams gain:

- Fewer repeated architecture, tooling, brand, platform, and standards questions.
- Automatic access to expert Guidance and Reference Implementations.
- Specialized Plugins and enterprise system Adapters when needed.
- Lightweight handling for low-risk work and stronger control for higher-risk work.
- Traceable delivery through Artifacts, Evidence, Decisions, and Audit.

## 18. Professional Domain Team Experience

Each professional team maintains its own Domain folder. It should:

- Express mandatory requirements as concrete Policies.
- Express principles and best practices as Guidance.
- Provide Defaults and Reference Implementations.
- Provide organization-specific KB content and Runbooks.
- Add a Plugin or Integration Adapter only when executable behavior is required.
- Use CODEOWNERS to approve official Domain changes.

Professional teams do not need to participate in every delivery. The Harness automatically resolves and applies approved Domain assets. Direct participation is required only for Policy exceptions, risk escalation, or a professional approval.

## 19. Implemented Migration

The foundational migration was completed incrementally while keeping the executable POC verifiable.

### Phase 1: Introduce the New Contracts — complete

- Add schemas for Domain, Artifact Definition, Control Policy, Knowledge Metadata, Plugin, and Integration Adapter.
- Add a Domain Registry and separate Control, Knowledge, and Capability resolvers.
- Validate the new contracts through the Runner and test suite.

### Phase 2: Migrate Shared Professional Assets — complete

- Split `pdlc/principles/<area>/` into the corresponding Domains.
- Move required content into Controls.
- Move advisory content into Guidance.
- Move shared Defaults into each owning Domain's Knowledge Defaults.
- Move top-level Plugins into the owning Domain's Capabilities.
- Move Integration Adapters into the owning Domain while preserving stable Adapter contracts.

### Phase 3: Establish the Artifact Model — complete

- Add Product Management Artifact Definitions for Requirements and Story.
- Separate document structure, templates, quality Policy, Guidance, and Plugin responsibilities.
- Let Stages declare input and output Artifact IDs.

### Phase 4: Establish the Project Overlay — complete

- Migrate `.pdlc/project/standards/` into the Domain-first Project Overlay.
- Support Project Baselines, Project Controls, Project Defaults, and Project Knowledge.
- Implement deterministic conflict detection and provenance reporting.

### Phase 5: Remove Compatibility Concepts — complete

- Update the `lean-pdlc` Skill, AGENTS.md, and product documentation.
- Remove Principle Pack as a Core model and delete its obsolete schema.
- Remove top-level Plugin and independent Harness Default sources of truth after migration.
- Keep Platform Adapters limited to entry points and discovery.

Future evolution must continue to preserve schema validation, Runner tests, and executable POC behavior.

## 20. Current-to-Target Mapping

| Current area | Target area |
|---|---|
| `pdlc/principles/<area>/` | `pdlc/domains/<domain>/controls/` and `knowledge/` |
| `pdlc/principles/ownership.json` | Domain manifests plus CODEOWNERS |
| `pdlc/defaults/harness/` | Owning Domain's `knowledge/defaults/` or Core fallback |
| `pdlc/templates/` | Artifact-specific templates under the owning Domain |
| Top-level `plugins/` | Owning Domain's `capabilities/plugins/` |
| `pdlc/integrations/` implementations | Owning Domain's `capabilities/adapters/` |
| Integration contracts | Stable Core capability contracts |
| `.pdlc/project/standards/` | `.pdlc/project/domains/<domain>/` overlay |
| Requirements policy with mixed responsibilities | Artifact schema + Domain Control + Guidance + Flow Control + Plugin |

## 21. Architectural Constraints

The implementation must preserve these boundaries:

- Do not reintroduce separate Workflow and User Journey orchestration models.
- Do not copy Stage, Artifact, or Domain Policy definitions into Delivery Flows.
- Do not turn every Stage into a human Checkpoint.
- Do not let Platform Adapters define their own Delivery Flows or governance rules.
- Do not let Plugins bypass the Runner, Policy, or Capability permissions.
- Do not let project configuration weaken locked enterprise Controls.
- Do not store credentials in Domain Knowledge or Project Overlays.
- Do not turn the Runner into an arbitrary build, test, or deployment executor.
- Do not paste all documents and logs into the Delivery Record.
- Do not create mandatory Policy for professional areas that do not yet have an accountable owner.
- Do not duplicate a shared Capability merely because it is consumed by multiple Domains.

## 22. Success Criteria

The target architecture is successful when:

- Product teams see one Delivery Flow concept.
- Each professional team can maintain all of its shared assets in one Domain folder.
- The Runner resolves Controls, Knowledge, and Capabilities independently.
- Mandatory rules and recommended content have explicit, different runtime semantics.
- Requirements and Stories have versioned, verifiable Artifact Definitions.
- Approved project architecture and rules are reused automatically instead of repeatedly questioned.
- Project Overlays cannot weaken enterprise Controls, and conflicts are found deterministically.
- Plugins and Adapters have explicit Owners, Applicability, and Permission Boundaries.
- Codex, GitHub Copilot, and other supported platforms share the same Stage, Flow, Domain, and Runner behavior.
- Every automatically applied Baseline, Policy, Default, and exception is traceable to its source.

## 23. Glossary

| Term | Meaning |
|---|---|
| Stage | Reusable unit of delivery work |
| Delivery Flow | Ordered Stage composition plus delivery-specific controls |
| Checkpoint | Material controlled decision, not every Stage |
| Delivery Role | Logical accountability within one delivery |
| Domain | Stable professional ownership and capability boundary |
| Artifact Definition | Logical contract for a delivery artifact |
| Control | Mandatory outcome or rule |
| Policy | Declarative form of a Control |
| Guidance | Recommended method or principle |
| Default | Automatically applied but potentially replaceable choice |
| Reference Implementation | Example implementation for learning or reuse |
| KB | Organization-specific knowledge, how-to content, FAQ, or runbook |
| Plugin | Specialized executable Agent capability |
| Integration Adapter | Controlled connection to an external system |
| Platform Adapter | Thin exposure layer for an Agent platform |
| Project Baseline | Approved stable project decision |
| Project Overlay | Project-specific Baselines, Controls, Defaults, and Knowledge |
| Delivery Record | State and decision index for one Delivery Flow execution |
| Runner | Deterministic internal Harness API |
