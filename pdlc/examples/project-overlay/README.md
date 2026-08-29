# Project Overlay example

Copy the `.pdlc/project/domains/` shape into a product repository and keep only the Domains the project actually customizes.

- `baseline.json` records approved facts that later Stages should not ask again.
- `controls/` adds project-specific mandatory rules; it cannot weaken enterprise Controls.
- `defaults/` supplies project preferences and approved implementation choices.
- `knowledge/` stores project-local context and references.

The example architecture baseline and web-stack Default deliberately remain separate: one is an approved fact, while the other participates in Default precedence.
