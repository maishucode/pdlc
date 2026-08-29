# 02. Run a Lean PDLC POC

This guide is for the person using Lean PDLC in a Copilot conversation. You describe the outcome; the Agent maintains the Delivery Flow artifacts and invokes internal checks when needed.

## Start with an idea

Use a short outcome-oriented request:

```text
/pdlc poc validate whether support agents can classify customer feedback into billing, access, and product-bug categories.
```

The Agent opens a draft POC. It does not start coding yet.

Startup uses a fast path: the Agent creates a minimal Draft, resolves the Requirements Stage context once, reads any returned Plugin contribution, and asks the first clarification round. Full validation, future Stage resolution, detailed Control application, design, and verification planning happen only when needed and are completed before Build Readiness.

You do not select Plugin Agents separately. Before each Stage, the main Agent resolves applicable Controls, Project Baselines and Defaults, relevant Knowledge, and enabled Capabilities. For example, the UX Domain supplies both mandatory experience Controls and an optional UX Plugin.

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

## Follow progress or resume later

Use conversational intents:

```text
/pdlc status
/pdlc resume <POC-ID>
/pdlc help
```

The Agent reports the active Stage, what changed, blocking questions, and the next action. Do not run the PDLC Runner manually; that is internal Agent/maintainer machinery.

## What the current v2 POC does and does not do

The v2 POC can guide work through Requirements, context resolution, lightweight design, Build Readiness, implementation, and evidence collection. It does not yet execute formal Commit, Verify, or Decide transitions, nor does it integrate JIRA, XRAY, CI/CD, deployment, or production release.

## Next

Continue with [03. Build a Domain Plugin](03-BUILD-A-COPILOT-PLUGIN.md) if your team wants to package specialized Agents and Skills into a Delivery Flow.
