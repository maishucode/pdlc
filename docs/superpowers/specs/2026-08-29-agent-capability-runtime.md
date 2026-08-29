# Agent Capability Runtime Specification

## Problem

V2 resolves Domain Agents and Skills as contextual files, but it does not require the platform to invoke the resolved Agent. The main Agent can currently read those files, imitate the instructions, and still submit a valid Stage Context Receipt. That makes Domain contributions advisory rather than executable.

## Scope

Implement one platform path: GitHub Copilot custom-agent delegation. Keep the existing Domain Hook as the portable source of truth. A Hook binding becomes an Agent capability by adding a stable capability identifier and a required invocation policy.

The UX Domain is the first concrete capability provider. Java, Python, and other categories must be addable later by declaring the same Hook fields and providing their own Agent and Skills; they must not require Runner changes.

## Required Behavior

1. Every active Domain Hook binding declares a unique `capability` and `invocation: "required"`.
2. `context <stage>` returns a deterministic invocation contract for each resolved Domain contribution, including a context-bound invocation ID, the exact Agent, exact Skills, platform, mode, handoff, and approval boundary.
3. The GitHub Copilot main Agent has the native `agent` tool and must delegate each required invocation to the exact custom Agent. It must not emulate the Domain Agent locally.
4. The delegated Agent must echo the supplied invocation ID in a structured completion envelope and return evidence references.
5. A Stage Context Receipt must include the matching capability, invocation ID, permissions, and a platform execution reference derived from the native Copilot tool-call or session trace. A required Domain contribution cannot be marked `not-used`.
6. `context-apply` rejects missing, mismatched, skipped, or incomplete required invocations.
7. Existing policy, knowledge, integration, approval, and permission boundaries remain unchanged.
8. Capability IDs are globally unique across active Hook bindings. An invocation ID is stable for the same Stage snapshot and changes when any context-driving input changes.

## Non-goals

- Supporting multiple agent platforms in this increment.
- Adding a generic plugin directory or restoring the V1 plugin runtime.
- Executing arbitrary MCP tools.
- Cryptographically attesting GitHub's internal tool event. The Runner verifies a context-bound execution receipt; the native Copilot runtime owns the actual custom-agent tool call.
- Adding Java or Python capabilities now.

## Conversation UX

```text
User stays in one Lean PDLC conversation
                 |
                 v
        Main Agent enters a Stage
                 |
          context <stage>
                 |
       requiredAgentInvocations[]
                 |
        native Copilot agent tool
                 |
       UX Agent + bound Skill(s)
                 |
       structured completion result
                 |
          context-apply gate
```

The delegation is internal. The user is not asked to switch Agents or run commands.

## Acceptance Criteria

- The UX Hook descriptor validates with stable capability IDs and required invocation policy.
- Context output contains deterministic native invocation contracts.
- A valid completed invocation receipt applies successfully.
- Receipts that skip a required capability or omit/mismatch its invocation metadata fail.
- Copilot entrypoint validation requires the native `agent` tool and delegation instructions.
- The complete Bun test suite and Harness validation pass.
- A real GitHub Copilot CLI run invokes `lean-pdlc-ux` as a subagent, passes the generated invocation ID, receives the structured completion envelope with evidence, and successfully uses it in `context-apply` inside an isolated target workspace.
