# Lean PDLC Harness Implementation Blueprint

## 1. Purpose

This blueprint records the target capabilities, implementation sequence, and acceptance criteria for the Lean PDLC Harness.

The detailed layer model and folder ownership matrix are maintained in [Harness Architecture and Ownership](HARNESS_ARCHITECTURE_AND_OWNERSHIP.md).

## 2. Design goals

The Harness must:

- Support POC, Implementation, and end-to-end PDLC workflows without forcing every delivery through the largest process.
- Use natural-language interaction rather than exposing Runner commands to delivery users.
- Keep human confirmation at a small number of material checkpoints.
- Permit one person to fill multiple logical delivery roles unless governance requires separation.
- Apply enterprise standards automatically and visibly.
- Keep workflow, role, policy, evidence, and audit behavior portable across Agent platforms.
- Use TypeScript and Bun for the deterministic internal Runner.
- Keep external enterprise systems behind stable adapters.
- Record material decisions without auditing every Agent action.

The Harness must not:

- Become a general-purpose script executor.
- Trigger a Runner process for every conversational step or tool call.
- Duplicate workflow policy under `.github/` and `.codex/`.
- Treat a POC as production approval.
- Require professional governance teams to participate in every low-risk delivery.

## 3. Architectural constraints

### 3.1 Orchestration and execution are separate

- Portable Guidance decides the next conversational action.
- The Stage Catalog declares reusable work intent, requirements, role slots, and outputs.
- User Journeys compose required and conditional Stage references.
- Workflow definitions declare status, defaults, constraints, and checkpoints.
- Principle Packs declare applicable professional policy.
- The Runner deterministically decides whether readiness or transition conditions are satisfied.
- CI/CD executes project tests, scans, builds, and deployment.
- Integration Adapters exchange evidence and state with enterprise systems.

### 3.2 One shared source of truth

Stage, Journey, Workflow, role, Principle Pack, schema, Delivery Record, and audit behavior are defined once in shared folders.

Platform adapters may add entry points or stronger tool restrictions. They may not skip Core gates or create alternate workflow semantics.

### 3.3 Documents and evidence are separate

The Delivery Record is the workflow state and decision index. Requirements, designs, tests, builds, work items, and deployment records remain independent artifacts referenced as evidence.

The Harness must not create documents that do not support a decision.

### 3.4 Deterministic control

Controlled state changes must be:

- Schema validated.
- Based on the expected revision.
- Protected by a lock.
- Written atomically.
- Bound to evidence and content hashes where appropriate.
- Audited as append-only material events.
- Unchanged when validation fails.

## 4. Workflow portfolio

### 4.1 POC

Purpose: test whether an idea is feasible or worth further investment through a bounded, non-production experiment.

```text
Idea
  -> Requirements Clarification
  -> Requirements Review and Build Readiness
  -> Lightweight Design
  -> Implementation
  -> Verification
  -> Kill, Pivot, or Productize
```

Constraints:

- No production deployment.
- No JIRA or XRAY requirement in the POC workflow.
- One person may fill Product, Developer, and QA.
- Productize creates input to a formal workflow; it is not release approval.

Target checkpoints:

- Commit.
- Verify.
- Decide.

### 4.2 Implementation

Purpose: implement a requirement or work item that is already sufficiently defined.

Target flow:

```text
Requirement or Story Intake
  -> Readiness Check
  -> Technical Design
  -> Implementation
  -> QA Preparation and Test Execution
  -> Sign-off
  -> Release Tollgate
  -> Deployment and Validation
```

Expected integrations:

- JIRA work items.
- XRAY test cases and executions.
- CI build, test, and security evidence.
- Release and deployment evidence.

The planned User Journey composition is defined, but its Workflow engine and integrations are not executable yet.

### 4.3 End-to-end PDLC

Purpose: manage product delivery from ideation through outcome review.

Target flow:

```text
Ideation
  -> Product Definition
  -> Requirements and Story Creation
  -> JIRA Handoff
  -> Implementation workflow
  -> Release and Production Validation
  -> Outcome Review
  -> Iterate, Retire, or Close
```

This User Journey composes Product, Implementation, QA, release, and outcome responsibilities. Its composition is defined, but its Workflow engine and integrations are not executable yet.

## 5. Delivery roles

### Product

Owns the business problem, user, hypothesis, requirements, scope, acceptance criteria, success measures, work-item readiness, and outcome decision.

### Developer

Owns technology classification, architecture applicability, the smallest suitable design, implementation, developer verification, and technical evidence.

### QA

Owns testability, test preparation, edge cases, test evidence, acceptance-criteria evaluation, and challenge of unsupported conclusions.

### Release tollgate

Release is a future controlled capability rather than a mandatory fourth participant in every POC. Operations, security, or governance approval may be attached when risk requires it.

A person may fill multiple roles. Future risk policy may require separation at selected checkpoints.

## 6. Professional policy model

Enterprise standards live in department-owned Principle Packs:

- Business Architecture.
- Solution Architecture.
- AI Governance.
- UX.
- Quality.
- Security.
- Operations.

Applicability is selected from:

```text
User Journey + Active Stage + Risk + Technology + Domain
                         |
                         v
                 Applicable packs
```

Enforcement levels are:

- `required`: blocks readiness or a checkpoint until satisfied or an approved exception exists.
- `risk-based`: becomes required when its trigger matches.
- `advisory`: reports meaningful deviation without blocking.
- `not-applicable`: is not loaded; rationale is recorded when needed.

Policy owners maintain their folders and semantic versions. They do not need to participate in every delivery.

## 7. Runner boundary

The TypeScript Runner has one public entry point: `pdlc/cli.ts`.

Supported Phase 1 responsibilities:

- Validate shared schemas and definitions.
- Validate portability and entry points.
- Validate a Delivery Record.
- Resolve standards and reject locked-constraint conflicts.
- Perform Build Readiness approval as one atomic operation.
- Bind approval to the Requirements content hash.
- Append the material approval audit event.

Reserved responsibilities:

- Commit checkpoint.
- Verify checkpoint.
- Decide checkpoint.
- Risk-driven separation of duties.
- Evidence enforcement for formal transitions.

The Runner must never start arbitrary project commands, application builds, or deployment processes.

## 8. Portability contract

The common baseline is:

- `AGENTS.md`.
- `.agents/skills/lean-pdlc/`.
- Shared Stages, User Journeys, workflows, roles, principles, schemas, and templates.
- `pdlc/cli.ts` and `pdlc/core/`.
- Shared Delivery Records, evidence references, and audit events.

Platform files remain thin:

- `.github/` provides GitHub Copilot discovery and optional enhancements.
- `.codex/` may provide optional Codex approval mapping when needed.

The Core must contain no platform path or platform-name branching. Given the same shared inputs, supported adapters must produce the same Runner outcome and failure reason.

## 9. Audit model

Audit includes material workflow events such as:

- Workflow creation.
- Build Readiness approval or rejection.
- Checkpoint approval or rejection.
- Risk escalation.
- Principle exception approval.
- Kill, pivot, or productize decision.

Audit excludes full conversations, internal reasoning, routine tool calls, and non-decision file operations.

## 10. Integration boundary

The Core uses stable interfaces for:

- Work items.
- Test management.
- Build and deployment evidence.
- Runtime health evidence.
- Release and service-management controls.

Harness Engineering owns interface semantics. Each enterprise platform team owns its concrete adapter.

## 11. Delivery roadmap

### Phase 0: Design baseline — complete

- Define POC, Implementation, and end-to-end PDLC scope.
- Simplify delivery roles to Product, Developer, and QA.
- Permit one person to fill multiple roles.
- Separate professional policy ownership from delivery execution.
- Select one internal TypeScript Runner.
- Establish Codex-first development with Harness-neutral shared sources and Copilot readiness.

### Phase 1: Portable POC Core — complete

- Shared Skill and repository controls.
- Canonical 30-Stage catalog and validated User Journey composition.
- Principle Pack mapping to canonical Stage ids and active-Stage-set resolution.
- Executable POC workflow.
- Adaptive requirements policy and templates.
- Product, Developer, and QA role definitions.
- Delivery Record and governance schemas.
- Principle Pack selection and standard layering.
- Build Readiness approval bound to the Requirements content hash.
- Atomic storage, locks, audit foundation, and revision checks.
- Adapter contracts, capability declarations, and portability validation.
- English architecture, ownership, and reserved-folder structure.

### Phase 2: POC checkpoints — pending

- Commit transition.
- Risk calculation and safety-boundary enforcement.
- Verify transition and evidence validation.
- Decide transition and terminal outcomes.
- Failure atomicity and idempotency tests.
- Exact low-frequency command approval mapping.

### Phase 3: GitHub Copilot conformance — partially complete

- Thin Copilot instructions, prompt, and custom Agent exist.
- Validate discovery in the approved enterprise Copilot surfaces.
- Validate command approval behavior.
- Run the same fixture through Codex and Copilot.
- Record a capability compatibility matrix.

### Phase 4: Enterprise POC pilot — pending

- Run greenfield and existing-codebase POCs.
- Test one person filling all delivery roles.
- Exercise UI, AI, security, and exception policy.
- Measure actual approvals, wait time, and adoption friction.
- Replace mock professional standards with approved enterprise content.

### Phase 5: Implementation workflow — pending

- Approve intake and readiness policy.
- Implement JIRA, XRAY, and CI evidence adapters.
- Add QA preparation, sign-off, risk-driven separation, and release tollgates.

### Phase 6: End-to-end PDLC — pending

- Implement ideation and product definition.
- Create stories and JIRA handoff.
- Compose the Implementation workflow.
- Add release, production validation, outcome review, iteration, and retirement.

## 12. Target acceptance criteria

The first complete POC Harness release must demonstrate that:

1. Natural-language and supported platform entry points activate the same shared workflow.
2. Delivery users never need to run the internal Runner.
3. One person can fill Product, Developer, and QA where policy permits.
4. Requirements are clarified and explicitly approved before construction.
5. Applicable standards are selected, versioned, traceable, and automatically applied.
6. Commit, Verify, and Decide use one Runner process per confirmed checkpoint.
7. Runner failure leaves controlled state unchanged.
8. POC does not deploy to production or require JIRA/XRAY.
9. Professional teams can independently maintain their Principle Pack folders.
10. Audit captures material actors, decisions, evidence, state, and record hash without storing full conversations.
11. Productize closes the POC and provides input to a new formal workflow.
12. Implementation and end-to-end PDLC can be added without rewriting the Core.
13. Codex and GitHub Copilot use the same shared sources and produce equivalent Runner outcomes.
