# Domain context resolution

Before each Stage, resolve context from `pdlc/domains/` and `.pdlc/config/domains/` using the Delivery Flow, Stage, risk, technology, and domain tags.

Treat the returned channels independently:

- Controls are mandatory and require satisfaction or an approved exception.
- Project Baselines are approved facts; do not ask the user to decide them again.
- Defaults are automatic but may be replaced by a higher-precedence source unless locked by a Control.
- Guidance, References, and KB are advisory context.
- Plugins and Integration Adapters are executable capabilities with explicit permissions and approval boundaries.

Default precedence is locked Control, then Project Default, then Domain Default. Project Controls are cumulative and cannot replace enterprise Controls.

Record provenance in the Requirements Artifact and Delivery Record. Do not count system-resolved context as an answered product clarification question.
