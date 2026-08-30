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

`hooks/stages.json` binds canonical Stages to required UX Capabilities, an Agent role profile, and candidate Skills while declaring delivery-flow scope, permissions, and approval boundaries. On Stage entry the Runner includes every applicable Capability in one `requiredStageInvocation`. A generic Stage subagent reads the role profile, selects the relevant candidate Skills, performs each Capability, and returns evidence-backed contributions. The Runner rejects missing or stale execution receipts.

`bun .pdlc/cli.ts discipline list` validates and lists Discipline resources. `bun .pdlc/cli.ts discipline sync --root <project>` creates the optional VS Code projection under `.github/`; Stage execution reads canonical role profiles and does not depend on that projection.
