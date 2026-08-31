# Atlas PDLC Architecture

> Draft for pilot review — August 31, 2026

**Documentation:** [User Guide](ATLAS_PDLC_README.md) · [Architecture](ATLAS_PDLC_ARCHITECTURE.md) · [Maintainers](ATLAS_PDLC_MAINTAINERS.md)

## Purpose

Atlas PDLC is an extensible, platform-neutral Harness framework for AI-assisted software product delivery. It combines a deterministic Core Engine, canonical PDLC Stages, configurable Delivery Flows, Discipline-owned Skills and governance assets, governed Integrations, Project Overlays, and auditable Delivery Records behind one shared extension model.

The architecture allows organizations to tailor Delivery Flows to their business, technology, risk, and governance needs without rewriting the Core Engine. Thin Coding Agent Adapters expose the same Harness through coding-agent-specific discovery and permissions, while explicit ownership keeps Flow, Discipline, Integration, and project responsibilities independently governed. GitHub Copilot is the current supported Adapter; Codex and other Coding Agents are future Adapter targets.

This document explains what Atlas is and why it is designed this way. Operational installation and POC instructions are in the [User Guide](ATLAS_PDLC_README.md). Extension procedures and owner responsibilities are in [Maintainers](ATLAS_PDLC_MAINTAINERS.md).

## Corp governance boundary

Atlas is designed to operate inside Corp's existing AI governance boundary. Corp remains authoritative for approved Coding Agents, identity and access, acceptable use, security, privacy, legal and intellectual-property obligations, and data classification and handling.

Atlas adds delivery-specific governance beneath that boundary. Its Policies, Controls, Delivery Flows, Project Overlays, and Coding Agent Adapters may strengthen or operationalize Corp requirements, but they cannot override or weaken them. GitHub Copilot is the current Corp-approved Coding Agent for the Pilot; Codex and other Coding Agents remain future Adapter targets subject to Corp approval.

The architecture diagram starts with the approved Coding Agent and therefore assumes the enclosing Corp AI governance boundary rather than duplicating all Corp controls inside Atlas.

## Design goals

Atlas is designed to provide:

1. **A clear delivery model** — reusable Stages composed into purpose-specific Delivery Flows.
2. **A stable engine** — new Stages, Flows, Discipline assets, and Integrations should normally be configuration extensions rather than Core changes.
3. **Explicit authority** — human approval is required only at declared Checkpoints and policy boundaries.
4. **Just-in-time context** — only the current Stage's applicable controls and expert assets are resolved.
5. **Auditable execution** — controlled state changes, decisions, context, and evidence are persisted and traceable.
6. **Coding-agent portability** — the current GitHub Copilot Adapter and future Coding Agent Adapters share one delivery and governance source of truth.
7. **Project ownership** — reusable Harness code stays separate from the adopting project's delivery history and configuration.

Atlas is not intended to:

- replace product judgment or approval;
- turn every Stage into a human gate;
- execute arbitrary application commands through the Runner;
- store secrets or credentials;
- bypass enterprise Policies;
- deploy a POC to production;
- treat a productization recommendation as production approval.

## Architecture at a glance

![Atlas PDLC architecture overview](docs/images/atlas-pdlc-architecture.png)

[Open the full-resolution Atlas PDLC architecture diagram](docs/images/atlas-pdlc-architecture.png).

Read the diagram from top to bottom:

1. GitHub Copilot is the current Coding Agent target; Codex and other Coding Agents are shown as future Coding Agent Adapter targets.
2. The Delivery Model defines reusable Stages, Flow composition, Roles, schemas, and Flow-owned execution behavior.
3. Governance and Disciplines contribute applicable Controls, Knowledge, Skills, Hooks, and Integrations before the Core Engine and Runner execute the lifecycle.
4. Project-owned context and auditable delivery state remain in the product workspace rather than being copied into the shared Harness.

The **Agent** owns conversation, analysis, artifact drafting, implementation, and application verification. The **Runner** owns deterministic validation, context resolution, controlled lifecycle state, integrity checks, locking, and audit persistence.

The diagram intentionally shows stable architectural categories rather than every registered asset. The executable inventory is resolved from the versioned catalogs and manifests, not from the image.

### Current implementation and readiness snapshot

As of August 31, 2026, the repository contains:

- one Pilot Ready Delivery Flow: `poc`;
- an active technical implementation of `product-requirements-analysis` that remains Developing for pilot release, targeted for the week of August 31, 2026;
- registered `implementation` and `pdlc` definitions that remain Developing; Implementation is targeted for the week of August 31, 2026, and end-to-end PDLC for the week of September 7, 2026;
- five registered Disciplines: Product Management, UX, Solution Architecture, Security, and Data Platform;
- three bundled UX Skills, one UX Agent, and one UX Hook;
- one registered Integration definition: Databricks, currently without bundled Integration Skills;
- a canonical shared Skill used by the GitHub Copilot Adapter and portable discovery assets for future Coding Agent Adapters.

Engineering and QA are currently represented as delivery responsibilities and extension areas, not registered Discipline packages. Java and Python Skills, JIRA/XRAY Integrations, and similar capabilities are supported by the extension model but are not bundled executable assets in this snapshot.

## Core concepts

### Stage

A Stage is a canonical reusable unit of delivery work. It defines stable intent, accountable Role slots, completion requirements, expected outputs, and optional input/output Artifact types.

A Stage does not define:

- where it appears in a lifecycle;
- whether it is required for every delivery;
- a Delivery Flow status;
- a human approval by default.

Examples include Requirements Clarification, Solution Design, Implementation, Developer Verification, Security Verification, and Outcome Review.

### Delivery Flow

A Delivery Flow is the only lifecycle composition model in Atlas. It orders canonical Stage references and owns lifecycle-specific controls:

- required and conditional inclusion;
- activation tags;
- initial and terminal states;
- Checkpoint transitions;
- Checkpoint ownership;
- constraints and delivery defaults;
- role-assignment and timebox behavior;
- optional runtime actions and a Flow-owned Executor.

A Flow references Stage IDs without redefining their meaning. A Stage may be reused by many Flows.

### Role

A Role is a logical accountability slot, not necessarily a job title or a separate person. Stages declare participating Roles; Checkpoints declare an owning Role; a Delivery Record binds those Roles to identities for one delivery.

Atlas initially defines Product, Developer, and QA. One person may fill several slots unless an applicable governance rule requires separation of duties.

### Checkpoint

A Checkpoint is an explicitly controlled lifecycle transition. It declares valid source states, a destination or outcome map, and an owning Role.

A Stage is not automatically a Checkpoint. This distinction keeps routine delivery work conversational while reserving human confirmation for material transitions.

### Discipline

A Discipline is a professional ownership boundary such as Product Management, UX, Security, Solution Architecture, or Data Platform. A Discipline may own:

- Artifact Definitions;
- Policies;
- Knowledge;
- Skills;
- Agents;
- Hooks.

A Discipline does not need every asset category. It owns only the professional content for which its team is accountable.

### Artifact Definition

An Artifact Definition is a governed contract for a deliverable such as Requirements, a Story, Sprint Scope, Change Proposal, or Productization Package. It can include schemas, templates, examples, and profiles.

Stages reference Artifact types rather than embedding or copying templates.

### Policy and Control

A **Policy** is an authored mandatory rule owned by a Discipline or project. When that Policy applies to the current delivery context, it becomes part of the effective **Control** set.

An applicable Control must be:

- satisfied;
- supported by required evidence or approval; or
- covered by a formally approved exception.

Policies are cumulative. A Project Policy may strengthen or specialize an enterprise Policy, but it cannot remove or weaken it.

### Knowledge

Knowledge is advisory context rather than a mandatory obligation by itself:

- **Guidance** — recommended practices;
- **Default** — an automatic but normally replaceable choice;
- **Reference** — examples and reference implementations;
- **KB** — concrete organizational or technical information.

If Knowledge must become mandatory, a Policy explicitly requires it.

### Skill, Agent, and Hook

A Skill defines a reusable expert procedure. A Discipline Agent describes an expert execution behavior. A Hook binds a Discipline Agent and Skills to canonical Stages while declaring Flow scope, permissions, handoff, and approval boundaries.

Discipline contributions extend the main Atlas Agent in the same delivery conversation. They do not own the Delivery Flow, approve Requirements, or mutate controlled lifecycle state.

### Integration

An Integration is an explicitly cataloged external-system boundary. The current catalog contains Databricks; future Integration packages may cover systems such as JIRA or XRAY. An Integration declares:

- owners and maintainers;
- applicability;
- network and credential requirements;
- external-write permissions;
- optional bundled Skills.

Credentials are referenced, never stored in the Integration package. A Flow constraint can make an Integration unavailable even when it is registered.

### Project Overlay

The Project Overlay adds approved project context without copying the shared Harness:

```text
pdlc/disciplines/<discipline>/
  baseline.json
  policies/
  defaults/
  knowledge/
```

- A Baseline records an approved project fact.
- A Project Policy adds a mandatory project obligation.
- A Project Default supplies an automatic but replaceable project choice.
- Project Knowledge provides locally relevant context.

Project content cannot weaken an enterprise Policy or override a locked Control decision.

### Delivery Record and Audit Log

The Delivery Record is the execution truth for one delivery. It stores Flow state, assignments, classification, approvals, resolved context, Control dispositions, exceptions, evidence, artifact references, and outcome.

The Audit Log is append-only history for controlled operations. Each event is associated with one Record and includes a deterministic Record hash.

The current-record pointer is local selection state, not delivery truth.

## Separation of responsibilities

Atlas keeps three concerns distinct:

| Concern | Source of truth | Owner |
|---|---|---|
| Delivery semantics | Stage Catalog | PDLC Governance |
| Lifecycle composition and controls | Delivery Flow definitions | Flow Owner / PDLC Governance |
| Professional governance and expertise | Discipline assets | Discipline Owners |
| External-system boundaries | Integration Catalog | Integration Owners |
| Project-specific context | Project Overlay | Project governance |
| Controlled execution state | Delivery Record and Audit | Runner-managed project history |
| Conversation and delivery work | Main Agent plus resolved contributions | Delivery participants |

This separation prevents a Coding Agent Adapter, Flow, or project configuration from becoming a competing source of delivery truth.

## Runtime lifecycle

### 1. Select a Delivery Flow

The Agent resolves an explicitly registered Flow. A planned, unregistered, or deprecated Flow is not silently executable.

### 2. Initialize controlled state

A new delivery starts from a minimal Draft. The Runner validates it and coordinates creation of:

- the revision-zero Delivery Record;
- the local current-record pointer;
- the `DELIVERY_FLOW_CREATED` Audit Event.

Initialization succeeds or rolls back as one controlled operation.

### 3. Enter a Stage

The Runner resolves only the current Stage using the Flow, Stage, risk triggers, technologies, and selected Discipline context.

```text
Flow + Stage + delivery context
  -> Stage Role definitions
  -> enterprise and Project Policies as Controls
  -> Project Baselines
  -> locked Control defaults, Project Defaults, Discipline Defaults
  -> relevant Discipline and Project Knowledge
  -> eligible Discipline Hooks, Agents, and Skills
  -> eligible Integrations and bundled Skills
```

Context resolution is a system operation before a Stage; it is not itself a Stage.

### 4. Perform Stage work

The Agent reads the resolved material, performs the Stage work, updates delivery artifacts, and records evidence. It does not ask users to reconfirm approved Baselines or automatically applied Defaults.

### 5. Apply material context

When provenance is required, the Agent submits a Stage Context Receipt. The receipt:

- acknowledges each applicable Policy;
- records Knowledge, Discipline contribution, and Integration use or explained non-use;
- links used assets to evidence;
- binds the application to a deterministic context hash.

The Runner rejects stale, missing, or unexpected material and records a `STAGE_CONTEXT_APPLIED` event.

### 6. Evaluate a controlled boundary

Before a Checkpoint, the Runner validates the Record, authority, current Requirements contract, evidence, applicable Controls, and required context. The user confirms the proposed transition. The Runner then persists the Record mutation and matching Audit Event together.

## Control chain

Atlas evaluates several distinct authorities:

```text
Harness Invariants
  + Delivery Flow Controls
  + Stage Completion Contract
  + applicable Enterprise Discipline Policies
  + applicable Project Policies
= Effective Control Set
```

| Layer | Ordinary delivery override? | Change or exception path |
|---|---:|---|
| Harness invariant | No | Change the versioned Harness contract. |
| Delivery Flow control | No | Change the Flow or select another approved Flow. |
| Stage completion contract | No | Change the canonical Stage through governance review. |
| Enterprise Discipline Policy | No | Use its declared exception authority and evidence path. |
| Project Policy | No | Use the project's governed change or exception path. |
| Project Baseline | No conversational override | Approve a new Baseline revision. |
| Project or Discipline Default | Yes, unless locked | Record the replacement and rationale. |

Default precedence is:

```text
locked Control decision
  > Project Default
  > Discipline Default
```

A conflict between a Baseline or Default and an applicable locked Control is a validation error, not a product question.

## Flow Engine extension contract

Atlas separates declarative lifecycle data from specialized deterministic behavior.

### Configuration-only Flow

A Flow with standard initialization, status, audit, and Checkpoint transitions needs only:

- a registered `flow.json`;
- canonical Stage references;
- states and terminal outcomes;
- Checkpoint transitions and owners;
- delivery defaults and constraints.

The generic Flow Engine executes it without a Flow-specific module.

### Flow-owned Executor

A Flow adds an Executor inside its own directory when it needs specialized:

- configuration validation;
- Record validation or initialization;
- actions;
- Checkpoint gates;
- status or audit projections;
- operational-integrity checks.

The Flow declares the Executor through `runtime.executor`. Core and CLI dispatch through the generic executor contract and must not contain Flow-ID branches.

This boundary is the principal stability promise of Atlas: adding a Flow should extend the Harness rather than modify its base engine.

## Storage and integrity model

Reusable Harness material and project delivery state are intentionally separated:

```text
.pdlc/                         Reusable Atlas Harness
  cli.ts
  core/
  stages/
  delivery-flows/
  disciplines/
  integrations/
  roles/
  schemas/
  tests/

pdlc/                          Product-project ownership
  records/                     Versioned Delivery Records
  audit/                       Append-only per-record Audit Logs
  disciplines/                 Project Overlay
  requirements/                Requirements artifacts
  evidence/                    Test, build, review, and demo evidence
  artifacts/                   Other delivery artifacts
  .state/                      Ignored inbox, pointer, and locks
```

A workspace represents one product project. It may retain many terminal Delivery Records, but a checkout may have at most one active Record.

Controlled mutations use optimistic revision checks and locks. Build Readiness, Context Application, Verify, Decide, and controlled initialization coordinate the Record and Audit surfaces. If audit persistence fails, Atlas restores the prior Record state rather than leaving an unaudited transition.

Requirements approvals are content-hash bound. Verify recalculates the approved Requirements hash and checks evidence references before advancing.

## Coding Agent Adapters

Coding Agent Adapters make Atlas discoverable by a coding-agent environment. They are intentionally thin:

- `AGENTS.md` provides repository-level boundaries;
- `.agents/skills/lean-pdlc/` contains the shared operational Skill;
- `.github/` contains GitHub Copilot discovery and setup surfaces;
- `.codex/` contains compatibility discovery notes for a future Codex Adapter; its presence does not make Codex a currently supported pilot surface.

Coding Agent Adapters must not copy Stages, Flow definitions, Policies, Knowledge, Checkpoints, Schemas, or delivery state. Every Adapter uses the same Harness and project Records.

The canonical shared Skill recognizes the executable `poc` and `product-requirements-analysis` Flows plus `resume`, `status`, `audit`, and `help` intents. The current GitHub Copilot `/pdlc` prompt explicitly advertises only `poc`, `resume`, `status`, and `help`; other canonical intents require a Coding Agent Adapter surface that forwards them to the shared Skill or an equivalent natural-language request. This is a Coding Agent Adapter exposure difference, not a second delivery model.

The `lean-pdlc` directory and Agent identifiers are compatibility names in the current v2 implementation. **Atlas PDLC** is the product and framework name.

## Current capability and roadmap

Only the POC Delivery Flow is currently Pilot Ready.

The POC Delivery Flow uses this lifecycle:

```text
DRAFT
  -> COMMITTED
  -> VERIFIED
  -> PARKED | PRODUCTIZATION_RECOMMENDED
```

It supports Requirements clarification, conditional UX and Security Stages, Build Readiness, implementation, evidence-backed verification, final disposition, Project Overlay resolution, Discipline contributions, and append-only audit history.

Product Requirements Analysis and Implementation are Developing with a target release during the week of August 31, 2026. End-to-end PDLC is Developing with a target release during the week of September 7, 2026. The repository may contain registered definitions, runtime scaffolding, or engineering paths for these Flows before they are Pilot Ready.

Roadmap dates are planning targets and are not enforced by the Harness. A Flow is not Pilot Ready until its lifecycle behavior, controls, tests, documentation, Coding Agent Adapter entry points, and owner approvals are complete.

## Safety properties

Atlas maintains these architectural invariants:

- Corp AI governance remains authoritative over Atlas configuration and execution.
- Only explicitly cataloged Delivery Flows and Integrations are loadable.
- A Flow cannot redefine canonical Stage semantics.
- A Stage is not automatically a human approval gate.
- Checkpoint authority comes from declared Roles and Record assignments.
- Discipline asset ownership must match its folder.
- Project configuration cannot weaken enterprise Policies.
- Locked Control decisions outrank Defaults.
- Hook and Integration permissions remain explicit.
- Credentials and secrets are not stored in Harness definitions or Delivery Records.
- Requirements approval is content-hash bound.
- Controlled lifecycle state and matching Audit Events are persisted together.
- Coding Agent Adapters remain thin.
- The POC Flow does not deploy to production or write to JIRA/XRAY.
- The Product Requirements Analysis Flow does not create or update JIRA/XRAY work items.
