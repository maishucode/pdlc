# Workflow Ownership

Primary owner: **PDLC Governance**.

Workflow folders define executable status, delivery defaults, constraints, requirements policy, Journey references, and checkpoint transitions. Canonical Stage requirements live in `pdlc/stages/`; ordered composition lives in `pdlc/journeys/`. Workflow folders contain no Agent-platform-specific behavior.

Only a folder containing a valid `workflow.json` is executable. Placeholder folders must not be registered or represented to users as implemented.
