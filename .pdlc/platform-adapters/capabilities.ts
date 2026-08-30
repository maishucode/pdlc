import type { PlatformCapability, PlatformId } from "./contract.ts";

export const BASELINE_CAPABILITIES: ReadonlySet<PlatformCapability> = new Set([
  "shared-skill",
  "repository-instructions",
  "command-approval",
]);

export const DECLARED_CAPABILITIES: Readonly<Record<PlatformId, ReadonlySet<PlatformCapability>>> = {
  codex: new Set(BASELINE_CAPABILITIES),
  "github-copilot": new Set([
    ...BASELINE_CAPABILITIES,
    "custom-agent",
    "native-subagent",
    "prompt-file",
    "cloud-environment-setup",
  ]),
};
