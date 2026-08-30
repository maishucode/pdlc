# UX Discipline

The UX Discipline owns its Policies, Knowledge, Skills, Agents, and Stage Hooks directly. No `capabilities/` or Plugin wrapper is required.

```text
.pdlc/disciplines/ux/
├── discipline.json
├── policies/
├── knowledge/
├── skills/
├── agents/
└── hooks/
```

`hooks/stages.json` binds canonical Stages to the Discipline Agent and Skills and declares delivery-flow scope, permissions, and approval boundaries. On Stage entry the Runner returns the applicable Discipline contribution; the main delivery Agent reads and applies those resources in the current conversation.

`bun .pdlc/cli.ts discipline list` validates and lists Discipline resources. `bun .pdlc/cli.ts discipline sync --root <project>` creates the optional VS Code projection under `.github/`; Stage resolution does not depend on that projection.
