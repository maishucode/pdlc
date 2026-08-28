# Core Ownership

Primary owner: **Harness Engineering**.

This folder contains deterministic, platform-neutral Harness behavior. It may depend on shared schemas, the Stage Catalog, User Journey and workflow definitions, and policy metadata. It must not depend on any Agent platform adapter, platform name, or platform-specific path.

Changes that alter gate meaning or controlled workflow state require PDLC Governance review. Security-sensitive persistence, hash, or audit changes require Security review.
