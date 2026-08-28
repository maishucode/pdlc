# 03 — Build a Lean PDLC Plugin

Lean PDLC Plugins are repository capability bundles. They are not GitHub Copilot Marketplace packages: no `dist`, marketplace, global VS Code setting, or client-side plugin lifecycle is required.

## 1. Plugin layout

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

Use a minimal manifest:

```json
{
  "name": "acme-domain",
  "description": "Domain guidance for Lean PDLC.",
  "version": "0.1.0",
  "kind": "lean-pdlc-plugin"
}
```

Name every Skill with the Plugin prefix, such as `acme-domain-spec`. This prevents two Plugins from overwriting each other's VS Code Skills.

## 2. Bind a concrete Stage contribution

`pdlc-stage-bindings.json` is the contract between the main Lean PDLC flow and the Plugin. Bind only a Stage where the Plugin has reviewable work, and keep approvals and state in the core flow.

```json
{
  "schemaVersion": "1.0.0",
  "plugin": "acme-domain",
  "bindings": [
    {
      "stage": "requirements-clarification",
      "agent": "acme-domain",
      "skills": ["acme-domain-spec"],
      "mode": "draft",
      "handoff": "Draft selectable questions for missing domain decisions.",
      "approvalBoundary": "The Plugin drafts guidance only; approval and PDLC state remain outside the Plugin."
    }
  ]
}
```

Requirement questions must be selectable: 2–4 mutually exclusive choices plus `X) Other`.

## 3. Write the Agent for VS Code

The Agent source is a normal `.agent.md` file. It is installed into `.github/agents/`, which VS Code discovers natively. Give it only the tools its work needs and state that it must not approve gates or alter PDLC state.

## 4. Install into a target project

Run from the Lean PDLC repository:

```sh
bun pdlc/cli.ts plugin acme-domain --root /absolute/path/to/target-project
```

The installer copies `agents/*.agent.md` to `.github/agents/` and each `skills/<name>/SKILL.md` to `.github/skills/<name>/SKILL.md`. It never overwrites different content; resolve a `PLUGIN_FILE_CONFLICT` explicitly.

Open the target project in VS Code, then choose the Agent from the Agent picker. No release or build output is needed.

## 5. Keep it lean

Start with one Agent and only the Skills it needs. Do not add hooks, MCP servers, or background orchestration unless the Plugin has a concrete external integration that cannot be expressed with Agent instructions and Skills.
