---
name: lean-pdlc
description: Guide lightweight, risk-based product delivery using canonical Stages, Delivery Flows, Domain-owned Policies, Knowledge, Skills, Agents and Hooks, top-level Integrations, Project Overlays, Delivery Records, and auditable evidence. Use when starting or continuing a POC, implementation, or end-to-end PDLC delivery.
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

The currently executable Delivery Flow is `poc`. `implementation` and `pdlc` are registered but planned. Also recognize `/pdlc resume [POC-ID]`, `/pdlc status`, `/pdlc audit [POC-ID]`, and `/pdlc help` as conversation intents, not Runner commands.

After activation:

1. Acknowledge the selected Delivery Flow and current phase in one short sentence.
2. Inspect the active Delivery Record by reading files. Resolve only the selected Catalog entry, Flow fields, and current Stage definition needed now; do not load the whole Stage Catalog, all Domains, or future Stage material into the conversation.
3. If starting and the prompt already contains an idea, do not ask for it again. Create only the minimal incomplete DRAFT Record and Requirements shell needed to preserve that idea and its known technology tags. If the idea is absent, ask for it immediately and defer file creation. Leave unknown product fields empty rather than inventing success criteria or safety boundaries. Apply Delivery Flow-owned defaults without asking product-requirement questions about role assignment or timebox.
4. Determine whether requirements need minimal, standard, or comprehensive depth. For a user-facing greenfield POC, default to standard depth.
5. Resolve only conditional Stages implied by context already known. Do not resolve or prepare future Stages in anticipation. System-supplied context removes repetitive questions but never replaces confirmation of the user, problem, behavior, business rules, scenarios, scope, data decisions, or success measures. Every unresolved product question must offer 2–4 mutually exclusive, selectable options, plus `X) Other`. The user can answer by choosing an option letter and may add detail for `X) Other`; do not ask an open-ended question as the primary answer. Never exceed `questionRules.maxQuestionsPerRound` in chat.
6. Before performing work for the current canonical Stage, internally invoke `bun .pdlc/cli.ts context <stage-id> --root <project-root>` exactly once for that Stage entry. Apply mandatory Policies as Controls, auto-apply Project Baselines and resolved Defaults, consult only relevant returned Knowledge, and read every returned Domain Agent, Domain Skill, and Integration Skill path. Preserve declared permissions and approval boundaries. Empty Domain contributions or Integrations mean continue with core behavior. Never ask the end user to select a Domain Agent manually. `guidance <stage-id>` remains a Domain-contribution compatibility view and is not an additional startup call.
7. Persist a small Stage Context Receipt under `pdlc/evidence/context/` only when the current or next controlled checkpoint requires it, or when the Stage executes a Domain contribution, Integration, or Policy enforcement that needs provenance. Acknowledge every resolved Policy; mark each Knowledge, Domain contribution, and Integration as `used` or `not-used`; and attach output/evidence references whenever it was used. Apply it internally with `context-apply <stage-id>`. Do not create receipts for lightweight analysis-only Stages just to prove that the Agent visited them. This operational provenance write is not a checkpoint and needs no separate confirmation. Never claim `used` before reading or executing the asset.
8. Maintain both the Delivery Record and `pdlc/requirements/<POC-ID>.md` behind the conversation; summarize material changes.
9. Never create or modify application code, install application dependencies, or run an application build until the user explicitly approves the Requirements and Build Readiness summary.
10. Never show Bun commands or ask the end user to execute the Runner. Invoke the internal Runner yourself only for Stage contribution resolution/application, validation, Build Readiness, or a checkpoint.
11. Before a governed state transition, checkpoint, or approval decision, present the proposed transition and request explicit confirmation. Read-only Stage context and its operational receipt do not need confirmation.

## Fast start and just-in-time loading

Starting requirements conversation quickly is a product requirement of the Harness. When a fresh POC request already includes an idea, the next user-visible response after minimal setup must contain the first clarification round.

Before that first clarification round, do only this:

1. read the active-record pointer and the minimum POC Flow defaults, Requirements Flow Control, and Requirements template needed to create a Draft;
2. create a minimal DRAFT Delivery Record and Requirements shell;
3. classify only technology and domain tags evident from the user's prompt;
4. enter `requirements-clarification` and make one read-only `context requirements-clarification` Runner call;
5. read the Domain Agent and Skill files returned by that call; and
6. ask the first focused clarification round immediately.

Delay all other work until it is required:

- Do not run full Harness `validate` before the first clarification round unless startup inputs fail schema or reference loading and validation is needed to diagnose the failure.
- Do not invoke `context` for Ideation, Design, Build, Verification, or any other future Stage in advance. Enter and resolve each Stage just in time.
- Do not read every role, Domain asset, Control file, Knowledge document, or Delivery Flow Stage definition at startup. Read returned material only when the current Stage needs it.
- Do not expand the complete Control, Default, provenance, design, or verification tables before the user has answered the first round. Keep the Draft minimal, retain resolved references, and materialize concrete applications incrementally.
- Do not inspect application files, install dependencies, choose a framework setup, or prepare implementation before Build Readiness.
- Do not repeat stable Skill or reference reads already available in the current conversation unless the source changed or the needed detail was not loaded.

Before final Requirements review and Build Readiness, perform the full reconciliation: resolve all applicable Policies/Controls, Project Baselines, Defaults, Knowledge, Domain contributions, and Integrations; complete provenance and application notes; validate the Harness and active Record; and present the complete Artifact. Fast start changes scheduling, never governance strength.

The receipt is intentionally delayed until Stage work is complete. It adds no startup question, network call, or future-Stage scan; it hashes only the small set of local assets already resolved for the current Stage.

## Select the Delivery Flow

- Choose `poc` for fast idea validation without JIRA, XRAY, production deployment, or formal release gates.
- Choose `implementation` when requirements or stories already exist and delivery needs development, QA, sign-off, and release integration.
- Choose `pdlc` for ideation through requirements, implementation, validation, release, and outcome review.
- If unclear, ask only for the missing decision that changes the Delivery Flow. Default a small, non-production experiment to `poc`.

v2 currently executes only the POC path, including Commit through Build Readiness plus Verify and Decide. Do not simulate unavailable Implementation/PDLC integrations or production-release behavior.

## Operate a POC

1. Read [references/poc-delivery-flow.md](references/poc-delivery-flow.md) before starting or resuming a POC.
2. Find the active Delivery Record under `.pdlc/runtime/records/`. Read it directly during normal work to avoid unnecessary script approvals.
3. If no record exists, prepare one from `.pdlc/examples/poc-delivery-record.json`; do not invent missing product requirements, success criteria, or safety boundaries.
4. Read only the selected fields from `.pdlc/delivery-flows/poc/flow.json` and the current Stage definition from `.pdlc/stages/catalog.json`. At startup, the required Flow fields are status, `controls.deliveryDefaults`, constraints, and the activation tags implied by known technology or risk. Do not enumerate the entire Flow or Stage Catalog before the first question. When `collectDuringRequirements` is `false`, do not ask who fills Product, Developer, or QA and do not ask for a timebox. Copy the configured timebox into the Draft; the Runner resolves role assignments from the Build Readiness actor.
5. Read a role definition only when its current Stage responsibility changes the next action. Do not read every role at startup.
6. Read [references/requirements-clarification.md](references/requirements-clarification.md) and `.pdlc/delivery-flows/poc/controls/requirements.json`. Create the draft from `.pdlc/domains/product-management/artifacts/requirements/templates/default.md`. For document mode, use the sibling `questions.md` template at the Flow Control's configured path, then stop until the user says it is complete.
7. Classify the technology independently of framework names. For example, React/Vue/Angular browser apps imply `web-ui`; native or cross-platform mobile apps imply `mobile-ui`.
8. Read [references/domain-context.md](references/domain-context.md), then use the current Stage's `context` result as the authoritative resolved view. Do not independently scan every Domain folder. Controls are mandatory. Guidance, References, and KB are advisory context. Defaults are auto-applied unless a higher-precedence source or locked Control prevents an override.
9. Resolve project-specific context only from `pdlc/config/domains/<domain>/`: approved `baseline.json`, cumulative `policies/`, overrideable `defaults/`, and project `knowledge/`. Never let project content weaken an enterprise Policy/Control.
10. Record applicable Control references in the Draft without delaying the first clarification round. Add concrete application notes incrementally when product behavior, design, and evidence make them meaningful, and complete them before final Requirements review. Keep user-confirmed product decisions as `RQ-xxx`; do not count automatic context as answered questions.
11. Prepare the smallest reversible design and verification approach that satisfies the clarified Requirements, mandatory Controls, and approved Project Baselines.
12. Present the complete Requirements Artifact and one Build Readiness summary containing behavior, edge cases, UX, quality attributes, scope, data, success measures, Policies/Controls and exceptions, Baselines, resolved Defaults, relevant Knowledge, Domain contributions and Integrations, deviations, open questions, and proposed build. Ask the user to explicitly approve the named document and Build Readiness, then stop.
13. Before invoking Build Readiness, ensure current receipts for `requirements-clarification` and `build-readiness` have been applied. Only after explicit approval, internally invoke `bun .pdlc/cli.ts readiness build --record <POC-ID> --actor <identity>`. That operation binds approval metadata to the Requirements content hash, validates Build Readiness, moves the Record from `DRAFT` to `COMMITTED`, and appends the Commit audit event. Do not edit approval or state fields manually.
14. If Build Readiness passes, implement exactly the approved scope. If Requirements, applicable Controls, Project Baselines, or resolved Defaults change materially, the content-hash or context mismatch blocks further governed progress; update the Artifact and Record, present a new Build Readiness summary, and obtain approval again. The POC Commit permits an audited `COMMITTED → COMMITTED` recommit for this controlled iteration.
15. Capture tests, build, demo, and conditionally required security evidence as references, not pasted transcripts. Read [references/delivery-record.md](references/delivery-record.md) before updating a record. Before Verify, keep the Commit receipts current and apply receipts for `implementation`, `developer-verification`, `acceptance-verification`, and `security-verification` when that conditional Stage is active.
16. Before Decide, offer only `park` or `recommend-productization`. Park preserves the POC and its evidence for a possible later iteration. For `recommend-productization`, create `pdlc/artifacts/<POC-ID>/productization-package.md` from the Product-owned template, link the approved Requirements, all captured evidence, applicable Controls and exceptions, and record `adopt`, `refine`, or `replace` for Requirements, Design, and Code. Present the complete package for explicit Product review before the checkpoint.
17. Before a checkpoint, show a concise summary of state, risks, required evidence, exceptions, and proposed transition. Invoke `bun .pdlc/cli.ts checkpoint <name>` only after explicit user confirmation. One checkpoint must equal one Runner process.
18. Stop when required clarification coverage is incomplete, the Flow Control's traceable-decision minimum is unmet, Requirements are unapproved, questions or contradictions remain, context resolution conflicts or locked-Control override attempts remain, final document review was not presented, Build Readiness fails, evidence is missing, risk rises beyond POC policy, a mandatory Control is unsatisfied, or the Runner rejects the transition.

## Preserve control boundaries

- Treat the Delivery Record as Delivery Flow state and decision truth; link supporting documents and CI results as evidence.
- Treat the approved Requirements document as the functional build contract. Do not silently reinterpret it during implementation.
- Never edit state or audit fields to imitate a successful checkpoint.
- Never run JIRA, XRAY, deployment, or arbitrary project scripts through the PDLC Runner.
- Never treat `PRODUCTIZATION_RECOMMENDED` as completed productization or production approval. It requires a content-hash-bound Productization Package that becomes input to a new formal Delivery Flow; formal Requirements, design, Stories, test cases, JIRA/Xray work, release, and production validation remain downstream work.
- Keep Product, Developer, and QA as logical responsibilities rather than mandatory headcount.
- Treat applicable Controls as blocking and Knowledge as advisory. A Control exception requires the declared approver and evidence path.
- Never let a Project Overlay override a locked enterprise Control. An overrideable Default may be changed, but the Requirements must show the replacement and rationale.
- Do not copy shared Delivery Flow content into Codex- or Copilot-specific files.
- Do not redefine canonical Stage semantics inside a Delivery Flow, Domain asset, Hook, Integration, or platform adapter. A Stage is not automatically a checkpoint.

## Use the Runner sparingly

- Treat the Runner as an internal Harness API, not a user interface.
- Never instruct an end user to copy or run a Bun command.
- Internally use `bun .pdlc/cli.ts status` only when the active record cannot be determined safely by reading it.
- When the user asks for an audit history or control-review summary, internally use the read-only `audit summary` operation and present its headline, milestones, warnings, and concise timeline. Do not treat the summary as a replacement for the append-only Audit Log.
- Internally use `bun .pdlc/cli.ts context <stage-id> --root <project-root>` once whenever entering a canonical POC Stage, before doing its work.
- Use `context-apply` after a Stage only when its provenance is required by Build Readiness or Verify, or when a material Domain contribution, Integration, or Policy enforcement was executed. Build Readiness requires receipts for `requirements-clarification` and `build-readiness`; Verify revalidates those receipts and also requires `implementation`, `developer-verification`, `acceptance-verification`, and the active conditional `security-verification` Stage. A local receipt must never delay the first clarification round.
- On fresh activation with an idea, normally make only the one `context requirements-clarification` Runner call before the first question. Do not make anticipatory Context or compatibility Guidance calls.
- Internally use `bun .pdlc/cli.ts validate` for an explicit integrity check, recovery from a definition failure, or final reconciliation before Build Readiness. Never use it as routine pre-question startup work.
- Internally use `bun .pdlc/cli.ts readiness build --record <POC-ID> --actor <identity>` exactly once after Requirements approval and before application construction.
- Treat approved `readiness build` as Commit. Internally use `checkpoint verify` after verification approval and `checkpoint decide --outcome park|recommend-productization` after the final outcome approval. The latter outcome must not pass without the reviewed Productization Package at the canonical project path.
- Do not invoke internal TypeScript modules as scripts.
- Do not substitute another shell command for a rejected Runner operation.

## Report progress

State the current Delivery Flow and canonical Stage, the active role slot, what changed, what remains, and whether a checkpoint is ready. Separate advisory gaps from blocking failures.
