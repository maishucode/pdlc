# Principle Pack reference

Principle Packs live below `pdlc/principles/` and are owned by the function named in each pack's metadata. Use `pdlc/schemas/principle-pack.schema.json` as the contract.

Select packs across the active canonical Stage set by User Journey, risk, technology, and domain. `appliesTo.stages` is the authoritative Principle-to-Stage mapping, and every referenced id must exist in `pdlc/stages/catalog.json`. Load only packs relevant to the current decision.

Before Build Readiness, classify technology using stable capability tags such as `web-ui` or `mobile-ui`, load every selected pack, and record a concrete application entry in the Delivery Record. The approved requirements document must reference each selected `pack@version`; this makes the standards part of the build contract rather than optional background reading.

- `required`: block the checkpoint until satisfied or an approved exception is referenced.
- `risk-based`: apply as required when a declared trigger matches the record.
- `advisory`: report meaningful deviations without blocking.
- `not-applicable`: do not load; record a rationale when applicability could reasonably be questioned.

Do not weaken an enforcement level in a Delivery Record. Changes to a pack belong to its owning department and should later be protected by CODEOWNERS.

The mock UX standard is owned at `pdlc/principles/ux/pack.json`. UX maintainers should replace its sample design tokens and rules, update applicability metadata, and bump the semantic version there.

An individual principle may expose itself as an automatic Requirements standard through `standardDefault` metadata:

- `key`: stable dotted identity used for layering and traceability;
- `topic`: Requirements coverage topic supported by the standard;
- `policy: constraint`: locked enterprise rule that project profiles cannot override;
- `policy: default`: enterprise recommendation that a project profile or explicit reviewed decision may replace.

The requirement text remains defined once in the Principle Pack. Standard resolution reuses it rather than copying enterprise policy into platform instructions or project profiles. Read [standard-defaults.md](standard-defaults.md) for layering and conversation behavior.
