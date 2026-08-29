# Schema Ownership

Primary owner: **Harness Engineering**. PDLC Governance reviews semantic changes to Delivery Flow state, roles, gates, approvals, and evidence.

Schemas are machine contracts shared by all Agent platforms and integrations. A platform adapter must not define a competing schema.

The delivery model uses `stage-catalog.schema.json` for reusable work semantics, `delivery-flow-catalog.schema.json` for explicit registration, and `delivery-flow.schema.json` for ordered Stage composition plus executable controls. Domain, Artifact, Policy, Knowledge, Domain Stage Hook, Integration Catalog, Integration, Project Overlay, and Delivery Record schemas define the remaining v2 contracts.
