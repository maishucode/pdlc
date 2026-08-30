# 03 — Add Discipline Capabilities, Agents, and Skills

Discipline expert behavior lives directly under its owning Discipline. A Hook declares a required Capability for a canonical Stage, an Agent role profile, and the candidate Skills that the Stage worker may select. There is no Plugin manifest or `capabilities/` directory.

The execution unit is one Stage invocation. The acceptance unit is one Capability contribution. If several Disciplines bind the same Stage, the Runner batches all of their Capabilities into one generic subagent call and validates each contribution separately.

## 1. Create the Discipline resources

```text
.pdlc/disciplines/acme-discipline/
├── discipline.json
├── skills/
│   ├── acme-discovery/
│   │   └── SKILL.md
│   └── acme-review/
│       └── SKILL.md
├── agents/
│   └── acme-discipline.agent.md
└── hooks/
    └── stages.json
```

Add `policies/`, `knowledge/`, or `artifacts/` only when the Discipline owns those content types.

## 2. Declare ownership

`discipline.json` declares owners and contribution rules for every direct category:

```json
{
  "schemaVersion": 1,
  "id": "acme-discipline",
  "name": "Acme Discipline",
  "description": "Owns Acme delivery expertise.",
  "owners": ["acme-leadership"],
  "policyApprovers": ["acme-governance"],
  "maintainers": ["acme-practice"],
  "contributionMode": {
    "artifacts": "reviewed",
    "policies": "restricted",
    "knowledge": "open",
    "skills": "reviewed",
    "agents": "reviewed",
    "hooks": "reviewed"
  }
}
```

## 3. Write the role profile and Skills

The Agent file is a role profile, not a required custom-Agent installation. It defines the Discipline's behavior, scope, permissions, handoff, and boundaries. A native generic Stage subagent reads the profile when the Hook activates.

Each Skill contains one reusable expert method. Its frontmatter `name` must match the Skill directory. Keep Skills narrow enough that the Stage worker can select only what the Capability needs.

## 4. Bind a required Capability to a Stage

```json
{
  "schemaVersion": 2,
  "discipline": "acme-discipline",
  "version": "1.0.0",
  "deliveryFlows": ["poc"],
  "enabled": true,
  "permissions": {
    "filesystem": "read",
    "network": false,
    "externalWrites": false
  },
  "bindings": [
    {
      "stage": "requirements-clarification",
      "capability": "acme-requirements-analysis",
      "invocation": "required",
      "agent": "acme-discipline",
      "candidateSkills": ["acme-discovery", "acme-review"],
      "mode": "draft",
      "handoff": "Return selectable discipline questions to the requirements flow.",
      "approvalBoundary": "The Discipline contribution drafts guidance; the Delivery Flow owns approval and state."
    }
  ]
}
```

Rules:

- Bind only canonical Stages.
- `capability`, Agent, and Skill ids use unique kebab-case names.
- A required Capability id must be unique across enabled Hooks.
- One Discipline may bind a Stage only once; different Disciplines may bind the same Stage.
- `candidateSkills` is an allowlist, not a fixed execution list. The Stage worker selects one or more entries.
- Contributions never approve Requirements, change gates, or write controlled PDLC state.
- Permissions and approval boundaries are explicit.

## 5. Runtime contract

At Stage entry, `context <stage-id>` returns the resolved contribution plus one Stage-level invocation:

```json
{
  "disciplineContributions": [
    {
      "discipline": "acme-discipline",
      "version": "1.0.0",
      "capability": "acme-requirements-analysis",
      "invocation": "required",
      "permissions": {
        "filesystem": "read",
        "network": false,
        "externalWrites": false
      },
      "agent": {
        "id": "acme-discipline",
        "path": ".pdlc/disciplines/acme-discipline/agents/acme-discipline.agent.md"
      },
      "candidateSkills": [
        {
          "name": "acme-discovery",
          "path": ".pdlc/disciplines/acme-discipline/skills/acme-discovery/SKILL.md"
        },
        {
          "name": "acme-review",
          "path": ".pdlc/disciplines/acme-discipline/skills/acme-review/SKILL.md"
        }
      ]
    }
  ],
  "requiredStageInvocation": {
    "invocationId": "<context-bound-sha256>",
    "stage": "requirements-clarification",
    "invocation": "required",
    "platform": "github-copilot",
    "tool": "task",
    "executor": "generic-subagent",
    "agentType": "general-purpose",
    "permissions": {
      "filesystem": "read",
      "network": false,
      "externalWrites": false
    },
    "capabilities": ["<full capability contracts>"]
  }
}
```

The main delivery Agent makes exactly one native generic-subagent call for `requiredStageInvocation`. The worker must:

1. read every Capability's Agent role profile;
2. select at least one Skill only from that Capability's candidates;
3. read the selected Skill files;
4. perform every Capability in the contract; and
5. return the selected Skills, result notes, and evidence for every Capability.

Do not call one subagent per Capability or Skill. Do not substitute a custom Agent for the generic Stage worker. An unbound Stage has no `requiredStageInvocation` and continues with core behavior.

## 6. Apply the execution Receipt

The main Agent converts the worker result and the platform trace into one schema-version-2 Stage Context Receipt:

```json
{
  "schemaVersion": 2,
  "stage": "requirements-clarification",
  "contextHash": "<context-sha256>",
  "policies": [],
  "knowledge": [],
  "disciplineContributions": [
    {
      "ref": "acme-discipline@1.0.0:acme-requirements-analysis",
      "capability": "acme-requirements-analysis",
      "agent": "acme-discipline",
      "selectedSkills": ["acme-discovery"],
      "disposition": "used",
      "notes": "Produced the required clarification analysis.",
      "evidenceRefs": ["pdlc/evidence/acme-clarification.md"]
    }
  ],
  "integrations": [],
  "stageInvocation": {
    "invocationId": "<same-context-bound-sha256>",
    "platform": "github-copilot",
    "executor": "generic-subagent",
    "agentType": "general-purpose",
    "status": "completed",
    "platformExecutionRef": "github-copilot:subagent:<opaque-trace>",
    "permissions": {
      "filesystem": "read",
      "network": false,
      "externalWrites": false
    }
  }
}
```

`context-apply` rejects the Receipt when:

- any required Capability is missing or marked `not-used`;
- a selected Skill is absent or outside its Capability's candidate set;
- invocation identity, executor, permissions, completion status, or platform trace does not match;
- evidence is missing, unreadable, unsafe, or invalid; or
- the Stage context changed after invocation.

Flow readiness and checkpoints use the stored Receipt through `HarnessContext.contextIssues()`. A valid Receipt may be reused while its `contextHash` remains unchanged, so re-entering a stable Stage does not require another subagent call.

## 7. Optional VS Code projection

`discipline sync` safely projects enabled Discipline Agents and candidate Skills into `.github/agents/` and `.github/skills/`. Different existing content is never overwritten. Projection is a platform convenience; Stage execution reads the canonical role profile and does not depend on custom-Agent discovery.

## 8. Validate

Add tests proving that:

- Stage context returns the Capability, role profile, candidates, and one invocation;
- multiple same-Stage Capabilities remain inside that one invocation;
- the worker may select a valid Skill subset;
- missing Capability results, invalid Skill selections, stale Receipts, and bad evidence are rejected; and
- the target Flow cannot cross its governed gate without a valid Receipt.

Then run the Harness tests, typecheck, and validation commands internally.
