# Integrations

This top-level registry owns connections to external systems such as JIRA, Xray, and Databricks. Integrations are independent of professional Disciplines so one connection can be reused by several Disciplines and Delivery Flows.

Each Integration has an `integration.json` manifest declaring ownership, applicability, permissions, credential references, and bundled Skills. A bundled Skill lives at `skills/<skill-id>/SKILL.md` inside the Integration and is returned by Stage context when the Integration applies. Credentials and secrets are never stored here.

Discipline content references an Integration by id; it does not copy the Integration into a Discipline. Platform-specific discovery wrappers may point to an Integration Skill, but the canonical Skill remains in this folder.
