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

`hooks/stages.json` binds canonical Stages to stable required capability ids, the Domain role profile, and Skills. On Stage entry the Runner returns an invocation contract; the main delivery Agent opens a native `general-purpose` subagent, which reads the exact role and Skill paths before doing the work.

See [Domain Capability Authoring](../README.md) for the complete manifest, Agent, Skill, Hook, Stage, execution-result, Receipt, validation, and Java/Python extension contract.

`bun .pdlc/cli.ts domain list` validates and lists Domain resources. `bun .pdlc/cli.ts domain sync --root <project>` creates the optional Skill projection under `.github/skills/`; Stage resolution does not depend on that projection.
