# UX Domain

The UX Domain owns its Policies, Knowledge, Skills, Agents, and Stage Hooks directly. No `capabilities/` or Plugin wrapper is required.

```text
.pdlc/domains/ux/
├── domain.json
├── policies/
├── knowledge/
├── skills/
├── agents/
└── hooks/
```

`hooks/stages.json` binds canonical Stages to the Domain Agent and Skills and declares delivery-flow scope, permissions, and approval boundaries. On Stage entry the Runner returns the applicable Domain contribution; the main delivery Agent reads and applies those resources in the current conversation.

`bun .pdlc/cli.ts domain list` validates and lists Domain resources. `bun .pdlc/cli.ts domain sync --root <project>` creates the optional VS Code projection under `.github/`; Stage resolution does not depend on that projection.
