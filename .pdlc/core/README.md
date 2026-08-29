# Core Ownership

Primary owner: **Harness Engineering**.

This folder contains deterministic, platform-neutral Harness behavior. It may depend on shared schemas, the Stage and Delivery Flow Catalogs, Domain assets, Project Overlays, and Delivery Records. It must not depend on an Agent platform adapter, platform name, or platform-specific path.

Changes that alter gate meaning or controlled Delivery Flow state require PDLC Governance review. Security-sensitive persistence, hash, or audit changes require Security review.

Keep Core modules cohesive and dependency direction one-way: orchestration may call registries and invariant services, while persistence and hashing must not call the CLI. Prefer command-scoped immutable views over global caches. Add a focused module when an invariant is shared by more than one command; do not add abstraction around a single trivial operation.
