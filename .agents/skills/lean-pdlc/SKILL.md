---
name: lean-pdlc
description: Guide lightweight, risk-based product delivery using canonical Stages, Delivery Flows, Domain-owned Controls and Knowledge, Project Overlays, capability Plugins, Delivery Records, and auditable evidence. Use when starting or continuing a POC, implementation, or end-to-end PDLC delivery.
---

# Lean PDLC

Use the shared Stage Catalog, Delivery Flow definitions, and deterministic TypeScript Runner. Keep routine development conversational and file-based; invoke the Runner only for explicit validation or controlled state transitions.

## Activate conversationally

Recognize these user intents as equivalent activation requests:

- `/pdlc poc [optional idea]`
- `$lean-pdlc poc [optional idea]`
- “start a POC” or an equivalent request in the user's language

When a message beginning with `/pdlc` reaches the agent as text, interpret it as:

```text
/pdlc <delivery-flow> [optional context]
```

The currently executable Delivery Flow is `poc`. `implementation` and `pdlc` are registered but planned. Also recognize `/pdlc resume [POC-ID]`, `/pdlc status`, and `/pdlc help` as conversation intents, not Runner commands.

After activation:

1. Acknowledge the selected Delivery Flow and current phase in one short sentence.
2. Inspect the active Delivery Record by reading files. Resolve only the selected Catalog entry, Flow fields, and current Stage definition needed now; do not load the whole Stage Catalog, all Domains, or future Stage material into the conversation.
3. If starting and the prompt already contains an idea, do not ask for it again. Create only the minimal incomplete DRAFT Record and Requirements shell needed to preserve that idea and its known technology tags. If the idea is absent, ask for it immediately and defer file creation. Leave unknown product fields empty rather than inventing success criteria or safety boundaries. Apply Delivery Flow-owned defaults without asking product-requirement questions about role assignment or timebox.
4. Determine whether requirements need minimal, standard, or comprehensive depth. For a user-facing greenfield POC, default to standard depth.
5. Resolve only conditional Stages implied by context already known. Do not resolve or prepare future Stages in anticipation. System-supplied context removes repetitive questions but never replaces confirmation of the user, problem, behavior, business rules, scenarios, scope, data decisions, or success measures. Every unresolved product question must offer 2–4 mutually exclusive, selectable options, plus `X) Other`. The user can answer by choosing an option letter and may add detail for `X) Other`; do not ask an open-ended question as the primary answer. Never exceed `questionRules.maxQuestionsPerRound` in chat.
6. Before performing work for the current canonical Stage, internally invoke `bun pdlc/cli.ts context <stage-id> --root <project-root>` exactly once for that Stage entry. Apply mandatory Controls, auto-apply Project Baselines and resolved Defaults, consult only relevant returned Knowledge, and read every returned Plugin Agent and Skill path. Preserve each Plugin's permissions and approval boundary. An empty capability list means continue with core behavior. Never ask the end user to select a Plugin Agent manually. `guidance <stage-id>` remains a compatibility view of Plugin-only contributions and is not an additional startup call.
7. Maintain both the Delivery Record and `.pdlc/requirements/<POC-ID>.md` behind the conversation; summarize material changes.
8. Never create or modify application code, install application dependencies, or run an application build until the user explicitly approves the Requirements and Build Readiness summary.
9. Never show Bun commands or ask the end user to execute the Runner. Invoke the internal Runner yourself only for Stage contribution resolution, validation, Build Readiness, or a checkpoint.
10. Before any state-changing Runner call, present the proposed transition and request explicit confirmation. Stage contribution resolution is read-only and needs no confirmation.

## Fast start and just-in-time loading

Starting requirements conversation quickly is a product requirement of the Harness. When a fresh POC request already includes an idea, the next user-visible response after minimal setup must contain the first clarification round.

Before that first clarification round, do only this:

1. read the active-record pointer and the minimum POC Flow defaults, Requirements Flow Control, and Requirements template needed to create a Draft;
2. create a minimal DRAFT Delivery Record and Requirements shell;
3. classify only technology and domain tags evident from the user's prompt;
4. enter `requirements-clarification` and make one read-only `context requirements-clarification` Runner call;
5. read the Plugin Agent and Skill files returned by that call; and
6. ask the first focused clarification round immediately.

Delay all other work until it is required:

- Do not run full Harness `validate` before the first clarification round unless startup inputs fail schema or reference loading and validation is needed to diagnose the failure.
- Do not invoke `context` for Ideation, Design, Build, Verification, or any other future Stage in advance. Enter and resolve each Stage just in time.
- Do not read every role, Domain asset, Control file, Knowledge document, or Delivery Flow Stage definition at startup. Read returned material only when the current Stage needs it.
- Do not expand the complete Control, Default, provenance, design, or verification tables before the user has answered the first round. Keep the Draft minimal, retain resolved references, and materialize concrete applications incrementally.
- Do not inspect application files, install dependencies, choose a framework setup, or prepare implementation before Build Readiness.
- Do not repeat stable Skill or reference reads already available in the current conversation unless the source changed or the needed detail was not loaded.

Before final Requirements review and Build Readiness, perform the full reconciliation: resolve all applicable Controls, Project Baselines, Defaults, Knowledge, and Capabilities; complete provenance and application notes; validate the Harness and active Record; and present the complete Artifact. Fast start changes scheduling, never governance strength.

## Select the Delivery Flow

- Choose `poc` for fast idea validation without JIRA, XRAY, production deployment, or formal release gates.
- Choose `implementation` when requirements or stories already exist and delivery needs development, QA, sign-off, and release integration.
- Choose `pdlc` for ideation through requirements, implementation, validation, release, and outcome review.
- If unclear, ask only for the missing decision that changes the Delivery Flow. Default a small, non-production experiment to `poc`.

v2 currently executes only the POC path. Do not simulate unavailable Implementation/PDLC integrations or advance a checkpoint that the Runner does not yet implement.

## Operate a POC

1. Read [references/poc-delivery-flow.md](references/poc-delivery-flow.md) before starting or resuming a POC.
2. Find the active Delivery Record under `.pdlc/records/`. Read it directly during normal work to avoid unnecessary script approvals.
3. If no record exists, prepare one from `pdlc/examples/poc-delivery-record.json`; do not invent missing product requirements, success criteria, or safety boundaries.
4. Read only the selected fields from `pdlc/delivery-flows/poc/flow.json` and the current Stage definition from `pdlc/stages/catalog.json`. At startup, the required Flow fields are status, `controls.deliveryDefaults`, constraints, and the activation tags implied by known technology or risk. Do not enumerate the entire Flow or Stage Catalog before the first question. When `collectDuringRequirements` is `false`, do not ask who fills Product, Developer, or QA and do not ask for a timebox. Copy the configured timebox into the Draft; the Runner resolves role assignments from the Build Readiness actor.
5. Read a role definition only when its current Stage responsibility changes the next action. Do not read every role at startup.
6. Read [references/requirements-clarification.md](references/requirements-clarification.md) and `pdlc/delivery-flows/poc/controls/requirements.json`. Create the draft from `pdlc/domains/product-management/artifacts/requirements/templates/default.md`. For document mode, use the sibling `questions.md` template at the Flow Control's configured path, then stop until the user says it is complete.
7. Classify the technology independently of framework names. For example, React/Vue/Angular browser apps imply `web-ui`; native or cross-platform mobile apps imply `mobile-ui`.
8. Read [references/domain-context.md](references/domain-context.md), then use the current Stage's `context` result as the authoritative resolved view. Do not independently scan every Domain folder. Controls are mandatory. Guidance, References, and KB are advisory context. Defaults are auto-applied unless a higher-precedence source or locked Control prevents an override.
9. Resolve project-specific context only from `.pdlc/project/domains/<domain>/`: approved `baseline.json`, cumulative `controls/`, overrideable `defaults/`, and project `knowledge/`. Never let project content weaken an enterprise Control.
10. Record applicable Control references in the Draft without delaying the first clarification round. Add concrete application notes incrementally when product behavior, design, and evidence make them meaningful, and complete them before final Requirements review. Keep user-confirmed product decisions as `RQ-xxx`; do not count automatic context as answered questions.
11. Prepare the smallest reversible design and verification approach that satisfies the clarified Requirements, mandatory Controls, and approved Project Baselines.
12. Present the complete Requirements Artifact and one Build Readiness summary containing behavior, edge cases, UX, quality attributes, scope, data, success measures, Controls and exceptions, Baselines, resolved Defaults, relevant Knowledge and Capabilities, deviations, open questions, and proposed build. Ask the user to explicitly approve the named document and Build Readiness, then stop.
13. Only after explicit approval, internally invoke `bun pdlc/cli.ts readiness build --record <POC-ID> --actor <identity>`. The Runner must atomically bind approval metadata to the Requirements content hash, validate Build Readiness, update the Record, and append its audit event in that one process. Do not edit approval fields manually.
14. If Build Readiness passes, implement exactly the approved scope. If Requirements, applicable Controls, Project Baselines, or resolved Defaults change materially, the content-hash mismatch blocks further build activity; update the draft content, present a new Build Readiness summary, and obtain approval again.
15. Capture evidence as references, not pasted transcripts. Read [references/delivery-record.md](references/delivery-record.md) before updating a record.
16. Before a checkpoint, show a concise summary of state, risks, required evidence, exceptions, and proposed transition.
17. Invoke `bun pdlc/cli.ts checkpoint <name>` only after explicit user confirmation. One checkpoint must equal one Runner process.
18. Stop when required clarification coverage is incomplete, the Flow Control's traceable-decision minimum is unmet, Requirements are unapproved, questions or contradictions remain, context resolution conflicts or locked-Control override attempts remain, final document review was not presented, Build Readiness fails, evidence is missing, risk rises beyond POC policy, a mandatory Control is unsatisfied, or the Runner rejects the transition.

## Preserve control boundaries

- Treat the Delivery Record as Delivery Flow state and decision truth; link supporting documents and CI results as evidence.
- Treat the approved Requirements document as the functional build contract. Do not silently reinterpret it during implementation.
- Never edit state or audit fields to imitate a successful checkpoint.
- Never run JIRA, XRAY, deployment, or arbitrary project scripts through the PDLC Runner.
- Never productize by converting a POC record into a production record. Close the POC and supply its evidence to a new formal Delivery Flow.
- Keep Product, Developer, and QA as logical responsibilities rather than mandatory headcount.
- Treat applicable Controls as blocking and Knowledge as advisory. A Control exception requires the declared approver and evidence path.
- Never let a Project Overlay override a locked enterprise Control. An overrideable Default may be changed, but the Requirements must show the replacement and rationale.
- Do not copy shared Delivery Flow content into Codex- or Copilot-specific files.
- Do not redefine canonical Stage semantics inside a Delivery Flow, Domain asset, Plugin, or platform adapter. A Stage is not automatically a checkpoint.

## Use the Runner sparingly

- Treat the Runner as an internal Harness API, not a user interface.
- Never instruct an end user to copy or run a Bun command.
- Internally use `bun pdlc/cli.ts status` only when the active record cannot be determined safely by reading it.
- Internally use `bun pdlc/cli.ts context <stage-id> --root <project-root>` once whenever entering a canonical POC Stage, before doing its work.
- On fresh activation with an idea, normally make only the one `context requirements-clarification` Runner call before the first question. Do not make anticipatory Context or compatibility Guidance calls.
- Internally use `bun pdlc/cli.ts validate` for an explicit integrity check, recovery from a definition failure, or final reconciliation before Build Readiness. Never use it as routine pre-question startup work.
- Internally use `bun pdlc/cli.ts readiness build --record <POC-ID> --actor <identity>` exactly once after Requirements approval and before application construction.
- Internally use `bun pdlc/cli.ts checkpoint commit|verify|decide` only when implemented and after confirmation.
- Do not invoke internal TypeScript modules as scripts.
- Do not substitute another shell command for a rejected Runner operation.

## Report progress

State the current Delivery Flow and canonical Stage, the active role slot, what changed, what remains, and whether a checkpoint is ready. Separate advisory gaps from blocking failures.
