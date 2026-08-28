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

This example has no hooks, no MCP servers, no commands, and no scripts. It is guidance only: the main Lean PDLC flow remains responsible for requirements approval, Build Readiness, artifact writes, and state.

A future portable PDLC Guidance plugin can package broader cross-harness guidance. This example stays VS Code-focused so its integration contract remains easy to inspect and remove.
