import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { AuditLog } from "./audit.ts";
import { persistRecordAndAudit } from "./controlled-mutation.ts";
import { PdlcError } from "./errors.ts";
import { checkpointFor } from "./flow-guard.ts";
import type { HarnessContext } from "./harness-context.ts";
import { FileStateStore } from "./state.ts";
import type {
  AuditEvent,
  BaseDeliveryRecord,
  DeliveryFlowDefinition,
  ExecutableDeliveryFlowDefinition,
  ValidationIssue,
  ValidationResult,
} from "./types.ts";

export interface FlowRunnerOptions {
  root: string;
  record?: string;
  actor?: string;
  input?: string;
  receipt?: string;
  outcome?: string;
  check?: boolean;
}

export interface FlowExecutionContext {
  harnessRoot: string;
  projectRoot: string;
  harness: HarnessContext;
  flow: ExecutableDeliveryFlowDefinition;
  store: FileStateStore;
  audit: AuditLog;
  activeRecords(): Promise<BaseDeliveryRecord[]>;
}

export interface FlowInitializationDescriptor {
  record: BaseDeliveryRecord;
  stage: string;
  evidenceRefs: string[];
}

export interface DeliveryFlowExecutor {
  validateConfiguration?(
    harnessRoot: string,
    flow: ExecutableDeliveryFlowDefinition,
  ): Promise<unknown> | unknown;
  validateRecord?(value: unknown): ValidationResult<BaseDeliveryRecord>;
  isTerminal?(record: BaseDeliveryRecord, flow: ExecutableDeliveryFlowDefinition): boolean;
  prepareInitialization?(
    context: FlowExecutionContext,
    input: unknown,
    actor: string,
  ): Promise<FlowInitializationDescriptor> | FlowInitializationDescriptor;
  checkpoint?(
    context: FlowExecutionContext,
    options: FlowRunnerOptions,
    checkpointId: string,
    record: BaseDeliveryRecord,
  ): Promise<unknown>;
  action?(
    context: FlowExecutionContext,
    options: FlowRunnerOptions,
    actionId: string,
    record: BaseDeliveryRecord,
  ): Promise<unknown>;
  status?(
    context: FlowExecutionContext,
    record: BaseDeliveryRecord,
  ): Promise<unknown> | unknown;
  auditSummary?(
    context: FlowExecutionContext,
    record: BaseDeliveryRecord,
    events: AuditEvent[],
  ): Promise<unknown> | unknown;
  operationalIssues?(
    context: FlowExecutionContext,
    record: BaseDeliveryRecord,
  ): Promise<ValidationIssue[]>;
}

interface ExecutorModule {
  deliveryFlowExecutor?: DeliveryFlowExecutor;
}

const executorCache = new Map<string, Promise<DeliveryFlowExecutor | undefined>>();

export async function loadFlowExecutor(
  harnessRoot: string,
  flow: DeliveryFlowDefinition,
): Promise<DeliveryFlowExecutor | undefined> {
  const executorRef = flow.runtime?.executor;
  if (!executorRef) return undefined;
  const flowRoot = resolve(harnessRoot, ".pdlc", "delivery-flows", flow.id);
  const path = resolve(flowRoot, executorRef);
  const location = relative(flowRoot, path);
  if (isAbsolute(executorRef) || location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) {
    throw new PdlcError("INVALID_FLOW_EXECUTOR", `Flow executor must remain inside its Delivery Flow folder: ${flow.id}`);
  }
  let pending = executorCache.get(path);
  if (!pending) {
    pending = import(pathToFileURL(path).href).then((module: ExecutorModule) => {
      if (!module.deliveryFlowExecutor || typeof module.deliveryFlowExecutor !== "object") {
        throw new PdlcError("INVALID_FLOW_EXECUTOR", `Flow executor does not export deliveryFlowExecutor: ${relative(harnessRoot, path)}`);
      }
      return module.deliveryFlowExecutor;
    });
    executorCache.set(path, pending);
  }
  return pending;
}

export async function genericCheckpoint(
  context: FlowExecutionContext,
  options: FlowRunnerOptions,
  checkpointId: string,
  original: BaseDeliveryRecord,
): Promise<unknown> {
  const definition = checkpointFor(context.flow, checkpointId);
  const actor = options.actor?.trim();
  if (!actor) throw new PdlcError("INVALID_ARGUMENT", `Checkpoint '${checkpointId}' requires --actor <identity>`);
  if (!definition.from.includes(original.status)) throw new PdlcError("INVALID_ARGUMENT", `Checkpoint '${checkpointId}' cannot transition a record in status ${original.status}`);
  const assigned = original.assignments[definition.ownerRole];
  if (assigned && assigned !== actor) throw new PdlcError("INVALID_ARGUMENT", `Checkpoint '${checkpointId}' must be performed by the assigned ${definition.ownerRole} role`);
  const target = definition.to ?? (options.outcome ? definition.toByOutcome?.[options.outcome] : undefined);
  if (!target) throw new PdlcError("INVALID_ARGUMENT", `Checkpoint '${checkpointId}' requires a valid --outcome`);
  const timestamp = new Date().toISOString();
  const requiredRoles = context.harness.model.deliveryFlows.requiredRoles(context.flow.id, []);
  const hasAssignments = Object.keys(original.assignments).length > 0;
  if (!hasAssignments && context.flow.controls.deliveryDefaults.roleAssignmentMode !== "approval-actor-all-roles") {
    throw new PdlcError(
      "INVALID_ARGUMENT",
      `Flow ${context.flow.id} uses role assignment mode '${context.flow.controls.deliveryDefaults.roleAssignmentMode}' and must provide assignments before a generic checkpoint`,
    );
  }
  const updated: BaseDeliveryRecord = {
    ...original,
    status: target,
    revision: original.revision + 1,
    updatedAt: timestamp,
    assignments: hasAssignments
      ? original.assignments
      : Object.fromEntries(requiredRoles.map((role) => [role, actor])),
  };
  await persistRecordAndAudit(context.projectRoot, original, updated, {
    eventType: "CHECKPOINT_APPROVED",
    checkpoint: checkpointId,
    fromStatus: original.status,
    toStatus: target,
    actor,
    riskLevel: (original as { risk?: { level?: AuditEvent["riskLevel"] } }).risk?.level,
    evidenceRefs: [],
    decision: options.outcome,
  });
  return { ok: true, recordId: updated.id, checkpoint: checkpointId, from: original.status, to: target, revision: updated.revision };
}

export function genericStatus(flow: ExecutableDeliveryFlowDefinition, record: BaseDeliveryRecord): unknown {
  return {
    ok: true,
    initialized: true,
    recordId: record.id,
    deliveryFlow: record.deliveryFlow,
    status: record.status,
    revision: record.revision,
    source: record.source,
    availableActions: flow.controls.checkpoints
      .filter(({ from }) => from.includes(record.status))
      .map(({ id, to, toByOutcome, ownerRole }) => ({ checkpoint: id, to, outcomes: toByOutcome ? Object.keys(toByOutcome) : undefined, ownerRole })),
  };
}

export function genericAuditSummary(record: BaseDeliveryRecord, events: AuditEvent[]): unknown {
  return {
    ok: true,
    initialized: true,
    recordId: record.id,
    deliveryFlow: record.deliveryFlow,
    status: record.status,
    revision: record.revision,
    timeline: events.map(({ eventId, timestamp, eventType, checkpoint, stage, fromStatus, toStatus, actor, evidenceRefs }) => ({ eventId, timestamp, eventType, checkpoint, stage, fromStatus, toStatus, actor, evidenceRefs })),
  };
}
