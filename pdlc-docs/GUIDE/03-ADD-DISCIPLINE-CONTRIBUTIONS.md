# 03 — Add Discipline Skills, Agents, and Hooks

Discipline expert behavior lives directly under its owning Discipline. A Hook composes the relevant Agent and Skills into canonical Stages; there is no Plugin manifest or `capabilities/` wrapper.

## 1. Create the Discipline resources

```text
.pdlc/disciplines/acme-discipline/
├── discipline.json
├── skills/
│   └── acme-discipline-spec/
│       └── SKILL.md
├── agents/
│   └── acme-discipline.agent.md
└── hooks/
    └── stages.json
```

Add `policies/`, `knowledge/`, or `artifacts/` only when the Discipline owns those content types.

## 2. Declare contribution modes

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

## 3. Bind resources to Stages

```json
{
  "schemaVersion": 1,
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
      "agent": "acme-discipline",
      "skills": ["acme-discipline-spec"],
      "mode": "draft",
      "handoff": "Return selectable discipline questions to the requirements flow.",
      "approvalBoundary": "The Discipline contribution drafts guidance; the Delivery Flow owns approval and state."
    }
  ]
}
```

Rules:

- Bind only canonical Stages.
- Agent and Skill ids must be unique kebab-case names.
- One Discipline may bind a Stage only once.
- Contributions never approve Requirements, change gates, or write controlled PDLC state.
- Permissions and approval boundaries are explicit.

## 4. Write the Agent and Skill

The Agent describes the Discipline behavior, scope, and boundaries. The Skill contains the detailed method used by the Hook. Skill frontmatter name must match its directory.

## 5. Runtime composition

At Stage entry, the internal `context <stage-id>` call returns:

```json
{
  "disciplineContributions": [
    {
      "discipline": "acme-discipline",
      "permissions": {
        "filesystem": "read",
        "network": false,
        "externalWrites": false
      },
      "agent": {
        "id": "acme-discipline",
        "path": ".pdlc/disciplines/acme-discipline/agents/acme-discipline.agent.md"
      },
      "skills": [
        {
          "name": "acme-discipline-spec",
          "path": ".pdlc/disciplines/acme-discipline/skills/acme-discipline-spec/SKILL.md"
        }
      ]
    }
  ]
}
```

The main delivery Agent reads and applies these resources in the same conversation. An unbound Stage continues with core behavior.

## 6. Optional VS Code projection

`discipline sync` safely projects enabled Discipline Agents and Skills into `.github/agents/` and `.github/skills/`. Different existing content is never overwritten. Projection is a platform convenience; Stage resolution always uses the canonical Discipline resources.

## 7. Validate

Add an end-to-end test proving that Stage context returns the Discipline Agent and Skill paths. Then run the Harness test and validation commands internally.
