# POC workflow reference

## Objective

Answer whether an idea is feasible or worth productizing through a bounded, non-production experiment.

## Flow

`Idea → Requirements Clarification → Requirements Document → Principle-led Lightweight Design → Build Readiness Approval → Implementation → Verification → Kill / Pivot / Productize`

Requirements clarification is always executed, with minimal, standard, or comprehensive depth. The Agent loads `pdlc/workflows/poc/requirements-policy.json`, maintains `.pdlc/requirements/<POC-ID>.md` through focused conversational rounds, and traces each resolved product question as an `RQ-xxx` decision. A standard user-facing POC must cover product context, exact functional behavior, user scenarios, UX interaction, quality attributes, data and integrations, and scope and success. It must also contain testable acceptance criteria, applicable Principle Packs, and the lightweight design.

Role assignment and timebox are defined by `workflow.json#deliveryDefaults`, not elicited as product requirements. For the default POC profile, the Build Readiness actor fills Product, Developer, and QA and the timebox is one working day. The Runner materializes the actor assignment during approval.

Before approval, the Agent resolves contradictions and open questions, reconciles the Delivery Record, and presents the complete Requirements document for explicit review. Confirmation of an earlier product definition or individual question is not final document approval.

Build Readiness is the single pre-build human confirmation. It freezes the reviewed Requirements document and records how each applicable Principle Pack will be used. The Runner rejects incomplete policy coverage, too few traceable decisions, unresolved questions or contradictions, draft placeholders, missing review markers, or incomplete business fields. No application code, application dependency installation, or application build may begin before approval and a successful internal readiness check.

## Checkpoints

1. `commit`: confirm the approved requirements, measurable success criteria, timebox, scope, role assignments, safety boundary, applicable principles, and lightweight design. In Phase 1, `readiness build` enforces the pre-build subset without imitating the unimplemented state transition.
2. `verify`: confirm the implementation result and evidence against every success criterion.
3. `decide`: record `kill`, `pivot`, or `productize` with rationale and follow-up.

Do not deploy to production, create JIRA/XRAY assets, or treat `productize` as release approval. Productize closes the POC and supplies evidence to a new formal workflow.

## Role slots

- Product: define the problem, hypothesis, outcome, success criteria, scope, and final decision.
- Developer: design and implement the smallest useful experiment and technical verification.
- QA: define verification scenarios, check evidence, and challenge unsupported conclusions.

One person may fill all slots unless an applicable governance rule requires separation.
