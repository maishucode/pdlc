import { sha256 } from "./hash.ts";

export interface StageInvocationPermissions {
  filesystem: "read" | "write";
  network: boolean;
  externalWrites: boolean;
}

export function stageAgentInvocationId(contextHash: string, stage: string): string {
  return sha256({ schemaVersion: 1, contextHash, stage });
}

export function aggregateStageInvocationPermissions(
  contributions: Array<{ permissions: StageInvocationPermissions }>,
): StageInvocationPermissions {
  return {
    filesystem: contributions.some(({ permissions }) => permissions.filesystem === "write") ? "write" : "read",
    network: contributions.some(({ permissions }) => permissions.network),
    externalWrites: contributions.some(({ permissions }) => permissions.externalWrites),
  };
}
