# Lean PDLC UX Plugin

This is a Lean PDLC capability bundle, not a GitHub Copilot Marketplace plugin. It supplies one UX Agent, three Skills, and Stage bindings. Lean PDLC owns workflow state, approvals, and gates.

## Install into a VS Code project

From this repository, install into the target project root:

```sh
bun pdlc/cli.ts plugin lean-pdlc-ux --root /absolute/path/to/your-project
```

The command copies only these VS Code-native files:

```text
.github/
├── agents/lean-pdlc-ux.agent.md
└── skills/
    ├── lean-pdlc-ux-spec/SKILL.md
    ├── lean-pdlc-react-ui-delivery/SKILL.md
    └── lean-pdlc-ux-review/SKILL.md
```

Open the target project in VS Code and select **Lean PDLC UX** from the Agent picker. The prefixed Skill names prevent one Plugin from silently replacing another Plugin's Skill.

If a destination file already exists with different content, installation stops with `PLUGIN_FILE_CONFLICT`; it never overwrites project work. Running the same installation again is safe and reports the files as unchanged.

## Stage participation

The main Lean PDLC Agent supplies the active Stage in chat. This Plugin contributes at five stages:

- `requirements-clarification` and `ux-design`: UX specification and selectable questions
- `implementation`: scoped React UI and tests after an approved design reference
- `developer-verification`: smallest relevant UI test and evidence
- `acceptance-verification`: UX review findings

It does not automatically run in the background or approve requirements, gates, or PDLC state.
