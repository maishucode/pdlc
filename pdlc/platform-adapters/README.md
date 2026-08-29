# Platform Adapter Ownership

Primary owner: **Developer Experience and AI Coding Platform Team**. Harness Engineering reviews contract and portability behavior.

This folder contains the thin Codex and GitHub Copilot adapter contracts, capability declarations, and portability validation. Platform-specific discovery files remain thin and must not contain Delivery Flow or governance logic.

The GitHub Copilot capability declaration covers shared Skills, repository instructions, a custom Agent, an IDE Prompt File, command approval, and cloud-environment setup. Entrypoint validation checks the corresponding repository files without moving Copilot-specific logic into the Core.
