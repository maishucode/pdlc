# Platform Adapter Ownership

Primary owner: **Developer Experience and AI Coding Platform Team**. Harness Engineering reviews contract and portability behavior.

This folder contains the thin Codex and GitHub Copilot adapter contracts, capability declarations, and portability validation. Platform-specific discovery files remain thin and must not contain Delivery Flow or governance logic.

The GitHub Copilot adapter also compiles all required same-Stage Discipline Capabilities into one generic-subagent contract. Custom Discipline Agents remain optional projections; runtime execution reads canonical role profiles and candidate Skills from the contract. Entrypoint validation checks the repository files without moving platform-specific dispatch behavior into the Core.
