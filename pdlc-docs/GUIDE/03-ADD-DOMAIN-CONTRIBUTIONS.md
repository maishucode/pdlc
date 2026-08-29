# 03 — Add Domain Capabilities

This guide explains how to add a Domain-owned capability, bind it to a canonical Stage, and make Atlas PDLC execute it through a native GitHub Copilot subagent.

The UX Domain is the reference implementation. Java, Python, security, architecture, and other expert categories use the same contract.

## Mental model

```text
Domain
  ├── domain.json                 ownership and contribution policy
  ├── agents/<id>.agent.md        role profile read by a subagent
  ├── skills/<id>/SKILL.md        executable capability instructions
  └── hooks/<name>.json           Stage-to-role-and-Skill binding
                                         |
                                         v
                               context <stage-id>
                                         |
                                         v
                           requiredAgentInvocations[]
                                         |
                                         v
                  task(agent_type="general-purpose", prompt=contract)
                                         |
                                         v
                          agent-capability-result + evidence
                                         |
                                         v
                             Stage Context Receipt v2
```

A capability is not a separate folder or registry entry. It is the stable `capability` id declared by a Domain Stage Hook binding. The binding connects one canonical Stage to one Domain role profile and one or more Skills.

## Discovery and activation rules

- Each direct child directory under `.pdlc/domains/` is discovered automatically. There is no Domain catalog to update.
- The directory name must equal `domain.json.id`.
- Agent files must be named `agents/<agent-id>.agent.md`.
- Skill files must be named `skills/<skill-id>/SKILL.md`.
- Hook descriptors are JSON files under `hooks/` and must use schema version 2.
- Active capability ids must be globally unique across all enabled Domain Hooks.
- A Domain may bind at most one contribution to the same Stage. Different Domains may contribute to the same Stage.
- `stage` must be an id from `.pdlc/stages/catalog.json`.
- `deliveryFlows` controls which Flow can resolve the Hook.
- Current Hook activation uses `enabled`, `deliveryFlows`, and `stage`. `domain.json.defaultApplicability` does not filter Hook bindings.
- Hook permissions apply to every binding in that descriptor. Use separate Hook descriptors when capabilities require different permission sets.
- The only supported invocation policy is `"required"`.

## Reference structure

The UX Domain uses this layout:

```text
.pdlc/domains/ux/
├── README.md
├── domain.json
├── agents/
│   └── atlas-pdlc-ux.agent.md
├── skills/
│   ├── atlas-pdlc-ux-spec/
│   │   └── SKILL.md
│   ├── atlas-pdlc-ux-react-ui-delivery/
│   │   └── SKILL.md
│   └── atlas-pdlc-ux-review/
│       └── SKILL.md
└── hooks/
    └── stages.json
```

Policies, Knowledge, Defaults, and Artifacts are optional capability-adjacent Domain resources. They keep their existing Domain contracts and do not replace the Agent + Skill + Hook execution path.

## Step 1: Create the Domain manifest

Create `.pdlc/domains/<domain-id>/domain.json`:

```json
{
  "schemaVersion": 1,
  "id": "ux",
  "name": "User Experience",
  "description": "Owns interaction, visual, accessibility, responsive experience policies, knowledge, Skills, Agents, and Hooks.",
  "owners": ["ux-leadership"],
  "policyApprovers": ["ux-governance-team"],
  "maintainers": ["ux-practice-team"],
  "contributionMode": {
    "artifacts": "reviewed",
    "policies": "restricted",
    "knowledge": "open",
    "skills": "reviewed",
    "agents": "reviewed",
    "hooks": "reviewed"
  },
  "defaultApplicability": {
    "technologies": ["web-ui", "mobile-ui"]
  }
}
```

All six `contributionMode` fields are required even when the Domain does not currently own resources of that category.

## Step 2: Write the Domain role profile

Create `.pdlc/domains/<domain-id>/agents/<agent-id>.agent.md`:

```markdown
---
name: Atlas PDLC UX
description: Executes bound UX capabilities as a GitHub Copilot subagent.
tools: [read, search, edit, execute]
---

# Atlas PDLC UX

This file is a role profile read by a generic subagent. It is not a GitHub
Custom Agent entrypoint and does not need to live under `.github/agents/`.

Verify the supplied invocation contract. Read every exact bound Skill path.
Respect the supplied permissions, mode, handoff, and approval boundary.

Return exactly one `agent-capability-result` containing:

- invocationId
- capability
- executor: generic-subagent
- agentType: general-purpose
- permissions
- agent
- status
- evidenceRefs
- summary

Never invent `platformExecutionRef`; the parent records it from the native
subagent tool-call or session trace.
```

The role profile owns professional identity, scope, permissions behavior, completion protocol, and approval boundaries. Detailed task procedure belongs in Skills.

## Step 3: Write a Skill

Create `.pdlc/domains/<domain-id>/skills/<skill-id>/SKILL.md`:

```markdown
---
name: atlas-pdlc-ux-spec
description: Creates a compact, implementation-ready UX specification.
---

# UX specification

## Required inputs

- Approved or draft product requirements appropriate to the current Stage.
- The Runner-generated capability invocation contract.

## Required output

- User, outcome, trigger, and success signal.
- Main flow and relevant interaction states.
- Observable acceptance criteria.
- A project-local evidence artifact.

## Constraints

- Do not approve requirements or PDLC gates.
- Do not invent missing product decisions.
- Do not exceed the contract permissions.
```

Skill ids are directory names. They must be unique within the Domain and use kebab-case.

## Step 4: Bind the capability to a Stage

Create `.pdlc/domains/<domain-id>/hooks/stages.json`:

```json
{
  "schemaVersion": 2,
  "domain": "ux",
  "version": "1.0.0",
  "deliveryFlows": ["poc"],
  "enabled": true,
  "permissions": {
    "filesystem": "write",
    "network": false,
    "externalWrites": false
  },
  "bindings": [
    {
      "stage": "ux-design",
      "capability": "ux-design-spec",
      "invocation": "required",
      "agent": "atlas-pdlc-ux",
      "skills": ["atlas-pdlc-ux-spec"],
      "mode": "draft",
      "handoff": "Draft a reviewable UX specification and textual mockup proposal for product review.",
      "approvalBoundary": "The Domain contribution drafts guidance only; product approval and PDLC state remain outside the Domain Agent."
    }
  ]
}
```

### Binding fields

| Field | Meaning |
|---|---|
| `stage` | Canonical Stage id that triggers the contribution. |
| `capability` | Globally unique, stable kebab-case execution id. |
| `invocation` | Must be `required`; the Stage cannot complete the contribution as `not-used`. |
| `agent` | Role-profile filename without `.agent.md`. |
| `skills` | One or more Skill directory ids read by the subagent. |
| `mode` | `draft`, `implement`, or `verify`. |
| `handoff` | Concrete work the subagent returns to the main flow. |
| `approvalBoundary` | Decisions and state changes the Domain contribution cannot make. |

Choose capability ids by professional outcome, not by implementation mechanism. Prefer `ux-design-spec` over `run-ux-agent` and `java-service-implementation` over `execute-java-prompt`.

## Step 5: Understand Stage execution

When the main flow enters `ux-design`, the Runner executes:

```text
bun .pdlc/cli.ts context ux-design --root <project-root>
```

The returned `requiredAgentInvocations` entry includes:

```json
{
  "invocationId": "<context-bound-sha256>",
  "capability": "ux-design-spec",
  "invocation": "required",
  "platform": "github-copilot",
  "tool": "task",
  "executor": "generic-subagent",
  "agentType": "general-purpose",
  "permissions": {
    "filesystem": "write",
    "network": false,
    "externalWrites": false
  },
  "agent": {
    "id": "atlas-pdlc-ux",
    "path": ".pdlc/domains/ux/agents/atlas-pdlc-ux.agent.md"
  },
  "skills": [
    {
      "name": "atlas-pdlc-ux-spec",
      "path": ".pdlc/domains/ux/skills/atlas-pdlc-ux-spec/SKILL.md"
    }
  ],
  "mode": "draft",
  "handoff": "Draft a reviewable UX specification and textual mockup proposal for product review.",
  "approvalBoundary": "The Domain contribution drafts guidance only; product approval and PDLC state remain outside the Domain Agent."
}
```

The main Agent must call the contract exactly as a native subagent task:

```text
task(agent_type=contract.agentType, prompt=<complete-contract-and-instructions>)
```

The worker reads `contract.agent.path` as its role profile and every `contract.skills[].path` before doing the capability work. It must not be invoked by using the Domain Agent id as a Custom Agent type.

## Step 6: Return the completion envelope

The subagent returns one structured envelope:

```json
{
  "invocationId": "<exact-contract-invocation-id>",
  "capability": "ux-design-spec",
  "executor": "generic-subagent",
  "agentType": "general-purpose",
  "permissions": {
    "filesystem": "write",
    "network": false,
    "externalWrites": false
  },
  "agent": "atlas-pdlc-ux",
  "status": "completed",
  "evidenceRefs": ["pdlc/evidence/context/ux-design.md"],
  "summary": "Prepared the UX state model and reviewable design handoff."
}
```

The subagent must not create `platformExecutionRef`. The parent derives that field from the opaque platform tool-call or session trace.

## Step 7: Apply the Stage Context Receipt

The Domain contribution fragment in a schema-version-2 Receipt looks like this:

```json
{
  "ref": "ux@1.0.0:atlas-pdlc-ux",
  "capability": "ux-design-spec",
  "agent": "atlas-pdlc-ux",
  "skills": ["atlas-pdlc-ux-spec"],
  "disposition": "used",
  "notes": "Executed the required UX design capability.",
  "evidenceRefs": ["pdlc/evidence/context/ux-design.md"],
  "execution": {
    "invocationId": "<exact-contract-invocation-id>",
    "platform": "github-copilot",
    "executor": "generic-subagent",
    "agentType": "general-purpose",
    "status": "completed",
    "platformExecutionRef": "github-copilot:subagent:<opaque-trace-ref>",
    "permissions": {
      "filesystem": "write",
      "network": false,
      "externalWrites": false
    }
  }
}
```

The complete Receipt must cover exactly the Policies, Knowledge, Domain contributions, and Integrations returned by `context <stage-id>`. Every local evidence reference must be a readable workspace-relative regular file.

The Runner rejects skipped, stale, incomplete, or mismatched execution identity. Stored applications are revalidated by `status`, `validate`, Build Readiness, and Verify gates.

## Adding another capability to an existing Domain

Add another binding when it targets a different canonical Stage:

```json
{
  "stage": "acceptance-verification",
  "capability": "ux-acceptance-review",
  "invocation": "required",
  "agent": "atlas-pdlc-ux",
  "skills": ["atlas-pdlc-ux-review"],
  "mode": "verify",
  "handoff": "Review delivered UX against supplied acceptance criteria.",
  "approvalBoundary": "The contribution reports findings but cannot accept the release."
}
```

One Domain cannot declare two Hook bindings for the same Stage. If one Domain needs multiple procedures at that Stage, bind multiple Skills to one capability and make the role profile coordinate them. Independent contributions from different Domains may share the Stage, but their capability ids must still be globally unique.

## Adding a Java or Python Domain

The same layout works without Runner changes:

```text
.pdlc/domains/java-engineering/
├── domain.json
├── agents/
│   └── atlas-pdlc-java.agent.md
├── skills/
│   └── atlas-pdlc-java-service-delivery/
│       └── SKILL.md
└── hooks/
    └── stages.json
```

Example binding:

```json
{
  "stage": "implementation",
  "capability": "java-service-implementation",
  "invocation": "required",
  "agent": "atlas-pdlc-java",
  "skills": ["atlas-pdlc-java-service-delivery"],
  "mode": "implement",
  "handoff": "Implement the approved Java service scope and return focused test evidence.",
  "approvalBoundary": "The contribution cannot change approved requirements, dependency policy, or PDLC state."
}
```

Use the same pattern for Python, data engineering, accessibility, security review, or other professional categories.

## Validate the Domain

Run these checks before committing:

```text
bun .pdlc/cli.ts domain list
bun .pdlc/cli.ts context <stage-id> --root <project-root>
bun .pdlc/cli.ts validate
bun test ./.pdlc/tests
```

Optional Skill discovery projection:

```text
bun .pdlc/cli.ts domain sync --root <project-root>
```

`domain sync` projects Skills under `.github/skills/`. It does not project Domain role profiles under `.github/agents/`, and capability execution does not depend on Custom Agent discovery.

## Common validation failures

| Error | Cause | Fix |
|---|---|---|
| `DOMAIN_DIRECTORY_MISMATCH` | Directory and `domain.json.id` differ. | Make both ids identical. |
| `DUPLICATE_AGENT_CAPABILITY` | An enabled capability id is reused. | Give every active binding a globally unique id. |
| `DUPLICATE_DOMAIN_STAGE_HOOK` | One Domain binds the same Stage twice. | Combine its Skills into one Stage capability. |
| `DOMAIN_AGENT_NOT_FOUND` | Hook `agent` has no matching `.agent.md`. | Add or rename the role-profile file. |
| `DOMAIN_SKILL_NOT_FOUND` | Hook Skill has no matching `SKILL.md`. | Add the exact Skill directory and file. |
| `INVALID_DOMAIN_INVOCATION` | Invocation is not `required`. | Use `"invocation": "required"`. |
| `CONTEXT_INVOCATION_MISMATCH` | Receipt invocation id is not from the current snapshot. | Re-run `context` and the capability. |
| `CONTEXT_PERMISSION_MISMATCH` | Receipt permissions differ from the Hook. | Echo the exact contract permissions. |
| `INVALID_SUBAGENT_TYPE` | Receipt did not use `general-purpose`. | Dispatch using `contract.agentType`. |
| `EVIDENCE_UNREADABLE` | Evidence is missing, unsafe, or unreadable. | Produce a readable workspace-local file or valid HTTP(S) URL. |

## Authoring checklist

- [ ] Domain directory and manifest id match.
- [ ] Ownership and all contribution modes are declared.
- [ ] Agent role profile exists and defines the completion envelope.
- [ ] Every Skill exists and has concrete inputs, outputs, and constraints.
- [ ] Hook schema version is 2.
- [ ] Delivery Flow and Stage ids are canonical.
- [ ] Capability id is stable, kebab-case, and globally unique.
- [ ] Invocation is `required`.
- [ ] Permissions are minimal for every binding in the descriptor.
- [ ] Handoff is concrete and approval boundary is explicit.
- [ ] `context <stage>` emits the expected role and Skill paths.
- [ ] Full Harness validation and tests pass.
