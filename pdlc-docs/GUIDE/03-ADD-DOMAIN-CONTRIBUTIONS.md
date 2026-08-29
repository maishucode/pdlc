# 03 — Add Domain Skills, Agents, and Hooks

Domain expert behavior lives directly under its owning Domain. A Hook composes the relevant Agent and Skills into canonical Stages; there is no Plugin manifest or `capabilities/` wrapper.

## 1. Create the Domain resources

```text
.pdlc/domains/acme-domain/
├── domain.json
├── skills/
│   └── acme-domain-spec/
│       └── SKILL.md
├── agents/
│   └── acme-domain.agent.md
└── hooks/
    └── stages.json
```

Add `policies/`, `knowledge/`, or `artifacts/` only when the Domain owns those content types.

## 2. Declare contribution modes

`domain.json` declares owners and contribution rules for every direct category:

```json
{
  "schemaVersion": 1,
  "id": "acme-domain",
  "name": "Acme Domain",
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
  "domain": "acme-domain",
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
      "agent": "acme-domain",
      "skills": ["acme-domain-spec"],
      "mode": "draft",
      "handoff": "Return selectable domain questions to the requirements flow.",
      "approvalBoundary": "The Domain contribution drafts guidance; the Delivery Flow owns approval and state."
    }
  ]
}
```

Rules:

- Bind only canonical Stages.
- Agent and Skill ids must be unique kebab-case names.
- One Domain may bind a Stage only once.
- Contributions never approve Requirements, change gates, or write controlled PDLC state.
- Permissions and approval boundaries are explicit.

## 4. Write the Agent and Skill

The Agent describes the Domain behavior, scope, and boundaries. The Skill contains the detailed method used by the Hook. Skill frontmatter name must match its directory.

## 5. Runtime composition

At Stage entry, the internal `context <stage-id>` call returns:

```json
{
  "domainContributions": [
    {
      "domain": "acme-domain",
      "permissions": {
        "filesystem": "read",
        "network": false,
        "externalWrites": false
      },
      "agent": {
        "id": "acme-domain",
        "path": ".pdlc/domains/acme-domain/agents/acme-domain.agent.md"
      },
      "skills": [
        {
          "name": "acme-domain-spec",
          "path": ".pdlc/domains/acme-domain/skills/acme-domain-spec/SKILL.md"
        }
      ]
    }
  ]
}
```

For each returned `requiredAgentInvocations` contract, the main delivery Agent starts the native generic subagent and passes the contract unchanged. The worker reads the Domain Agent file as its role profile plus every exact bound Skill before returning an `agent-capability-result`. The main Agent must not emulate a required contribution in the primary conversation. An unbound Stage continues with core behavior.

The complete contract, receipt, validation, and Java/Python category examples are documented in [the canonical Domain capability authoring guide](../../.pdlc/domains/README.md).

## 6. Optional VS Code Skill projection

`domain sync` safely projects enabled Domain Skills into `.github/skills/`. Different existing content is never overwritten. Domain Agent files stay under `.pdlc/domains/` because the runtime uses them as role profiles for generic subagents; custom-Agent discovery is not required. Projection is a platform convenience, and Stage resolution always uses the canonical Domain resources.

## 7. Validate

Add an end-to-end test proving that Stage context returns the Domain Agent and Skill paths. Then run the Harness test and validation commands internally.
