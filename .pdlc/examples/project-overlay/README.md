# Project Overlay example

Copy the `pdlc/disciplines/` shape into a product repository and keep only the Disciplines the project actually customizes.

- `baseline.json` records approved facts that later Stages should not ask again.
- `policies/` adds project-specific mandatory rules; it cannot weaken enterprise Policies.
- `defaults/` supplies project preferences and approved implementation choices.
- `knowledge/` stores project-local context and references as metadata plus content. Use `guidance/`, `references/`, or `kb/`; every asset declares its owning Discipline and `appliesTo` scope.

The example architecture baseline, web-stack Default, and system-context Knowledge deliberately remain separate: they are respectively an approved fact, an overrideable choice, and advisory context resolved only for applicable Stages.

The old `pdlc/config/disciplines/` path is not read. Move its Discipline folders directly under `pdlc/disciplines/`; the Runner fails closed while the legacy path remains so project governance is never silently skipped.
