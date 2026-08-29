# POC Delivery Flow reference

## Objective

Answer whether an idea is feasible or worth productizing through a bounded, non-production experiment.

## Flow

`Idea → Requirements Clarification → Requirements Artifact → Context-aware Lightweight Design → Build Readiness Approval → Implementation → Verification → Kill / Pivot / Productize`

## Fast start

When the activation prompt includes an idea, create a minimal Draft, resolve only the `requirements-clarification` Stage context, read its returned Domain contribution, and ask the first clarification round immediately. Do not wait for complete Control tables, future Stage resolution, full validation, detailed design, or verification planning. Complete those items incrementally and reconcile all of them before Build Readiness.

Requirements clarification is always executed, with a minimal, standard, or comprehensive profile. The Agent loads `.pdlc/delivery-flows/poc/controls/requirements.json`, maintains the `product-management.requirements` Artifact through focused conversational rounds, and traces each resolved product question as an `RQ-xxx` decision. The Artifact also discloses applicable Controls, Project Baselines, resolved Defaults, and the lightweight design.

Role assignment and timebox are defined by `flow.json#controls.deliveryDefaults`, not elicited as product requirements. For the default POC profile, the Build Readiness actor fills Product, Developer, and QA and the timebox is one working day. The Runner materializes the actor assignment during approval.

Before approval, the Agent resolves contradictions and open questions, reconciles the Delivery Record, and presents the complete Requirements document for explicit review. Confirmation of an earlier product definition or individual question is not final document approval.

Build Readiness is the single pre-build human confirmation. It freezes the reviewed Requirements Artifact and records how each applicable Control is satisfied or formally excepted. The Runner rejects incomplete coverage, too few traceable decisions, unresolved questions or contradictions, draft placeholders, missing review markers, unresolved context conflicts, or incomplete business fields.

## Checkpoints

1. `commit`: approved `readiness build` confirms the Requirements, measurable success criteria, timebox, scope, role assignments, safety boundary, Controls and exceptions, Project Baselines, and lightweight design, then moves `DRAFT → COMMITTED`. A materially revised POC may repeat the approval as an audited `COMMITTED → COMMITTED` recommit.
2. `verify`: confirm tests, build, demo, conditionally required security evidence, current material Stage receipts, and Control evidence, then move `COMMITTED → VERIFIED`.
3. `decide`: record `kill`, `pivot`, or `productize` with rationale and follow-up, then close the POC in the corresponding terminal status.

Do not deploy to production, create JIRA/XRAY assets, or treat `productize` as release approval. Productize closes the POC and supplies evidence to a new formal Delivery Flow.

## Role slots

- Product: define the problem, hypothesis, outcome, success criteria, scope, and final decision.
- Developer: design and implement the smallest useful experiment and technical verification.
- QA: define verification scenarios, check evidence, and challenge unsupported conclusions.

One person may fill all slots unless an applicable governance rule requires separation.
