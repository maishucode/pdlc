import type { HarnessCapability, HarnessId } from "./contract.ts";

export const BASELINE_CAPABILITIES: ReadonlySet<HarnessCapability> = new Set([
  "shared-skill",
  "repository-instructions",
  "command-approval",
]);

export const DECLARED_CAPABILITIES: Readonly<Record<HarnessId, ReadonlySet<HarnessCapability>>> = {
  codex: new Set(BASELINE_CAPABILITIES),
  "github-copilot": new Set([
    ...BASELINE_CAPABILITIES,
    "custom-agent",
    "prompt-file",
    "cloud-environment-setup",
  ]),
};
