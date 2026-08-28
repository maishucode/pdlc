# GitHub Copilot Adapter Guide

## 1. Purpose

This guide explains how the Lean PDLC Harness is exposed through GitHub Copilot and how to verify that Copilot can complete the Phase 1 POC workflow.

The adapter is intentionally thin. It does not copy Stage, User Journey, workflow, role, Principle Pack, schema, gate, or state logic. Every Copilot surface uses the same shared sources as other supported Agent platforms.

## 2. Adapter components

| Component | Path | Purpose |
|---|---|---|
| Repository instructions | `.github/copilot-instructions.md` | Always-on repository context and control boundaries |
| Agent instructions | `AGENTS.md` | Shared Agent-level repository rules |
| Agent Skill | `.agents/skills/lean-pdlc/SKILL.md` | Canonical multi-step PDLC behavior |
| Custom Agent | `.github/agents/lean-pdlc.agent.md` | Manually selectable Lean PDLC persona and least-required tool set |
| Prompt File | `.github/prompts/pdlc.prompt.md` | `/pdlc` convenience entry point in supported IDEs |
| Cloud setup workflow | `.github/workflows/copilot-setup-steps.yml` | Installs Bun and validates the Harness in the Copilot cloud-agent environment |
| Adapter validation | `pdlc/harnesses/validate-entrypoints.ts` | Detects missing, legacy, oversized, or drifted adapter files |

## 3. Why each component exists

### Repository instructions

`.github/copilot-instructions.md` provides the small set of controls that apply to every Copilot interaction in the repository. It points to the shared Skill rather than reproducing the complete workflow.

### Shared Agent Skill

`.agents/skills/lean-pdlc/` is the canonical workflow guidance. GitHub supports `.agents/skills/<skill-name>/SKILL.md` as a project Skill location. Copilot loads a relevant Skill when the request matches its description.

### Custom Agent

The Lean PDLC custom Agent uses the current `.agent.md` filename convention and declares only the `read`, `edit`, `search`, and `execute` tool aliases required for a POC.

It is user-invocable but has automatic model invocation disabled. This prevents normal coding conversations from unexpectedly switching into a governed PDLC workflow. Users select it deliberately.

### Prompt File

The `/pdlc` Prompt File is an IDE convenience. Prompt Files are not the portability baseline because they are unavailable on GitHub.com and Copilot CLI. If Prompt Files are not supported, users select the custom Agent or ask naturally to use the Lean PDLC Skill.

### Cloud-agent setup

Copilot cloud agent works in an ephemeral GitHub Actions environment. The setup workflow:

1. Checks out the repository.
2. Installs the repository-aligned Bun version.
3. Confirms Bun is available.
4. Runs the Harness regression tests.
5. Validates schemas, the canonical Stage Catalog, User Journeys, workflows, Principle mappings, standards, portability, and Copilot entry points.

The setup workflow must be present on the default branch before Copilot cloud agent will use it.

## 4. Supported Copilot surfaces

| Surface | Recommended entry point | Prompt File | Custom Agent | Shared Skill |
|---|---|---:|---:|---:|
| VS Code Copilot Chat | `/pdlc poc <idea>` | Yes | Yes | Yes |
| Visual Studio | `/pdlc poc <idea>` or select Lean PDLC | Yes | Yes | Yes |
| JetBrains Copilot Chat | Select Lean PDLC or use the customization editor | Preview | Preview | Preview |
| GitHub Copilot CLI | `/agent`, select Lean PDLC, then enter the POC request | No | Yes | Yes |
| GitHub.com Copilot cloud agent | Select Lean PDLC when assigning or starting the task | No | Yes | Yes |
| GitHub.com Copilot Chat | Natural-language repository question | No | No dedicated Agent session | Repository instructions only |

Feature availability can depend on organization policy and the installed Copilot version. The shared Skill and repository instructions are the required baseline; Prompt Files are optional convenience.

## 5. How to start a POC

### VS Code or Visual Studio

```text
/pdlc poc validate whether AI can categorize synthetic customer feedback
```

Text after `/pdlc` is passed as workflow intent and context. If no intent is supplied, the prompt explains `poc`, `resume`, `status`, and `help`.

Alternatively, select **Lean PDLC** from the custom Agent picker and enter:

```text
poc validate whether AI can categorize synthetic customer feedback
```

### Copilot CLI

1. Enter `/agent`.
2. Select **Lean PDLC**.
3. Enter the POC idea or use `resume`, `status`, or `help`.

Natural language also works when Skills are enabled:

```text
Use the lean-pdlc skill to start a POC that validates whether AI can categorize synthetic customer feedback.
```

### Copilot cloud agent on GitHub.com

Select the repository and the **Lean PDLC** custom Agent, then submit a bounded POC task. The cloud setup workflow prepares Bun and validates the Harness before the Agent starts.

## 6. Expected POC behavior

The Copilot adapter is sufficient for Phase 1 when it can perform this sequence:

```text
Activate POC
  -> create Draft Delivery Record and Requirements
  -> clarify product requirements in batches of at most three questions
  -> apply enterprise, project, and Harness standards
  -> present the complete Requirements and Build Readiness summary
  -> stop for explicit approval
  -> run one internal Build Readiness process
  -> implement only the approved scope
  -> run normal application tests and build
  -> collect evidence and report remaining verification gaps
```

The Agent owns all commands. The delivery user is never instructed to run Bun or the Runner.

`execute` is available after Build Readiness so the Agent can install application dependencies and run tests, builds, and local verification. These are ordinary project commands, not Runner state transitions.

## 7. Approval and command behavior

The repository cannot override enterprise Copilot command-approval policy. The adopting organization should allow Copilot to request execution while preserving human approval for material commands.

The Harness minimizes approval volume by:

- Reading Delivery Records directly during routine interaction.
- Using one Build Readiness Runner process.
- Avoiding per-question and per-tool Runner calls.
- Grouping safe project verification behind existing package scripts where practical.
- Avoiding high-frequency hooks.

Future Commit, Verify, and Decide transitions will each use one explicitly confirmed Runner process when Phase 2 is implemented.

## 8. Enterprise prerequisites

Before a pilot, confirm that:

- The target Copilot surface is enabled by organization policy.
- Agent Skills and custom Agents are enabled where required.
- Copilot cloud agent is enabled if GitHub.com delegation will be used.
- The setup workflow is merged to the default branch.
- GitHub Actions policy permits `actions/checkout` and `oven-sh/setup-bun`.
- The Copilot runner can access the repositories required to download approved Actions.
- Bun execution is permitted by corporate endpoint or runner policy.
- No production, regulated, JIRA, XRAY, or deployment access is granted to the POC Agent.

No secrets or MCP servers are required for the Phase 1 POC workflow.

## 9. Conformance verification

### Repository checks

Harness maintainers run the configured validation and tests:

```text
bun pdlc/cli.ts validate
bun test pdlc/tests
```

Validation confirms:

- Required Copilot files exist.
- The current `.agent.md` profile is present and the legacy duplicate is absent.
- The custom Agent has the required tools and manual-selection controls.
- The Prompt File references the canonical Skill.
- The setup workflow installs Bun and runs Harness validation.
- Platform files remain thin.
- Shared Core remains platform-neutral.

### VS Code check

1. Confirm `/pdlc` appears in the Chat slash-command picker.
2. Confirm **Lean PDLC** appears in the Agent picker.
3. Start a test POC and verify that no more than three product questions appear in one response.
4. Confirm that no application code is created before Requirements and Build Readiness approval.
5. Inspect Agent Debug Logs if prompt, Agent, or Skill discovery fails.

### Copilot CLI check

1. Confirm `/agent` lists **Lean PDLC**.
2. Start a clean POC.
3. Confirm the shared Skill is used and the Agent does not ask the user to run the Runner.

### Copilot cloud-agent check

1. Confirm the setup session installs Bun and passes Harness tests and validation.
2. Select the Lean PDLC custom Agent.
3. Start a bounded POC task.
4. Confirm the task stops at Build Readiness if approval is unavailable in the delegated session.

## 10. Known Phase 1 limitations

- Only the POC workflow is executable.
- Prompt Files are IDE-only and remain a preview feature.
- Custom Agent support in some IDEs is still preview-dependent.
- Commit, Verify, and Decide transitions are not implemented.
- JIRA, XRAY, CI/CD evidence import, release, and production deployment are not implemented.
- A real enterprise pilot must validate the organization's exact Copilot surface and command-approval policy.

## 11. Official references

- [GitHub Copilot customization cheat sheet](https://docs.github.com/en/copilot/reference/customization-cheat-sheet)
- [Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [Adding Agent Skills for GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)
- [Repository custom instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions-in-your-ide/add-repository-instructions-in-your-ide)
- [Configure the Copilot cloud-agent environment](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment)
- [Prompt File example and support boundary](https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files/your-first-prompt-file)
