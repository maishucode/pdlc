# Schema Ownership

Primary owner: **Harness Engineering**. PDLC Governance reviews semantic changes to Delivery Flow state, roles, gates, approvals, and evidence.

Schemas are portable machine contracts shared by all Agent platforms and integrations. A platform adapter must not define a competing schema. Runtime writes and Registry loads are currently enforced by the dependency-free validators in `.pdlc/core/schema.ts`; the JSON Schema files support editors, integrations, and external validation. Changes must keep both representations aligned and prove that alignment through tests.

The delivery model uses `stage-catalog.schema.json` for reusable work semantics, `delivery-flow-catalog.schema.json` for explicit registration, and `delivery-flow.schema.json` for ordered Stage composition plus executable controls. Discipline, Artifact, Policy, Knowledge, Discipline Stage Hook, Integration Catalog, Integration, Project Overlay, and Delivery Record schemas define the remaining v2 contracts.
