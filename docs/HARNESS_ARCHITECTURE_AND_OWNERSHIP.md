# Lean PDLC Harness Architecture and Ownership

## 1. Purpose

This document explains the enterprise architecture of the Lean PDLC Harness, the responsibility of each layer, the organizational owner of each shared folder, and the boundary between Harness maintenance and delivery execution.

It is the primary presentation document for the Harness. It describes the target architecture and clearly identifies which capabilities are executable today and which are reserved for later phases.

## 2. Executive summary

The Harness is based on one separation-of-concerns rule:

> Professional functions define standards, PDLC Governance defines lifecycle policy, Harness Engineering implements deterministic controls, Developer Experience exposes portable Agent entry points, and delivery teams execute workflows and provide evidence.

The design avoids two common failure modes:

- Platform-specific workflow copies that drift between Codex and GitHub Copilot.
- A large script that mixes conversation, governance policy, project commands, integrations, and workflow state.

The Harness therefore uses a shared declarative policy layer, a small portable Agent guidance layer, and a deterministic TypeScript Runner.

## 3. Architecture at a glance

```text
Delivery user or Agent
        |
        v
1. Harness Adapters
   Codex / GitHub Copilot discovery, capability, and approval mapping
        |
        v
2. Portable Guidance
   Natural-language orchestration and requirements clarification
        |
        v
   +---------------------------------------------------------------+
   | 3. Delivery Model                                             |
   | Canonical Stages -> User Journey -> Workflow checkpoints      |
   |                                                               |
   | 4. Role Definitions             5. Policy Inputs              |
   | Product / Developer / QA        Principle Packs and defaults  |
   +---------------------------------------------------------------+
        |
        v
6. TypeScript Runner and Core
   Schema validation, policy resolution, readiness, state, and audit
        |
        +-----------------------------+
        |                             |
        v                             v
Runtime Delivery Data          7. Integration Adapters
Records, requirements,         JIRA, XRAY, CI/CD, ITSM,
evidence, and audit            deployment, and health evidence
```

The main execution chain is Adapter → Guidance → resolved Delivery Model → Runner. Roles, Principle Packs, and standards are governed inputs to that chain, not extra conversational phases. Runtime state is a separate data plane:

```text
.pdlc/
  records/        Delivery Records and controlled workflow state
  requirements/   Reviewed requirements and build contracts
  questions/      Optional document-mode clarification input
  evidence/       Test, build, security, browser, and approval evidence
  audit/          Append-only material workflow events
  project/        Project-owned defaults; not enterprise Harness policy
```

### 3.1 Responsibility summary

| Responsibility | Accountable owner | Main source of truth |
|---|---|---|
| Lifecycle vocabulary and reusable Stage semantics | PDLC Governance | `pdlc/stages/` |
| POC, Implementation, and PDLC composition | PDLC Governance | `pdlc/journeys/` |
| Status, checkpoints, constraints, and delivery defaults | PDLC Governance | `pdlc/workflows/` |
| Requirements clarification quality and templates | Product Governance | `pdlc/workflows/*/requirements-policy.json`, `pdlc/templates/` |
| Business Architecture, Solution Architecture, AI, UX, Quality, Security, and Operations policy | Each named professional function | `pdlc/principles/<area>/` |
| Deterministic validation, readiness, state, and audit | Harness Engineering | `pdlc/cli.ts`, `pdlc/core/`, `pdlc/schemas/` |
| Codex and GitHub Copilot experience | Developer Experience | `AGENTS.md`, `.agents/`, `.github/`, optional `.codex/` |
| JIRA, XRAY, CI/CD, deployment, and ITSM implementation | Relevant enterprise platform team | `pdlc/integrations/` implementations |
| Project-specific preferences | Project team | `.pdlc/project/standards/` |
| Delivery execution and evidence | Assigned Product, Developer, and QA role holders | `.pdlc/` runtime artifacts |

### 3.2 Two distinct kinds of ownership

The Harness distinguishes organizational maintenance ownership from delivery execution accountability:

| Ownership type | Question answered | Example |
|---|---|---|
| Harness or policy owner | Who defines and approves the reusable rule? | UX Governance owns the UX Principle Pack. |
| Delivery role holder | Who performs or accepts this work for one delivery? | The assigned Developer applies the UX rules during implementation. |

Professional policy owners do not need to participate in every delivery. Their versioned policy is automatically applied. Direct involvement is needed only for policy changes, exceptions, or escalated risk.

See [Canonical Stages, User Journeys, and Principle Mapping](STAGE_AND_JOURNEY_MODEL.md) for all 30 Stages, the three Journey compositions, and the procedure for changing them.

## 4. Layer responsibilities

### 4.1 Harness Adapters

Harness Adapters make the shared Harness discoverable and usable on a particular Agent platform.

They may:

- Expose `/pdlc`, a custom Agent, a Skill, or an equivalent natural-language entry point.
- Declare platform capabilities.
- Map command approval behavior.
- Validate that the platform can find the shared Skill and repository instructions.

They must not:

- Define or copy Stages, User Journeys, workflows, gates, Principle Packs, or Delivery Record state.
- weaken a Core validation rule.
- create a platform-specific workflow branch.

Primary locations:

- `.github/` for GitHub Copilot.
- `.codex/` when an optional Codex-specific adapter is required.
- `pdlc/harnesses/` for platform-neutral adapter contracts and validation.

### 4.2 Portable Guidance

Portable Guidance is the conversational orchestration layer used by every supported Agent platform.

It is responsible for:

- Selecting or resuming a workflow.
- Reading current delivery state.
- Asking product clarification questions in controlled batches.
- Loading applicable roles, principles, standards, and templates.
- Preparing requirements and checkpoint summaries.
- Calling the internal Runner only for readiness checks or implemented state transitions.

It is not the authority for controlled workflow state. The Runner remains authoritative.

Primary locations:

- `AGENTS.md`
- `.agents/skills/lean-pdlc/`

### 4.3 Delivery Model: Stages, Journeys, and Workflows

The Delivery Model describes the lifecycle without binding it to an Agent platform. It has three deliberately separate parts:

- The canonical Stage Catalog defines reusable work intent, role slots, requirements, and outputs.
- User Journeys compose ordered Stage references and activate contextual Stages through tags.
- Executable Workflows reference a Journey and define statuses, delivery defaults, constraints, and a small number of controlled checkpoints.

Primary locations:

- `pdlc/stages/`
- `pdlc/journeys/`
- `pdlc/workflows/`

The POC Journey and Workflow are executable in Phase 1. Implementation and end-to-end PDLC Journey compositions are defined as planned models, but their Workflow state engines and integrations remain unavailable.

### 4.4 Role Definitions

Role definitions describe logical accountability during a delivery:

- Product owns the problem, requirements, scope, success criteria, and outcome decision.
- Developer owns the smallest suitable design, implementation, and technical evidence.
- QA owns testability, verification quality, evidence challenge, and sign-off criteria.

A person may fill multiple role slots unless a risk or governance rule requires separation of duties.

These delivery role slots are different from the organizational teams that maintain the Harness.

Primary location: `pdlc/roles/`.

### 4.5 Principle Packs and Standard Defaults

Professional departments define reusable policy in independently owned Principle Pack folders.

A pack declares:

- Its owner and semantic version.
- Applicability by workflow, stage, risk, technology, or domain.
- Enforcement as required, risk-based, advisory, or not applicable.
- Concrete requirements and optional automatic standard defaults.

Standards resolve in this order:

1. Locked enterprise constraints from Principle Packs.
2. Project defaults from `.pdlc/project/standards/`.
3. Overrideable enterprise defaults from Principle Packs.
4. Generic Harness defaults from `pdlc/defaults/harness/`.

A project may replace a recommendation but may not weaken a locked enterprise constraint.

Primary locations:

- `pdlc/principles/`
- `pdlc/defaults/harness/`
- `.pdlc/project/standards/`

### 4.6 TypeScript Runner and Core

The Runner is a deterministic internal Harness API, not an end-user interface.

It owns:

- Schema validation.
- Stage, Journey, Workflow, Principle Pack, and Standard Profile cross-reference validation.
- Conditional Journey resolution from delivery-context tags.
- Requirements and Build Readiness checks.
- Standard resolution and locked-constraint conflict detection.
- Controlled state transitions when implemented.
- Optimistic revision control and file locking.
- Content hashes and approval binding.
- Append-only audit events.
- Portability and entry-point validation.

The Runner must not execute arbitrary project scripts, install dependencies, deploy applications, or embed platform-specific logic.

Primary locations:

- `pdlc/cli.ts`
- `pdlc/core/`
- `pdlc/schemas/`
- `pdlc/tests/`

### 4.7 Integration Adapters

Integration Adapters isolate external enterprise systems from the Core.

The Core depends on stable contracts for:

- Work items such as JIRA stories.
- Test management such as XRAY.
- Build, deployment, and runtime evidence.
- Release or ITSM controls.

Harness Engineering owns the contracts. The platform team for each external system should own its concrete adapter implementation.

Primary location: `pdlc/integrations/`.

No external integration is active in the Phase 1 POC workflow.

## 5. Organizational ownership model

### 5.1 PDLC Governance

PDLC Governance decides what the lifecycle requires.

Owns:

- Canonical Stage semantics and User Journey composition.
- Workflow status and checkpoint policy.
- Role model and separation-of-duty policy.
- Workflow constraints and delivery defaults.
- Lifecycle terminology and progression rules.
- Approval of major schema semantics that affect governance.

Primary folders:

- `pdlc/stages/`
- `pdlc/journeys/`
- `pdlc/workflows/`
- `pdlc/roles/`
- Governance sections of `docs/`

### 5.2 Product Governance

Product Governance owns requirement-quality policy.

Owns:

- Clarification depth and required coverage topics.
- Minimum traceable product decisions.
- Question batching and document-mode rules.
- Requirements and questionnaire templates.
- Product readiness expectations.

Primary folders:

- `pdlc/workflows/*/requirements-policy.json`
- `pdlc/templates/`

### 5.3 Harness Engineering

Harness Engineering implements and operates the deterministic engine.

Owns:

- CLI and Core TypeScript.
- Schemas and validation behavior.
- Atomic persistence, revision control, locking, hashing, and audit.
- Harness tests and portability tests.
- Shared adapter and integration contracts.

Primary folders:

- `pdlc/cli.ts`
- `pdlc/core/`
- `pdlc/schemas/`
- `pdlc/tests/`
- `pdlc/harnesses/`
- `pdlc/integrations/contract.ts`

### 5.4 Developer Experience and AI Coding Platform

Developer Experience owns platform discovery and interaction ergonomics.

Owns:

- Shared Skill packaging and repository instructions with Governance review.
- GitHub Copilot and optional Codex adapter configuration.
- Platform capability and approval-policy mapping.
- Cross-platform conformance validation.

Primary folders:

- `AGENTS.md`
- `.agents/`
- `.github/`
- `.codex/` when present
- `pdlc/harnesses/`

### 5.5 Professional governance functions

Professional functions own their Principle Packs, not the complete workflow.

| Area | Organizational owner | Folder | Current status |
|---|---|---|---|
| Business Architecture | Business Architecture Team | `pdlc/principles/business-architecture/` | Reserved; pack not yet defined |
| Solution Architecture | Solution Architecture Team | `pdlc/principles/solution-architecture/` | Mock baseline implemented |
| AI SDLC/PDLC Governance | AI Governance Team | `pdlc/principles/ai-governance/` | Reserved; pack not yet defined |
| UX Standards | UX Governance Team | `pdlc/principles/ux/` | Mock baseline implemented |
| Quality | QA Governance Team | `pdlc/principles/quality/` | Reserved; pack not yet defined |
| Security | Security Team | `pdlc/principles/security/` | Baseline implemented |
| Operations | Platform Operations Team | `pdlc/principles/operations/` | Reserved; pack not yet defined |

Professional owners do not need to join every delivery. Their approved constraints are loaded and enforced automatically. They become directly involved when policy changes, exceptions, or risk escalation require owner review.

### 5.6 Enterprise integration teams

Integration ownership is split:

| Asset | Primary owner |
|---|---|
| Generic adapter interfaces | Harness Engineering |
| JIRA implementation | Atlassian or Work Management Platform Team |
| XRAY implementation | QA Tooling Team |
| CI/CD evidence implementation | DevOps or Delivery Platform Team |
| Deployment and health implementation | Platform Operations Team |
| Release or ITSM implementation | Release Governance or Service Management Team |

### 5.7 Delivery execution roles

These are logical delivery accountabilities rather than required headcount. One person may fill all three in a low-risk POC; formal workflows may require separation at selected checkpoints.

| Runtime role | Accountable delivery work | Typical Stage coverage |
|---|---|---|
| Product | Problem, user, hypothesis, scope, requirements, acceptance criteria, success measures, approval, and outcome decision | Discover, Define, and Outcome |
| Developer | Technology classification, solution design, implementation, developer verification, technical evidence, deployment support | Design, Build, Verify, and Release |
| QA | Testability, test strategy, test cases, execution evidence, acceptance evaluation, and sign-off | Define, Design, Verify, and Release |

Release tollgates are controlled decisions, not a permanent fourth delivery role. Operations, Security, or Release Governance may be attached as approvers when policy or risk requires it.

## 6. Directory ownership matrix

| Path | Primary owner | Required reviewers | Responsibility |
|---|---|---|---|
| `AGENTS.md` | Harness Governance | Developer Experience, Harness Engineering | Always-on repository control boundaries |
| `.agents/skills/lean-pdlc/` | Harness Governance | Harness Engineering, Developer Experience | Canonical portable Agent behavior |
| `.github/` | Developer Experience | Harness Governance | GitHub Copilot thin adapter |
| `.codex/` | Developer Experience | Harness Governance | Optional Codex thin adapter |
| `pdlc/cli.ts` | Harness Engineering | PDLC Governance for behavior changes | Single Runner entry point |
| `pdlc/core/` | Harness Engineering | Security or Governance when relevant | Deterministic engine |
| `pdlc/stages/` | PDLC Governance | Product, Engineering, QA governance | Canonical reusable Stage semantics |
| `pdlc/journeys/` | PDLC Governance | Product, Engineering, QA governance | User Journey composition and conditions |
| `pdlc/workflows/` | PDLC Governance | Product, Engineering, QA governance | Executable status, defaults, constraints, and checkpoints |
| `pdlc/roles/` | PDLC Governance | Product, Engineering, QA leadership | Logical delivery accountability |
| `pdlc/principles/<area>/` | Named professional function | Harness Engineering for schema compatibility | Enterprise professional policy |
| `pdlc/defaults/harness/` | Harness Product Team | Harness Engineering | Generic overrideable defaults |
| `pdlc/templates/` | Product Governance | PDLC Governance, QA Governance | Requirements and question artifacts |
| `pdlc/schemas/` | Harness Engineering | PDLC Governance | Machine contracts |
| `pdlc/harnesses/` | Developer Experience | Harness Engineering | Platform adapter contracts and validation |
| `pdlc/integrations/` | Harness Engineering | Relevant integration platform team | External-system contracts and adapters |
| `pdlc/tests/` | Harness Engineering | Component owners for changed policy | Harness regression and conformance tests |
| `docs/` | Harness Product Team | PDLC Governance, Harness Engineering | Architecture, operating model, and roadmap |
| `.pdlc/` | Delivery team and Runner | Role owner at a checkpoint | Runtime delivery data; not Harness source |

Actual GitHub team handles must be configured in `.github/CODEOWNERS` by the adopting enterprise. This repository provides `.github/CODEOWNERS.template` but does not invent deployable organization handles.

## 7. Canonical repository structure

```text
AGENTS.md
.agents/
  skills/lean-pdlc/                 Canonical portable guidance
.github/
  copilot-instructions.md           Thin Copilot discovery layer
  agents/lean-pdlc.agent.md         Optional Copilot custom Agent
  prompts/pdlc.prompt.md            Optional Copilot IDE entry point
  workflows/copilot-setup-steps.yml Copilot cloud-agent environment setup
pdlc/
  README.md                         Shared Harness source map
  cli.ts                            Single internal Runner
  core/                             Deterministic platform-neutral engine
  stages/catalog.json               Canonical 30-Stage catalog
  journeys/
    poc.json                        Active POC composition
    implementation.json             Planned Implementation composition
    pdlc.json                        Planned end-to-end composition
  workflows/
    poc/                            Executable Phase 1 workflow
    implementation/                 Reserved, not executable
    pdlc/                           Reserved, not executable
  roles/                            Product, Developer, and QA role slots
  principles/
    ownership.json                  Professional ownership registry
    business-architecture/          Reserved
    solution-architecture/          Existing mock baseline
    ai-governance/                  Reserved
    ux/                             Existing mock baseline
    quality/                        Reserved
    security/                       Existing baseline
    operations/                     Reserved
  defaults/harness/                 Generic overrideable Harness defaults
  templates/                        Shared requirements artifacts
  schemas/                          Machine-readable contracts
  harnesses/                        Platform adapter contracts
  integrations/                     External-system contracts
  tests/                            Harness regression tests
.pdlc/                              Runtime delivery state and evidence
docs/                               Architecture and roadmap
```

## 8. Change governance

### Stage or User Journey change

1. PDLC Governance proposes the lifecycle change.
2. Product, Engineering, and QA governance review affected Stage requirements, roles, and Journey sequence.
3. Professional owners review Principle Pack mappings to changed Stage ids.
4. Regression and cross-platform conformance tests pass.
5. The Stage Catalog version changes when reusable Stage behavior changes.

See `docs/STAGE_AND_JOURNEY_MODEL.md` for add, edit, reorder, deprecate, and mapping procedures.

### Executable Workflow change

1. PDLC Governance proposes a status, checkpoint, default, or constraint change.
2. Harness Engineering updates deterministic validation and transition logic.
3. Product, Engineering, and QA governance review changed control meaning.
4. Atomicity, audit, regression, and portability tests pass.

### Principle Pack change

1. The named professional owner changes only its pack.
2. Requirements remain concrete and verifiable.
3. Applicability and enforcement metadata are reviewed.
4. The semantic version is increased for behavioral change.
5. Harness validation confirms schema compatibility.

Locked enterprise constraints cannot be replaced by a project profile.

### Core change

1. Harness Engineering implements the change.
2. Existing workflow behavior remains deterministic.
3. Atomicity, audit, and portability tests pass.
4. Governance reviews any change to gate meaning or controlled state.

### Platform adapter change

1. Developer Experience updates only discovery, capability, or approval mapping.
2. Shared workflow and policy are not copied into the adapter.
3. Portability validation and a shared fixture conformance test pass.

## 9. Audit model

The Harness audits material workflow decisions, not every Agent action.

Appropriate events include:

- Workflow creation.
- Build Readiness approval or rejection.
- Checkpoint transition approval or rejection.
- Risk escalation.
- Principle exception approval.
- Kill, pivot, or productize decisions.

Audit does not store full chat transcripts, internal reasoning, routine file reads, or every tool call. This keeps the Harness fast while preserving evidence for consequential decisions.

## 10. Current implementation status

### Implemented

- Shared `AGENTS.md` and Lean PDLC Skill.
- GitHub Copilot thin entry points.
- Canonical 30-Stage catalog with requirements, roles, and outputs.
- Active 22-Stage POC Journey and planned Implementation and end-to-end PDLC Journey compositions.
- Executable POC workflow referencing the POC Journey.
- Principle Pack-to-Stage mapping and reverse mapping validation.
- Product, Developer, and QA logical roles.
- Adaptive requirements policy and templates.
- UX, Solution Architecture, and Security Principle Pack baselines.
- Layered enterprise, project, and Harness defaults.
- Build Readiness approval bound to a requirements content hash.
- Platform-neutral TypeScript Core, schemas, locks, audit foundation, and tests.
- Adapter contracts and portability validation.

### Structurally reserved but not executable

- Implementation Workflow engine; its 21-Stage Journey composition is defined.
- End-to-end PDLC Workflow engine; its 30-Stage Journey composition is defined.
- Business Architecture, AI Governance, Quality, and Operations Principle Packs.
- JIRA, XRAY, CI/CD, deployment, and ITSM implementations.

### Not yet implemented

- Commit, Verify, and Decide checkpoint transitions.
- Risk-driven separation of duties.
- Production release and operational validation.
- Enterprise GitHub team bindings in CODEOWNERS.

The repository includes a logical CODEOWNERS template. It must be populated with real organization handles and renamed before GitHub can enforce review routing.

Reserved folders intentionally contain no executable definitions. Their owners must provide approved policy before activation.

## 11. Presentation summary

The Lean PDLC Harness is not a large automation script and not a platform-specific prompt collection. It is a portable governance and delivery system with:

- Natural-language interaction for delivery users.
- Declarative workflows and professional standards.
- Deterministic TypeScript control for material decisions.
- Low-frequency human checkpoints.
- Explicit ownership by governance and professional functions.
- Shared behavior across Codex and GitHub Copilot.
- Evidence-linked state instead of document-heavy ceremony.

Its operating model allows one person to execute multiple delivery roles while preserving enterprise standards through centrally owned, versioned, and automatically applied policy.
