# 02. Run a Lean PDLC POC

This guide is for the person using Lean PDLC in a Copilot conversation. You describe the outcome; the Agent maintains the Delivery Flow artifacts and invokes internal checks when needed.

## Start with an idea

Use a short outcome-oriented request:

```text
/pdlc poc validate whether support agents can classify customer feedback into billing, access, and product-bug categories.
```

The Agent opens a draft POC. The Harness establishes its DRAFT Delivery Record, current selection, and `DELIVERY_FLOW_CREATED` audit event together, so the audit timeline starts at creation. It does not start coding yet.

Startup uses a fast path: the Agent creates a minimal Draft, resolves the Requirements Stage context once, reads any returned Domain contribution, and asks the first clarification round. Full validation, future Stage resolution, detailed Control application, design, and verification planning happen only when needed and are completed before Build Readiness.

You do not select Domain Agents separately. Before each Stage, the main Agent resolves applicable Policies/Controls, Project Baselines and Defaults, relevant Knowledge, Domain contributions, and Integrations. For example, the UX Domain supplies mandatory experience Policies plus Stage-bound Skills and an Agent.

## Answer requirement questions by choosing options

The Agent asks at most three unresolved product questions per message. Every question has 2–4 selectable, mutually exclusive answers plus `X) Other`; choose a letter and add detail only when needed.

```text
1. Who uses the first version?
   A) Internal support agents
   B) Product managers
   C) Customers directly
   X) Other: ...

2. What is the required output?
   A) One category per feedback item
   B) Category plus confidence
   C) Ranked top three categories
   X) Other: ...

Answer: 1A, 2B
```

This keeps clarification fast and makes decisions traceable. If an option is wrong, choose `X) Other` and state the missing detail.

## Use document mode when many people need to answer

Say:

```text
Use document mode for the remaining requirements questions.
```

The Agent creates a fillable file under `pdlc/requirements/`. Complete the `[Answer]` fields, then say that the questionnaire is complete. The Agent turns the answers into requirements decisions and presents the finished requirements document for review.

## Approve Build Readiness

Before any product code changes, the Agent presents:

```text
Requirements summary
  -> scope and behavior
  -> UX and failure states
  -> data and safety boundaries
  -> success criteria and verification approach
  -> mandatory Controls, Project Baselines, Defaults, and exceptions
  -> proposed build
```

Review it and explicitly approve the named Requirements Artifact and Build Readiness. This is the one POC approval checkpoint before construction. A material requirement or Control-disposition change invalidates the approval and requires a new review.

The approved Build Readiness operation is also the `commit` transition from `DRAFT` to `COMMITTED`. If the POC Requirements change materially during implementation, the Agent presents the complete revision and records a controlled `COMMITTED → COMMITTED` recommit before continuing. After implementation, the Agent presents captured test, build, demo, and any required security evidence for `verify`.

After Verify, Product chooses one disposition:

- `park` moves the POC to `PARKED`, preserving Requirements, code, design, and evidence for possible future work.
- `recommend-productization` requires a reviewed Productization Package at `pdlc/artifacts/<POC-ID>/productization-package.md` and moves the POC to `PRODUCTIZATION_RECOMMENDED`.

The package references the approved Requirements, evidence, Controls and exceptions, known gaps, and `adopt`/`refine`/`replace` decisions for Requirements, Design, and Code. The Runner validates it and binds its content hash to the Delivery Record and audit event.

## Follow progress or resume later

Use conversational intents:

```text
/pdlc status
/pdlc audit
/pdlc audit <POC-ID>
/pdlc resume <POC-ID>
/pdlc help
```

The Agent reports the current Stage and state, available next actions, known blockers, Requirements approval, evidence readiness, applied Policies/Knowledge/Skills, and Productization Package readiness. An action marked unavailable includes the reason, so you do not need to inspect the Delivery Record to discover what remains. Status is read-only and does not create an Audit Event or advance the Delivery Flow.

The status check remains fast: it derives routine progress from the current Delivery Record and recorded Context Applications. It validates the Productization Package only after the POC reaches `VERIFIED`, when that information can affect the next decision. Do not run the PDLC Runner manually; that is internal Agent/maintainer machinery.

The audit view is intentionally concise. It reports:

```text
Current conclusion
  Requirements approved and Build Readiness passed
  Verification approved
  POC parked / Productization recommended

Timeline
  timestamp — action — actor — evidence
```

It also lists applicable Controls, satisfied Controls, exceptions, evidence references, and any mismatch where the Delivery Record indicates completion but the corresponding append-only Audit Event is missing. The summary is only a readable view; the original Audit Log remains the source of truth.

## What the current v2 POC does and does not do

The v2 POC executes Requirements, context resolution, lightweight design, Build Readiness/Commit, implementation, Verify, and Decide. It does not integrate JIRA, XRAY, CI/CD, deployment, or production release. `PRODUCTIZATION_RECOMMENDED` packages evidence for a separate formal Delivery Flow; it does not mean productization or production release is complete.

## Next

Continue with [03. Add Domain Contributions](03-ADD-DOMAIN-CONTRIBUTIONS.md) if your team wants to bind specialized Agents and Skills into a Delivery Flow.
