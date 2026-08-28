# 02. Run a POC

This guide is for the person using Lean PDLC in a Copilot conversation. You describe the outcome; the Agent maintains the workflow files and invokes internal checks when needed.

## Start with an idea

Use a short outcome-oriented request:

```text
/pdlc poc validate whether support agents can classify customer feedback into billing, access, and product-bug categories.
```

The Agent opens a draft POC. It does not start coding yet.

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

The Agent creates a fillable file under `.pdlc/questions/`. Complete the `[Answer]` fields, then say that the questionnaire is complete. The Agent turns the answers into requirements decisions and presents the finished requirements document for review.

## Approve Build Readiness

Before any product code changes, the Agent presents:

```text
Requirements summary
  -> scope and behavior
  -> UX and failure states
  -> data and safety boundaries
  -> success criteria and verification approach
  -> applicable standards and exceptions
  -> proposed build
```

Review it and explicitly approve the named Requirements document and Build Readiness. This is the one Phase 1 approval gate before construction. A material requirement change invalidates the approval and requires a new review.

## Follow progress or resume later

Use conversational intents:

```text
/pdlc status
/pdlc resume <POC-ID>
/pdlc help
```

The Agent reports the active Stage, what changed, blocking questions, and the next action. Do not run the PDLC Runner manually; that is internal Agent/maintainer machinery.

## What Phase 1 does and does not do

Phase 1 can guide a POC through requirements, lightweight design, Build Readiness, implementation, and evidence collection. It does not yet execute formal Commit, Verify, or Decide transitions, nor does it integrate JIRA, XRAY, CI/CD, deployment, or production release.

## Next

Continue with [03. Build a Copilot Plugin](03-BUILD-A-COPILOT-PLUGIN.md) if your team wants a specialized Agent or Skills.
