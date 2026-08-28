---
name: pdlc
description: Start, resume, or inspect a governed Lean PDLC POC
argument-hint: "poc [idea] | resume [POC-ID] | status | help"
agent: "agent"
tools: ["read", "edit", "search", "execute"]
---

Read [AGENTS.md](../../AGENTS.md), then load and follow the canonical [Lean PDLC Skill](../../.agents/skills/lean-pdlc/SKILL.md).

Interpret text appended after `/pdlc` as `<intent> [optional context]`. Supported Phase 1 intents are `poc`, `resume`, `status`, and `help`. If no intent is supplied, explain these choices in one concise response. Do not offer a reserved workflow as though it were executable.

Keep the entire user experience conversational. Do not expose or ask the user to run Bun, TypeScript, or shell commands. Read and maintain the Requirements and Delivery Record on the user's behalf. Follow the shared requirements clarification and Build Readiness guard before construction. Invoke the internal Runner only when the shared Skill requires it.
