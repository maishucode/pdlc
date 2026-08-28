# Schema Ownership

Primary owner: **Harness Engineering**. PDLC Governance reviews semantic changes to workflow state, roles, gates, approvals, and evidence.

Schemas are machine contracts shared by all Agent platforms and integrations. A platform adapter must not define a competing schema.

The delivery model is split across `stage-catalog.schema.json`, `journey.schema.json`, and `workflow.schema.json`: reusable work semantics, ordered composition, and controlled state transitions respectively.
