# 03 — Build a Lean PDLC Plugin

A Lean PDLC Plugin packages optional Agents and Skills and contributes them additively to existing POC Stages. The Plugin owns its complete definition under `plugins/`; it never edits `pdlc/core`, the POC Journey, or the main Agent.

This adopts the useful AI DLC v2 composition idea in a deliberately smaller scope:

- Core remains valid with every Plugin removed.
- Plugin identity and content are self-contained.
- Contributions are additive and Stage-bound.
- The main workflow discovers and composes them.
- Phase 1 supports only the existing `poc` workflow and does not add new Stages, hooks, remote marketplaces, or dependency resolution.

## 1. Create one independent directory

```text
plugins/acme-domain/
├── plugin.json
├── pdlc-stage-bindings.json
├── agents/
│   └── acme-domain.agent.md
└── skills/
    └── acme-domain-spec/
        └── SKILL.md
```

Do not put Plugin content under `pdlc/examples`, `pdlc/core`, or the main `.github/agents` directory. The `plugins/` directory is the authoring source of truth.

## 2. Declare the Plugin manifest

```json
{
  "schemaVersion": 1,
  "name": "acme-domain",
  "version": "0.1.0",
  "description": "Domain guidance for the Lean PDLC POC.",
  "pdlc": {
    "workflows": ["poc"],
    "defaultEnabled": true,
    "contributes": {
      "stageBindings": "pdlc-stage-bindings.json",
      "agents": "agents",
      "skills": "skills"
    }
  }
}
```

Phase 1 accepts only `poc`. Every contribution path must remain inside the Plugin directory. The directory name and manifest name must match.

## 3. Bind contributions to existing POC Stages

```json
{
  "schemaVersion": 1,
  "plugin": "acme-domain",
  "bindings": [
    {
      "stage": "requirements-clarification",
      "agent": "acme-domain",
      "skills": ["acme-domain-spec"],
      "mode": "draft",
      "handoff": "Return selectable domain questions to the POC requirements flow.",
      "approvalBoundary": "The Plugin drafts guidance; the POC flow owns approval and state."
    }
  ]
}
```

Rules:

- Bind only canonical Stages already present in the POC Journey.
- Agent and Skill names must equal or begin with the Plugin name.
- A Plugin may bind each Stage only once.
- Multiple Plugins may contribute to the same Stage; the Runner returns them in stable Plugin-name order.
- Contributions never approve requirements, change gates, or write PDLC state.
- Requirement questions must provide 2–4 mutually exclusive choices plus `X) Other`.

## 4. Write the Agent and Skills

The Agent describes the Plugin persona, scope, and boundaries. A Skill contains the detailed method used at a bound Stage. Keep each Skill independently readable because the main Lean PDLC Agent loads the exact paths returned by the Runner.

The Skill frontmatter name must match its directory:

```yaml
---
name: acme-domain-spec
description: Produces a compact domain specification for an approved POC outcome.
---
```

## 5. How the main POC invokes it

Users still start only:

```text
/pdlc poc <idea>
```

Before the main Agent performs any canonical Stage, it internally resolves:

```sh
bun pdlc/cli.ts guidance <stage-id> --root <project-root>
```

The result contains zero or more additive contributions:

```json
{
  "workflow": "poc",
  "stage": { "id": "requirements-clarification" },
  "contributions": [
    {
      "plugin": "acme-domain",
      "agent": { "id": "acme-domain", "path": "plugins/acme-domain/agents/acme-domain.agent.md" },
      "skills": [{ "name": "acme-domain-spec", "path": "plugins/acme-domain/skills/acme-domain-spec/SKILL.md" }],
      "mode": "draft",
      "handoff": "Return selectable domain questions to the POC requirements flow."
    }
  ]
}
```

The main Agent reads those files, performs the Plugin contribution in the current conversation, and returns the handoff to the same POC workflow. An unbound Stage returns an empty list and continues with core behavior.

## 6. Project Agents and Skills into VS Code

Run this only when the product repository needs the Plugin components visible to VS Code Copilot independently:

```sh
bun pdlc/cli.ts plugin sync --root /absolute/path/to/product
```

The command discovers all enabled POC Plugins and safely copies their Agent and Skill files into:

```text
.github/agents/
.github/skills/
```

Different existing content is never overwritten. This is a platform adapter projection, not the workflow integration mechanism; the POC Stage resolver works from `plugins/`.

## 7. Validate

```sh
bun pdlc/cli.ts plugin list
bun pdlc/cli.ts guidance requirements-clarification
bun pdlc/cli.ts guidance ux-design
bun test pdlc/tests
bun pdlc/cli.ts validate
```

For a new Plugin, add an end-to-end test proving that a normal POC Stage entry discovers the Plugin and returns its owned Agent and Skills. A file-copy-only test is insufficient.
