# Delivery Flow Ownership

Primary owner: **PDLC Governance**. Product Governance owns each Flow's Requirements Flow Control.

`catalog.json` explicitly registers available Delivery Flows. Each registered Flow composes canonical Stage ids into one ordered lifecycle definition. Required Stages always apply. Conditional Stages are activated when any declared `activationTags` value matches the delivery context.

An `active` Delivery Flow also owns its executable controls: statuses, delivery defaults, constraints, and checkpoint transitions. A `planned` Delivery Flow defines its Stage composition but deliberately omits executable controls until its Runner behavior and integrations are approved and implemented.

v2 provides three registered Delivery Flows:

- `poc`: active and executable.
- `implementation`: planned and not executable.
- `pdlc`: planned and not executable.

Canonical Stage semantics remain in `.pdlc/stages/catalog.json`; a Flow references Stage ids without redefining their requirements or outputs. Delivery Flow definitions contain no Agent-platform-specific behavior.
