---
name: lean-pdlc
description: Guide lightweight, risk-based Product Delivery Lifecycle work using portable POC, implementation, and end-to-end PDLC workflows with explicit checkpoints, role slots, principle packs, delivery records, and auditable evidence. Use when starting or continuing a POC idea, implementing an already-defined requirement or story, running an end-to-end product delivery, assessing the next lifecycle step, preparing a checkpoint, or updating PDLC workflow artifacts in this repository.
---

# Lean PDLC

Use the shared Stage Catalog, User Journey composition, workflow controls, and deterministic TypeScript Runner. Keep routine development conversational and file-based; invoke the Runner only for explicit validation or controlled state transitions.

## Activate conversationally

Recognize these user intents as equivalent activation requests:

- `/pdlc poc [optional idea]`
- `$lean-pdlc poc [optional idea]`
- “start a POC” or an equivalent request in the user's language

When a message beginning with `/pdlc` reaches the agent as text, interpret it as:

```text
/pdlc <workflow> [optional context]
```

Supported workflow in Phase 1: `poc`. Reserve `implementation` and `pdlc` for later phases. Also recognize `/pdlc resume [POC-ID]`, `/pdlc status`, and `/pdlc help` as conversation intents, not Runner commands.

After activation:

1. Acknowledge the selected workflow and current phase in one short sentence.
2. Read the selected definition from `pdlc/journeys/`, resolve its canonical Stage references from `pdlc/stages/catalog.json`, and inspect the active Delivery Record by reading files; do not start a script merely to discover state.
3. If starting, ask for the idea or problem first. Create an incomplete DRAFT Record and Requirements document; leave unknown product fields empty rather than inventing success criteria or safety boundaries. Apply workflow-owned delivery defaults without asking product-requirement questions about role assignment or timebox.
4. Determine whether requirements need minimal, standard, or comprehensive depth. For a user-facing greenfield POC, default to standard depth.
5. Resolve conditional Journey Stages from `technology:`, `risk:`, and `domain:` context tags. Then resolve applicable enterprise, project, and Harness standard defaults across the active Stage set before asking questions. Clarify the product requirements in focused rounds until every topic required by the selected depth is complete. Defaults remove repetitive standards questions; they never replace confirmation of the user, problem, functional behavior, business rules, scenarios, scope, data decisions, or success measures. Every unresolved product question must offer 2–4 mutually exclusive, selectable options, plus `X) Other`. The user can answer by choosing an option letter and may add detail for `X) Other`; do not ask an open-ended question as the primary answer. Never exceed `questionRules.maxQuestionsPerRound` in chat. If document answers are enabled, offer the user the option to fill all outstanding product questions in the generated question document instead. Do not shortcut a user-facing POC from a generic product definition directly to technology or Build.
6. Maintain both the Delivery Record and `.pdlc/requirements/<POC-ID>.md` behind the conversation; summarize material changes.
7. Never create or modify application code, install application dependencies, or run an application build until the user explicitly approves the Requirements and Build Readiness summary.
8. Never show Bun commands or ask the end user to execute the Runner. Invoke the internal Runner yourself only when validation, Build Readiness, or a checkpoint is required.
9. Before any state-changing Runner call, present the proposed transition and request explicit confirmation.

## Select the workflow

- Choose `poc` for fast idea validation without JIRA, XRAY, production deployment, or formal release gates.
- Choose `implementation` when requirements or stories already exist and delivery needs development, QA, sign-off, and release integration.
- Choose `pdlc` for ideation through requirements, implementation, validation, release, and outcome review.
- If unclear, ask only for the missing decision that changes the workflow. Default a small, non-production experiment to `poc`.

Phase 1 implements only the POC skeleton. Do not simulate unavailable Implementation/PDLC integrations or advance a checkpoint that the Runner does not yet implement.

## Operate a POC

1. Read [references/poc-workflow.md](references/poc-workflow.md) before starting or resuming a POC.
2. Find the active Delivery Record under `.pdlc/records/`. Read it directly during normal work to avoid unnecessary script approvals.
3. If no record exists, prepare one from `pdlc/examples/poc-delivery-record.json`; do not invent missing product requirements, success criteria, or safety boundaries.
4. Read `pdlc/journeys/poc.json`, resolve Stage ids through `pdlc/stages/catalog.json`, and read the selected executable workflow's `deliveryDefaults`. When `collectDuringRequirements` is `false`, do not ask who fills Product, Developer, or QA and do not ask for a timebox. Copy the configured timebox into the Draft; the Runner resolves role assignments from the Build Readiness actor.
5. Read only the role definitions relevant to the current work from `pdlc/roles/`.
6. Read [references/requirements-clarification.md](references/requirements-clarification.md) and `pdlc/workflows/poc/requirements-policy.json`. Create the draft from `pdlc/templates/poc-requirements.md` and follow the required coverage, traceability, ambiguity analysis, and final-review protocol. For user-selected document mode, generate the question file from `pdlc/templates/poc-requirements-questions.md` at the policy-defined path, then stop until the user says it is complete.
7. Classify the technology independently of framework names. For example, React/Vue/Angular browser apps imply `web-ui`; native or cross-platform mobile apps imply `mobile-ui`.
8. Determine applicable Principle Packs across the active canonical Stage set using Journey, Stage, risk, technology, and domain metadata. `appliesTo.stages` in each pack is the authoritative mapping. Read every selected pack before proposing design or code. Read [references/principle-packs.md](references/principle-packs.md) when selecting or interpreting packs.
9. Read [references/standard-defaults.md](references/standard-defaults.md), resolve automatic standards using enterprise constraint → project default → enterprise default → Harness default precedence, and write all resolved standards into the Requirements `Applied Standards and Defaults` section. Do not ask the user to approve each default individually. Ask only when a product decision remains missing, an override is requested, or sources conflict.
10. Add selected pack references and concrete application notes to both the requirements document and Delivery Record. A generic statement such as “follow UX standards” is not sufficient. Keep user-confirmed product decisions as `RQ-xxx`; do not count automatic standards as answered questions.
11. Prepare the smallest reversible design and verification approach that satisfies the clarified requirements and selected principles.
12. Present the complete Requirements document and one Build Readiness summary containing behavior, edge cases, UX, NFRs, scope, data, success measures, applicable packs, resolved standards/defaults and overrides, deviations, open questions, proposed build, and a separately labelled workflow delivery-controls summary. Ask the user to explicitly approve the named document and Build Readiness, then stop.
13. Only after explicit approval, internally invoke `bun pdlc/cli.ts readiness build --record <POC-ID> --actor <identity>`. The Runner must atomically bind approval metadata to the Requirements content hash, validate Build Readiness, update the Record, and append its audit event in that one process. Do not edit approval fields manually.
14. If Build Readiness passes, implement exactly the approved scope. If requirements or selected standards change materially, the content-hash mismatch blocks further build activity; update the draft content, present a new Build Readiness summary, and obtain approval again.
15. Capture evidence as references, not pasted transcripts. Read [references/delivery-record.md](references/delivery-record.md) before updating a record.
16. Before a checkpoint, show a concise summary of state, risks, required evidence, exceptions, and proposed transition.
17. Invoke `bun pdlc/cli.ts checkpoint <name>` only after explicit user confirmation. One checkpoint must equal one Runner process.
18. Stop when required clarification coverage is incomplete, the policy's traceable-decision minimum is unmet, requirements are unapproved, questions or contradictions remain, standard-default conflicts or locked-constraint override attempts remain, final document review was not presented, Build Readiness fails, evidence is missing, risk rises beyond POC policy, a required principle is unsatisfied, or the Runner rejects the transition.

## Preserve control boundaries

- Treat the Delivery Record as workflow state and decision truth; link supporting documents and CI results as evidence.
- Treat the approved Requirements document as the functional build contract. Do not silently reinterpret it during implementation.
- Never edit state or audit fields to imitate a successful checkpoint.
- Never run JIRA, XRAY, deployment, or arbitrary project scripts through the PDLC Runner.
- Never productize by converting a POC record into a production record. Close the POC and supply its evidence to a new formal workflow.
- Keep Product, Developer, and QA as logical responsibilities rather than mandatory headcount.
- Apply `required` principles as blocking, `risk-based` principles when their trigger matches, and `advisory` principles as reported guidance.
- Never let a project profile or delivery-specific preference override a locked enterprise constraint. An overrideable default may be changed, but the Requirements must show the replacement and rationale.
- Do not copy shared workflow content into Codex- or Copilot-specific files.
- Do not redefine canonical Stage semantics inside a User Journey, Workflow, Principle Pack, or platform adapter. A Stage is not automatically a checkpoint.

## Use the Runner sparingly

- Treat the Runner as an internal Harness API, not a user interface.
- Never instruct an end user to copy or run a Bun command.
- Internally use `bun pdlc/cli.ts status` only when the active record cannot be determined safely by reading it.
- Internally use `bun pdlc/cli.ts validate` for an explicit integrity check or before proposing a checkpoint.
- Internally use `bun pdlc/cli.ts readiness build --record <POC-ID> --actor <identity>` exactly once after Requirements approval and before application construction.
- Internally use `bun pdlc/cli.ts checkpoint commit|verify|decide` only when implemented and after confirmation.
- Do not invoke internal TypeScript modules as scripts.
- Do not substitute another shell command for a rejected Runner operation.

## Report progress

State the current User Journey and canonical Stage, the active role slot, what changed, what remains, and whether a checkpoint is ready. Separate advisory gaps from blocking failures.
