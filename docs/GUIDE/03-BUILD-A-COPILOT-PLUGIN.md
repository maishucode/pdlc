# 03. Build a Copilot Plugin

This guide shows how to add one focused GitHub Copilot plugin to Lean PDLC. A plugin contributes domain capability; Lean PDLC remains the owner of Stages, requirements approval, Build Readiness, formal outputs, gates, and state.

The included `lean-pdlc-ux` example is the reference implementation. It has one Agent and three Skills and participates in five advisory Stages.

## 1. Copy the example

Copy the production Plugin directory and rename it for the capability you are adding:

```sh
cp -R plugins/lean-pdlc-ux plugins/acme-domain
```

Keep the package small. Start with one Agent, only the Skills it actually needs, and no hooks, MCP servers, commands, scripts, credentials, or installers.

```text
plugins/acme-domain/
├── plugin.json
├── pdlc-stage-bindings.json
├── agents/
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

The Copilot Agent lives at `agents/acme-domain.agent.md`. It should require the current Stage binding as input and refuse to claim an approval or state transition. Give it only the tools its real work needs; tool permissions are static for one Copilot Agent, so Stage-specific limitations must be written in the Agent instructions.

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

## 5. Publish through a marketplace

Add the Plugin to `.github/plugin/marketplace.json` at the repository root:

```json
{
  "name": "acme-copilot",
  "owner": { "name": "Acme" },
  "plugins": [
    {
      "name": "acme-domain",
      "description": "Domain guidance for Lean PDLC.",
      "version": "0.1.0",
      "source": "./plugins/acme-domain"
    }
  ]
}
```

Users register the repository marketplace and install the Plugin:

```sh
copilot plugin marketplace add OWNER/REPO
copilot plugin install acme-domain@acme-copilot
```

Select the plugin Agent in Copilot only after the main Lean PDLC Agent has supplied the current Stage binding in the conversation. There is no automatic background invocation. For VS Code team-wide automatic installation, an administrator configures the marketplace and Plugin through Copilot managed settings.

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
COPILOT_HOME=/private/tmp/copilot-plugin-check copilot plugin install /absolute/path/to/product/plugins/acme-domain
COPILOT_HOME=/private/tmp/copilot-plugin-check copilot plugin list
COPILOT_HOME=/private/tmp/copilot-plugin-check copilot plugin uninstall acme-domain
```

You do **not** need to build a `dist/` directory. For local development, install the Plugin from its local directory. For team distribution, commit it under `plugins/`, list it in `.github/plugin/marketplace.json`, then install it from the marketplace:

```sh
copilot plugin marketplace add OWNER/REPO
copilot plugin install acme-domain@acme-copilot
```

## Reference

Read the complete working Plugin at [Lean PDLC UX Copilot Plugin](../../plugins/lean-pdlc-ux/README.md).
