# UX Principle Pack ownership

This folder is the source of truth for UX standards used by the Lean PDLC Harness.

The UX team owns `pack.json`. To change the corporate design system:

1. Edit or add principles in `pack.json`.
2. Keep each requirement concrete enough for an implementer and reviewer to verify.
3. Update `appliesTo.technologies` when the standard covers another UI technology class.
4. Increase the semantic `version` whenever behavior changes.
5. Keep previous versions available during active deliveries once versioned pack loading is introduced.
6. Use `standardDefault.policy: constraint` only for a mandatory corporate rule. Use `default` when a reviewed project profile may replace the recommendation.

The current `1.0.0` content is mock guidance. Its blue tokens and accessibility rules exist to prove end-to-end loading, traceability, and Build Readiness enforcement; replace them with the company's approved UX standards before formal adoption.

Applicable entries are automatically added to Requirements. Delivery users should not be asked to select the corporate palette, semantic-color rule, accessibility baseline, responsive baseline, or complete-state baseline one by one. They still confirm product-specific interaction behavior, scenarios, scope, and success criteria.

Typical technology classifications are `web-ui` and `mobile-ui`. Framework names such as React belong in the Delivery Record as additional technologies, but the baseline is selected through the technology class so it remains framework-neutral.
