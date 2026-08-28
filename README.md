# Lean PDLC Harness

Lean PDLC is a lightweight, natural-language Product Delivery Lifecycle Harness. Delivery users do not run Bun, TypeScript, or shell commands. An Agent guides the workflow, maintains delivery artifacts, and invokes the deterministic Runner only for readiness checks or implemented, explicitly confirmed checkpoints.

The current release implements the Portable POC Core. Implementation and end-to-end PDLC Stage compositions are defined as planned User Journeys, but their Workflow engines and integrations are not executable yet.

## Start a POC

### GitHub Copilot IDE

Use the repository prompt entry point when supported:

```text
/pdlc poc validate whether AI can categorize customer feedback
```

Optional: see the [stage-aware VS Code Copilot UX plugin example](examples/copilot-plugins/lean-pdlc-ux/README.md). Maintainers can inspect a Stage instruction with `bun pdlc/cli.ts guidance <stage-id> --plugin <path>`; this resolves guidance but does not invoke Copilot or advance PDLC state.

### GitHub Copilot CLI or GitHub.com

Select the **Lean PDLC** custom Agent when available, or use natural language:

```text
Use the lean-pdlc skill to start a POC that validates whether AI can categorize customer feedback.
```

### Codex

Use the shared Skill or natural language:

```text
$lean-pdlc poc validate whether AI can categorize customer feedback
```

All entry points use the same `AGENTS.md`, shared Skill, canonical Stage Catalog, User Journeys, workflow controls, Principle Packs, Runner, Delivery Record, and audit model.

## User experience

The Agent clarifies product requirements in focused rounds of no more than three questions. A standard user-facing POC covers:

- Product context and hypothesis.
- Exact functional behavior and business rules.
- User scenarios and failure behavior.
- Product-specific UX interaction.
- Quality attributes.
- Data and integration boundaries.
- Scope, success criteria, and failure signals.

Every unresolved requirement question is presented as 2–4 mutually exclusive choices plus `X) Other`; users select an option instead of having to compose a free-text answer.

Enterprise, project, and Harness defaults are applied automatically. Users are not repeatedly asked to choose a corporate palette, accessibility baseline, security boundary, or reversible architecture rule. Automatic standards never replace confirmation of the user, problem, product behavior, data decisions, scope, or success criteria.

Users who prefer one document can choose document mode. The Agent creates a fillable requirements question file under `.pdlc/questions/`, waits for completion, and then converts resolved answers into traceable `RQ-xxx` decisions. The final Requirements document still requires explicit review.

The POC flow is:

```text
Idea
  -> Requirements Clarification
  -> Requirements Document
  -> Principle-led Lightweight Design
  -> Build Readiness Approval
  -> Implementation
  -> Verification
  -> Kill, Pivot, or Productize
```

## Conversation intents

These are conversational entry points, not Runner commands:

| Intent | Purpose |
|---|---|
| `/pdlc poc [idea]` | Start a POC |
| `/pdlc resume [POC-ID]` | Resume an existing POC |
| `/pdlc status` | Report the current stage, risks, and next step |
| `/pdlc help` | Show supported workflows and interaction options |
| `Start a POC` | Natural-language equivalent |

If a platform does not support repository slash commands, use the equivalent natural-language request.

## What the Agent manages

The Agent:

- Selects the correct workflow.
- Resolves the selected User Journey into canonical required and conditional Stages.
- Reads current state directly from the Delivery Record.
- Maintains requirements and delivery artifacts.
- Applies workflow delivery defaults such as role assignment mode and timebox.
- Loads applicable Principle Packs across the active Stage set by journey, risk, technology, and domain.
- Resolves standards using enterprise constraint, project default, enterprise default, and Harness default precedence.
- Detects gaps, ambiguity, contradictions, and invalid attempts to override locked constraints.
- Presents the complete Requirements document and Build Readiness summary.
- Prevents application construction before approval.
- Implements only the approved scope.
- Collects evidence as references rather than pasting logs into the Delivery Record.
- Requests confirmation before a material state-changing Runner call.

The end user does not need to know Runner paths or command parameters.

## Human confirmation model

Routine conversation, file reading, implementation, and evidence preparation do not produce a workflow checkpoint event.

Phase 1 provides one Build Readiness confirmation before construction. The Runner binds approval metadata to the exact Requirements content hash. A material Requirements change invalidates that approval.

The target POC lifecycle uses three low-frequency checkpoints:

1. **Commit** confirms the experiment goal, scope, success criteria, timebox, risk boundary, principles, and lightweight design.
2. **Verify** confirms the implementation and evidence against the approved criteria.
3. **Decide** records Kill, Pivot, or Productize with rationale and follow-up.

Each checkpoint maps to one Runner process. Checkpoint transitions are reserved for Phase 2 and are not simulated by the current release.

## Architecture

The Harness has seven layers:

1. Harness Adapters.
2. Portable Guidance.
3. Delivery Model: canonical Stages, User Journeys, and executable Workflows.
4. Role Definitions.
5. Principle Packs and Standard Defaults.
6. TypeScript Runner and Core.
7. Integration Adapters.

The authoritative architecture and organizational ownership model is documented in:

- [Harness Architecture and Ownership](docs/HARNESS_ARCHITECTURE_AND_OWNERSHIP.md)
- [Canonical Stages, User Journeys, and Principle Mapping](docs/STAGE_AND_JOURNEY_MODEL.md)
- [Implementation Blueprint](docs/PDLC_HARNESS_BLUEPRINT.md)
- [GitHub Copilot Adapter Guide](docs/GITHUB_COPILOT_ADAPTER.md)
- [User and Plugin Guides](docs/GUIDE/01-START-HERE.md)

## Repository map

```text
AGENTS.md                         Cross-platform repository controls
.agents/skills/lean-pdlc/        Canonical portable Agent guidance
.github/                          Thin GitHub Copilot adapter
pdlc/cli.ts                      Single internal Runner entry point
pdlc/core/                       Deterministic platform-neutral Core
pdlc/stages/                     Canonical reusable Stage Catalog
pdlc/journeys/                   POC, Implementation, and PDLC composition
pdlc/workflows/                  Executable controls and reservations
pdlc/roles/                      Product, Developer, and QA role slots
pdlc/principles/                 Department-owned Principle Packs
pdlc/defaults/harness/           Generic overrideable Harness defaults
pdlc/templates/                  Requirements and questionnaire templates
pdlc/schemas/                    Shared machine contracts
pdlc/harnesses/                  Platform adapter contracts and validation
pdlc/integrations/               Enterprise integration contracts
pdlc/tests/                      Harness regression tests
.pdlc/                           Runtime delivery records and evidence
docs/                            Architecture and roadmap
```

Major shared folders contain an English ownership README. Professional ownership is also declared in `pdlc/principles/ownership.json`.

`.github/CODEOWNERS.template` provides the intended review-routing structure. An adopting enterprise must replace the sample handles and rename it to `CODEOWNERS` before enforcement.

## Standard ownership and precedence

Professional teams maintain enterprise standards as versioned Principle Packs. They do not need to participate in every POC.

| Area | Owner | Status |
|---|---|---|
| Business Architecture | Business Architecture Team | Folder reserved; pack pending |
| Solution Architecture | Solution Architecture Team | Phase 1 baseline |
| AI Governance | AI Governance Team | Folder reserved; pack pending |
| UX | UX Governance Team | Phase 1 mock baseline |
| Quality | QA Governance Team | Folder reserved; pack pending |
| Security | Security Team | Phase 1 baseline |
| Operations | Platform Operations Team | Folder reserved; pack pending |

Resolved standard precedence is:

1. Locked enterprise constraints in Principle Packs.
2. Project defaults under `.pdlc/project/standards/`.
3. Overrideable enterprise defaults in Principle Packs.
4. Generic Harness defaults under `pdlc/defaults/harness/`.

Project profiles may replace recommendations but cannot weaken locked enterprise constraints.

## Current status

### Implemented

- Portable `AGENTS.md` and shared Lean PDLC Skill.
- GitHub Copilot prompt, custom Agent, and instruction adapters.
- Copilot cloud-agent setup that installs Bun and validates the Harness.
- A 30-Stage canonical catalog and validated POC, Implementation, and PDLC Journey compositions.
- POC executable workflow and Product, Developer, and QA role slots.
- Adaptive requirements policy, question batching, document mode, final review, and Build Readiness.
- Stage Catalog, Journey, Principle Pack, workflow, requirements policy, standard profile, Delivery Record, and audit schemas.
- Principle-to-Stage mapping validation and multi-Stage policy resolution.
- UX, Solution Architecture, and Security baselines.
- Layered standards and locked-constraint conflict protection.
- Atomic storage, revision checks, locks, hashes, and append-only audit foundation.
- Single TypeScript Runner and Core portability validation.
- Harness ownership documentation and future folder reservations.

### Not yet implemented

- Commit, Verify, and Decide checkpoint transitions.
- Business Architecture, AI Governance, Quality, and Operations pack content.
- JIRA, XRAY, CI/CD, deployment, release, and ITSM adapters.
- Executable Implementation workflow.
- Executable end-to-end PDLC workflow.
- Enterprise-specific GitHub CODEOWNERS team bindings.

Reserved folders intentionally contain no executable policy files. The Harness does not claim those capabilities until owners approve policy and the Runner supports it.

## Maintainer verification

The following commands are for Harness maintainers and CI, not delivery users:

```bash
bun test pdlc/tests
bun pdlc/cli.ts validate
```

The Runner is not an arbitrary script executor. Application tests, scans, builds, and deployments belong to the project or CI/CD environment.
