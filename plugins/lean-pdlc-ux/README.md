# Lean PDLC UX Plugin

This Plugin is an independent, additive extension of the Lean PDLC POC workflow. It owns one Agent, three Skills, and five Stage bindings. It does not own workflow state, approvals, or gates.

## How it joins the POC

The user starts the normal Lean PDLC entry point:

```text
/pdlc poc design and validate a browser Todo List
```

On every Stage entry, the main Agent asks the Runner for enabled Plugin contributions. At a bound Stage the Runner returns this Plugin's Agent and Skill paths; the main Agent reads and applies them in the same conversation.

```text
POC Stage
  -> discover plugins/lean-pdlc-ux/plugin.json
  -> match pdlc-stage-bindings.json
  -> read Plugin Agent + bound Skill
  -> perform additive UX work
  -> return the declared handoff to the POC flow
```

The user does not need to select **Lean PDLC UX** manually.

## Owned definition

```text
plugins/lean-pdlc-ux/
├── plugin.json
├── pdlc-stage-bindings.json
├── agents/
│   └── lean-pdlc-ux.agent.md
└── skills/
    ├── lean-pdlc-ux-spec/SKILL.md
    ├── lean-pdlc-ux-react-ui-delivery/SKILL.md
    └── lean-pdlc-ux-review/SKILL.md
```

The manifest opts into the `poc` workflow and declares the relative location of every contribution type. Agent and Skill identifiers are Plugin-prefixed to prevent collisions.

## Stage contributions

| POC Stage | Skill | Contribution |
|---|---|---|
| `requirements-clarification` | `lean-pdlc-ux-spec` | Selectable UX questions and state inventory |
| `ux-design` | `lean-pdlc-ux-spec` | Reviewable UX specification and textual mockup |
| `implementation` | `lean-pdlc-ux-react-ui-delivery` | Approved React UI and focused tests |
| `developer-verification` | `lean-pdlc-ux-react-ui-delivery` | Focused UI test evidence |
| `acceptance-verification` | `lean-pdlc-ux-review` | Evidence-backed UX findings |

## Maintainer checks

```sh
bun pdlc/cli.ts plugin list
bun pdlc/cli.ts guidance ux-design
bun pdlc/cli.ts plugin sync --root /absolute/path/to/product
```

`plugin sync` is only the VS Code adapter projection. It copies enabled Plugin Agents and Skills into `.github/`; it is not what integrates the Plugin with the PDLC flow. Stage resolution is the integration point.
