import { PdlcError } from "./errors.ts";
import type { DeliveryFlowCheckpoint, ExecutableDeliveryFlowDefinition, PocDeliveryRecord, ValidationIssue } from "./types.ts";

export function checkpointFor(flow: ExecutableDeliveryFlowDefinition, id: string): DeliveryFlowCheckpoint {
  const checkpoint = flow.controls.checkpoints.find((entry) => entry.id === id);
  if (!checkpoint) throw new PdlcError("INVALID_ARGUMENT", `Unknown checkpoint for ${flow.id}: ${id}`);
  return checkpoint;
}

export function assertCheckpointActor(record: PocDeliveryRecord, checkpoint: DeliveryFlowCheckpoint, actor?: string): string {
  if (!actor?.trim()) throw new PdlcError("INVALID_ARGUMENT", `Checkpoint '${checkpoint.id}' requires --actor <identity>`);
  const assigned = record.assignments[checkpoint.ownerRole];
  if (!assigned || assigned !== actor) throw new PdlcError("INVALID_ARGUMENT", `Checkpoint '${checkpoint.id}' must be performed by the assigned ${checkpoint.ownerRole} role`);
  return actor;
}

export function flowConstraintIssues(
  record: PocDeliveryRecord,
  flow: ExecutableDeliveryFlowDefinition,
  resolvedIntegrations: readonly string[],
  requiredRoles: readonly string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (record.scope.productionUse !== flow.controls.constraints.productionUse) {
    issues.push({ code: "FLOW_PRODUCTION_CONSTRAINT", path: "$.scope.productionUse", message: `Delivery Flow requires productionUse=${flow.controls.constraints.productionUse}` });
  }
  const allowedIntegrations = new Set(flow.controls.constraints.externalIntegrations);
  for (const ref of resolvedIntegrations) {
    const id = ref.split("@")[0]!;
    if (!allowedIntegrations.has(ref) && !allowedIntegrations.has(id)) issues.push({ code: "FLOW_INTEGRATION_CONSTRAINT", path: "$.resolution.integrations", message: `External Integration is not allowed by this Delivery Flow: ${ref}` });
  }
  if (!flow.controls.constraints.allowSinglePersonAllRoles) {
    const identities = requiredRoles.map((role) => record.assignments[role]).filter(Boolean);
    if (new Set(identities).size !== identities.length) issues.push({ code: "ROLE_SEPARATION_REQUIRED", path: "$.assignments", message: "This Delivery Flow requires separate identities for its required Roles" });
  }
  return issues;
}
