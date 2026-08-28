# Lean PDLC UX Copilot Plugin

This is a deliberately small GitHub Copilot plugin example for Lean PDLC. It contributes one read-only VS Code UX agent and two portable skills: `ux-spec` and `ux-review`.

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

After reload, select **Lean PDLC UX** from the Copilot agent picker. Copilot discovers the two skills from `skills/`; they can be selected or invoked when their UX task fits. The agent has only `read` and `search`, so it provides chat guidance without changing the workspace.

Remove the `chat.pluginLocations` entry and reload to stop loading this local plugin.

## Use with Copilot CLI

Install from a local path, confirm it is present, and remove it when finished:

```sh
copilot plugin install /absolute/path/to/atlas-pdlc/examples/copilot-plugins/lean-pdlc-ux
copilot plugin list
copilot plugin uninstall lean-pdlc-ux
```

Your installed Copilot CLI version may present a scope option; use its `copilot plugin install --help` output if it requires one.

## Deliberate boundary

This example has no hooks, no MCP servers, no commands, and no scripts. It is guidance only: the main Lean PDLC flow remains responsible for requirements approval, Build Readiness, artifact writes, and state.

A future portable PDLC Guidance plugin can package broader cross-harness guidance. This example stays VS Code-focused so its integration contract remains easy to inspect and remove.
