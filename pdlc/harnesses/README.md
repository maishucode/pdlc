# Harness Adapter Ownership

Primary owner: **Developer Experience and AI Coding Platform Team**. Harness Engineering reviews contract and portability behavior.

This folder contains platform-neutral capabilities, adapter contracts, and validation. Platform-specific discovery files remain thin and must not contain workflow or governance logic.

The GitHub Copilot capability declaration covers shared Skills, repository instructions, a custom Agent, an IDE Prompt File, command approval, and cloud-environment setup. Entrypoint validation checks the corresponding repository files without moving Copilot-specific logic into the Core.
