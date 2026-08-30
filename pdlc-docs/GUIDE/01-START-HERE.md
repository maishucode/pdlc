# 01. Start Here: Install Atlas PDLC Harness

This guide is for product owners and engineers who want to use Atlas PDLC with GitHub Copilot.

## What you install

Atlas PDLC is **project content**, not a compiled application. Clone or copy this repository into the project that should use it, commit the selected files, then let Copilot read the repository instructions and Skill.

There is no required release build, `dist/` directory, server, hook, or background process. Bun is only an internal maintainer/Agent runtime for deterministic validation and Build Readiness; delivery users do not run it.

```text
Your product repository
├── AGENTS.md                         Shared PDLC boundaries
├── .agents/skills/atlas-pdlc/         Main Delivery Flow Skill
├── .github/                          Copilot adapter and prompt
├── .pdlc/                            Reusable Harness definitions and Runner code
├── pdlc-docs/                        Namespaced Harness documentation
└── pdlc/                             Project-owned delivery workspace
    ├── disciplines/                  Optional project Discipline overlays and Knowledge
    ├── requirements/                 Requirements Artifacts
    ├── evidence/                     Delivery evidence
    ├── artifacts/                    Project delivery artifacts
    ├── records/                      Versioned Delivery Records
    ├── audit/                        Per-record append-only audit logs
    └── .state/                       Ignored inbox, current pointer, and locks
```

## Put Atlas PDLC in a project

### Option A: start from this repository

Clone the repository and build the POC inside it:

```sh
git clone https://github.com/maishucode/pdlc.git my-poc
cd my-poc
```

### Option B: add Atlas PDLC to an existing product repository

Copy the following version-controlled paths into the product repository, preserving their paths:

```text
AGENTS.md
.agents/skills/atlas-pdlc/
.github/copilot-instructions.md
.github/agents/atlas-pdlc.agent.md
.github/prompts/atlas-pdlc.prompt.md
.github/workflows/copilot-setup-steps.yml
.pdlc/
pdlc/
pdlc-docs/
```

Then commit them with the product. Discipline definitions remain separate from Core, and the Runner resolves applicable Policies/Controls, Knowledge, Discipline contributions, and Integrations before each Stage. Add project-specific context only under `pdlc/disciplines/`.

### Enable ownership review routing

The included `.github/CODEOWNERS.template` is intentionally inactive because its sample team handles cannot be valid for every adopter. Before relying on repository review enforcement:

1. replace every `@your-org/...` handle with a real user or team that has repository access;
2. save the result as `.github/CODEOWNERS`;
3. protect the relevant branch and require CODEOWNER review for governed paths.

Until those steps are complete, `ownerDiscipline`, owner, approver, and maintainer metadata remains useful for validation and accountability, but GitHub does not enforce review routing.

Maintainers may project all enabled Discipline Agents and Skills into VS Code-native directories with:

```sh
bun .pdlc/cli.ts discipline sync --root /absolute/path/to/product
```

This projection makes Discipline Agents independently visible in VS Code, but the normal user still starts only the main Atlas PDLC POC. Stage execution does not depend on this projection: the main flow batches required Discipline Capabilities into one generic Stage Agent invocation automatically.

## Enable GitHub Copilot

Open the product repository in VS Code with GitHub Copilot enabled. Copilot reads the repository instructions and discovers the Atlas PDLC custom Agent and shared Skill from the files above.

Use one of these entry points:

```text
/atlas-pdlc poc validate whether AI can categorize customer feedback
```

Or select **Atlas PDLC** in the Copilot Agent picker and send:

```text
poc validate whether AI can categorize customer feedback
```

If the IDE does not show `/atlas-pdlc`, use natural language:

```text
Use the atlas-pdlc skill to start a POC that validates whether AI can categorize customer feedback.
```

## Confirm the installation

Maintainers can run these commands from the repository root. They are not commands for delivery users:

```sh
bun run --cwd .pdlc test
bun .pdlc/cli.ts validate
```

For platform-specific troubleshooting, read [GitHub Copilot Adapter Guide](../GITHUB_COPILOT_ADAPTER.md).

## Next

Continue with [02. Run a POC](02-RUN-A-POC.md).
