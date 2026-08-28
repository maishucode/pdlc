# 03. Build a Copilot Plugin

This guide shows how to add one focused GitHub Copilot plugin to Lean PDLC. A plugin contributes domain capability; Lean PDLC remains the owner of Stages, requirements approval, Build Readiness, formal outputs, gates, and state.

The included `lean-pdlc-ux` example is the reference implementation. It has one Agent and three Skills and participates in five advisory Stages.

## 1. Copy the example

Copy the example directory and rename it for the capability you are adding:

```sh
cp -R examples/copilot-plugins/lean-pdlc-ux examples/copilot-plugins/acme-domain
```

Keep the package small. Start with one Agent, only the Skills it actually needs, and no hooks, MCP servers, commands, scripts, credentials, or installers.

```text
examples/copilot-plugins/acme-domain/
├── plugin.json
├── pdlc-stage-bindings.json
├── com.github.copilot/agents/
│   └── acme-domain.agent.md
└── skills/
    ├── domain-spec/SKILL.md
    └── domain-review/SKILL.md
```

## 2. Define the plugin manifest

`plugin.json` is the Copilot plugin identity. Use the Agent Plugins 1.0 schema and make the name match the binding descriptor:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "acme-domain",
  "description": "Domain guidance for Lean PDLC in VS Code.",
  "version": "0.1.0",
  "author": { "name": "Acme" },
  "license": "MIT"
}
```

Do not put PDLC Stage definitions, approval logic, or Runner code in the manifest.

## 3. Add Skills and one Agent

Every Skill lives at `skills/<skill-name>/SKILL.md`. The YAML `name` must equal its directory name.

```markdown
---
name: domain-spec
description: Draft a small domain specification for an approved Lean PDLC Stage.
---

# Domain Spec

Use the supplied PDLC Stage binding. Draft only the requested domain artifact.
Never approve requirements, gates, or PDLC state.
```

The VS Code Agent lives at `com.github.copilot/agents/acme-domain.agent.md`. It should require the current Stage binding as input and refuse to claim an approval or state transition. Give it only the tools its real work needs; tool permissions are static for one Copilot Agent, so Stage-specific limitations must be written in the Agent instructions.

For a requirement-stage Skill, require selectable questions exactly as the core workflow does: 2–4 mutually exclusive choices plus `X) Other`, never an open-ended primary question.

## 4. Bind the capability to canonical Stages

Create `pdlc-stage-bindings.json`. It maps a canonical Stage to the plugin Agent and Skill; it does not change the Stage's meaning or create formal workflow outputs.

```json
{
  "schemaVersion": 1,
  "plugin": "acme-domain",
  "bindings": [
    {
      "stage": "requirements-clarification",
      "agent": "acme-domain",
      "skills": ["domain-spec"],
      "mode": "draft",
      "handoff": "Draft selectable domain questions for product clarification.",
      "approvalBoundary": "The plugin drafts guidance only; requirements approval and PDLC state remain outside the plugin."
    }
  ]
}
```

Valid modes are `draft`, `implement`, and `verify`. Use a Stage ID from `pdlc/stages/catalog.json`. One plugin may bind several Stages, but each Stage is listed once. Bind only Stages where the capability has a concrete, reviewable contribution.

## 5. Load the plugin in VS Code

Add its absolute directory to VS Code `settings.json`, then reload the window:

```json
{
  "chat.plugins.enabled": true,
  "chat.pluginLocations": {
    "/absolute/path/to/product/examples/copilot-plugins/acme-domain": true
  }
}
```

Select the plugin Agent in Copilot only after the main Lean PDLC Agent has supplied the current Stage binding in the conversation. There is no automatic background invocation.

## 6. Use the plugin during a PDLC task

The conversation handoff should name the Stage and expected work:

```text
Current Lean PDLC Stage: requirements-clarification.
Use the acme-domain binding to draft selectable questions for the missing data-retention decision.
```

For an implementation plugin, also supply an approved design reference. The plugin may edit only its approved scoped work and must report test evidence; it cannot approve requirements, bypass Build Readiness, or modify formal PDLC state.

## 7. Verify and distribute

Maintainers verify the repository first:

```sh
bun test pdlc/tests
bun pdlc/cli.ts validate
```

For a local Copilot CLI smoke check, install an absolute plugin path into an isolated home:

```sh
COPILOT_HOME=/private/tmp/copilot-plugin-check copilot plugin install /absolute/path/to/product/examples/copilot-plugins/acme-domain
COPILOT_HOME=/private/tmp/copilot-plugin-check copilot plugin list
COPILOT_HOME=/private/tmp/copilot-plugin-check copilot plugin uninstall acme-domain
```

You do **not** need to build a `dist/` directory to use a local plugin. For development, copy or point VS Code directly to the plugin folder. For team distribution, commit the folder to the product repository or publish the repository/subpath as a Copilot plugin source, then install it by repository path:

```sh
copilot plugin install OWNER/REPO:examples/copilot-plugins/acme-domain
```

## Reference

Read the complete working example at [Lean PDLC UX Copilot Plugin](../../examples/copilot-plugins/lean-pdlc-ux/README.md).
