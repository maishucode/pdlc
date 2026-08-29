# 01. Start Here: Install Lean PDLC Harness

This guide is for product owners and engineers who want to use Lean PDLC with GitHub Copilot.

## What you install

Lean PDLC is **project content**, not a compiled application. Clone or copy this repository into the project that should use it, commit the selected files, then let Copilot read the repository instructions and Skill.

There is no required release build, `dist/` directory, server, hook, or background process. Bun is only an internal maintainer/Agent runtime for deterministic validation and Build Readiness; delivery users do not run it.

```text
Your product repository
├── AGENTS.md                         Shared PDLC boundaries
├── .agents/skills/lean-pdlc/         Main Delivery Flow Skill
├── .github/                          Copilot adapter and prompt
├── pdlc/                             Stages, Flows, Domains, schemas, and Runner
├── pdlc-docs/                        Namespaced Harness documentation
└── .pdlc/                            Project configuration and delivery runtime
    ├── config/domains/               Optional project configuration overlay
    ├── records/                      Delivery Records
    ├── requirements/                 Requirements Artifacts
    ├── evidence/                     Delivery evidence
    └── audit/                        Append-only audit events
```

## Put Lean PDLC in a project

### Option A: start from this repository

Clone the repository and build the POC inside it:

```sh
git clone https://github.com/maishucode/pdlc.git my-poc
cd my-poc
```

### Option B: add Lean PDLC to an existing product repository

Copy the following version-controlled paths into the product repository, preserving their paths:

```text
AGENTS.md
.agents/skills/lean-pdlc/
.github/copilot-instructions.md
.github/agents/lean-pdlc.agent.md
.github/prompts/pdlc.prompt.md
.github/workflows/copilot-setup-steps.yml
pdlc/
pdlc-docs/
.pdlc/
```

Then commit them with the product. Domain definitions remain separate from Core, and the Runner resolves applicable Controls, Knowledge, and Capabilities before each Stage. Add project-specific context only under `.pdlc/config/domains/`.

Maintainers may project all enabled Plugin Agents and Skills into VS Code-native directories with:

```sh
bun pdlc/cli.ts plugin sync --root /absolute/path/to/product
```

This projection makes Plugin Agents independently visible in VS Code, but the normal user still starts only the main Lean PDLC POC. The main flow activates Plugin contributions automatically.

## Enable GitHub Copilot

Open the product repository in VS Code with GitHub Copilot enabled. Copilot reads the repository instructions and discovers the Lean PDLC custom Agent and shared Skill from the files above.

Use one of these entry points:

```text
/pdlc poc validate whether AI can categorize customer feedback
```

Or select **Lean PDLC** in the Copilot Agent picker and send:

```text
poc validate whether AI can categorize customer feedback
```

If the IDE does not show `/pdlc`, use natural language:

```text
Use the lean-pdlc skill to start a POC that validates whether AI can categorize customer feedback.
```

## Confirm the installation

Maintainers can run these commands from the repository root. They are not commands for delivery users:

```sh
bun test pdlc/tests
bun pdlc/cli.ts validate
```

For platform-specific troubleshooting, read [GitHub Copilot Adapter Guide](../GITHUB_COPILOT_ADAPTER.md).

## Next

Continue with [02. Run a POC](02-RUN-A-POC.md).
