# User Journey Composition

Primary owner: **PDLC Governance**.

Each JSON file composes canonical Stage ids into an ordered User Journey. Required Stages always apply. Conditional Stages are activated when any declared `activationTags` value matches the delivery context.

Journey composition does not define workflow state or human approvals. Executable status transitions and checkpoints remain under `pdlc/workflows/`. In Phase 1, only the POC Journey has an executable workflow; Implementation and PDLC are planned compositions for forward-compatible design.
