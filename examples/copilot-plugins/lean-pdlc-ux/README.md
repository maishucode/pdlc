# Lean PDLC UX Copilot Plugin

This is a deliberately small GitHub Copilot plugin example for Lean PDLC. It contributes one VS Code UX agent and three portable skills: `ux-spec`, `react-ui-delivery`, and `ux-review`.

## How it joins the Lean PDLC flow

The maintainer-facing `guidance` command resolves an instruction only; it does not invoke Copilot, select an Agent, run work in the background, write formal outputs, or advance a Stage.

```sh
bun pdlc/cli.ts guidance <stage-id> --plugin <path>
```

The Plugin provides guidance for five canonical Stages:

| Stage | Skill | Mode | What it returns |
| --- | --- | --- | --- |
| `requirements-clarification` | `ux-spec` | `draft` | UX questions and state inventory |
| `ux-design` | `ux-spec` | `draft` | UX spec and textual mockup proposal |
| `implementation` | `react-ui-delivery` | `implement` | Scoped React UI and focused test evidence |
| `developer-verification` | `react-ui-delivery` | `verify` | Smallest relevant test evidence |
| `acceptance-verification` | `ux-review` | `verify` | Evidence-backed UX findings |

In VS Code, the user selects **Lean PDLC UX** from the Copilot agent picker when the current Lean PDLC Stage has resolved one of these instructions. There is no automatic background invocation.

Copilot tools are static for this one Agent. The user must first use `guidance` to obtain a Stage binding, then provide that Stage binding and any approved design reference in Copilot chat as user-supplied required context. The Agent cannot independently verify this context. If the context is missing or ambiguous, it must not use `edit` or `execute`; it asks for the missing binding or reference instead.

With user-supplied `implementation` context and an approved design reference, the Agent may write scoped React UI code and tests. With user-supplied `implementation` or `developer-verification` context, it may execute the smallest existing test command. It cannot install dependencies, cannot approve requirements, cannot alter PDLC formal state, and cannot bypass Build Readiness or PDLC gates.

This one-Plugin lean example cannot enforce stage-scoped permissions technically. Strong technical enforcement needs a future host adapter or split agents; neither is added here.

## Local validation

From the repository root, run:

```sh
bun test pdlc/tests/copilot-plugin.test.ts
bun test pdlc/tests
bun pdlc/cli.ts validate
```

## Use in VS Code

Add the absolute plugin path to VS Code `settings.json`, then reload the window:

```json
{
  "chat.plugins.enabled": true,
  "chat.pluginLocations": {
    "/absolute/path/to/atlas-pdlc/examples/copilot-plugins/lean-pdlc-ux": true
  }
}
```

After reload, select **Lean PDLC UX** from the Copilot agent picker. Copilot discovers the three skills from `skills/`; use the current Stage binding as the instruction for the selected task.

Remove the `chat.pluginLocations` entry and reload to stop loading this local plugin.

## Use with Copilot CLI

For a CLI smoke test, install this absolute local path into an isolated Copilot home, list it, then remove it:

```sh
COPILOT_HOME=/private/tmp/lean-pdlc-copilot-home copilot plugin install /absolute/path/to/atlas-pdlc/examples/copilot-plugins/lean-pdlc-ux
COPILOT_HOME=/private/tmp/lean-pdlc-copilot-home copilot plugin list
COPILOT_HOME=/private/tmp/lean-pdlc-copilot-home copilot plugin uninstall lean-pdlc-ux
```

If `copilot plugin install --help` does not show a local path as a supported input, your CLI version is older than this local-path installation behavior. Use the VS Code local loader via `chat.pluginLocations` while developing, or upgrade the CLI; this does not mean that local directories are unsupported in general.

After this plugin is published in an accessible GitHub repository or Git URL, install its repository subpath with the same isolated home. Replace `OWNER/REPO` with the published repository:

```sh
COPILOT_HOME=/private/tmp/lean-pdlc-copilot-home copilot plugin install OWNER/REPO:examples/copilot-plugins/lean-pdlc-ux
```

This branch is not published as a Copilot plugin source.

## Deliberate boundary

This example has no hooks, no MCP servers, no commands, and no scripts. The Plugin supplies bounded guidance; the main Lean PDLC flow remains responsible for Stage selection, requirements approval, Build Readiness, formal outputs, gates, and state.

A future portable PDLC Guidance plugin can package broader cross-harness guidance. This example stays VS Code-focused so its integration contract remains easy to inspect and remove.
