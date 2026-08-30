import { unlink } from "node:fs/promises";
import { AuditLog } from "./audit.ts";
import {
  genericAuditSummary,
  genericCheckpoint,
  genericStatus,
  loadFlowExecutor,
  type DeliveryFlowExecutor,
  type FlowExecutionContext,
  type FlowRunnerOptions,
} from "./flow-executor.ts";
import { HarnessContext } from "./harness-context.ts";
import { PdlcError } from "./errors.ts";
import { withLock } from "./lock.ts";
import { ProjectPaths } from "./project-paths.ts";
import { validateDeliveryRecordEnvelope } from "./schema.ts";
import { FileStateStore } from "./state.ts";
import type { AuditEvent, BaseDeliveryRecord, ExecutableDeliveryFlowDefinition } from "./types.ts";

export interface FlowInitializationResult {
  record: BaseDeliveryRecord;
  event: AuditEvent;
}

/** Stable, data-driven dispatch boundary between the Runner and Delivery Flows. */
export class FlowEngine {
  private constructor(
    readonly harnessRoot: string,
    readonly projectRoot: string,
    readonly harness: HarnessContext,
    readonly store: FileStateStore,
    readonly audit: AuditLog,
  ) {}

  static async load(harnessRoot: string, projectRoot: string): Promise<FlowEngine> {
    return new FlowEngine(
      harnessRoot,
      projectRoot,
      await HarnessContext.load(harnessRoot, projectRoot),
      new FileStateStore(projectRoot),
      new AuditLog(projectRoot),
    );
  }

  flow(id: string): ExecutableDeliveryFlowDefinition {
    return this.harness.model.deliveryFlows.getExecutable(id);
  }

  async executor(flow: ExecutableDeliveryFlowDefinition): Promise<DeliveryFlowExecutor | undefined> {
    return loadFlowExecutor(this.harnessRoot, flow);
  }

  async isTerminal(record: BaseDeliveryRecord): Promise<boolean> {
    const flow = this.flow(record.deliveryFlow);
    const executor = await this.executor(flow);
    return executor?.isTerminal?.(record, flow) ?? flow.controls.terminalStatuses.includes(record.status);
  }

  async activeRecords(): Promise<BaseDeliveryRecord[]> {
    return this.store.activeRecords((record) => this.isTerminal(record));
  }

  private context(flow: ExecutableDeliveryFlowDefinition): FlowExecutionContext {
    return {
      harnessRoot: this.harnessRoot,
      projectRoot: this.projectRoot,
      harness: this.harness,
      flow,
      store: this.store,
      audit: this.audit,
      activeRecords: () => this.activeRecords(),
    };
  }

  async read(options: Pick<FlowRunnerOptions, "record">): Promise<{ record: BaseDeliveryRecord; flow: ExecutableDeliveryFlowDefinition; executor?: DeliveryFlowExecutor }> {
    const record = options.record ? await this.store.readRecord(options.record) : await this.store.readCurrentRecord((selected) => this.isTerminal(selected));
    const flow = this.flow(record.deliveryFlow);
    const executor = await this.executor(flow);
    const validation = executor?.validateRecord?.(record) ?? validateDeliveryRecordEnvelope(record);
    if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", `Delivery Record is invalid for Flow ${flow.id}: ${record.id}`, validation.issues);
    return { record: validation.value, flow, executor };
  }

  async initialize(input: unknown, actor: string): Promise<FlowInitializationResult> {
    if (!actor.trim()) throw new PdlcError("INVALID_ARGUMENT", "Delivery Record initialization requires a non-empty actor identity");
    const flowId = typeof input === "object" && input !== null ? (input as { deliveryFlow?: unknown }).deliveryFlow : undefined;
    if (typeof flowId !== "string") throw new PdlcError("VALIDATION_FAILED", "Initial Delivery Record must declare deliveryFlow");
    const flow = this.flow(flowId);
    const executor = await this.executor(flow);
    const context = this.context(flow);
    const prepared = executor?.prepareInitialization
      ? await executor.prepareInitialization(context, input, actor.trim())
      : this.genericInitialization(input, flow);
    const validation = executor?.validateRecord?.(prepared.record) ?? validateDeliveryRecordEnvelope(prepared.record);
    if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", `Initial Delivery Record is invalid for Flow ${flow.id}`, validation.issues);
    if (validation.value.deliveryFlow !== flow.id) throw new PdlcError("VALIDATION_FAILED", "Flow executor returned a Record for a different Delivery Flow");
    if (validation.value.status !== flow.controls.initialStatus) throw new PdlcError("VALIDATION_FAILED", `New ${flow.id} records must start in ${flow.controls.initialStatus}`);
    if (validation.value.revision !== 0) throw new PdlcError("VALIDATION_FAILED", "New Delivery Records must start at revision 0");
    const timestamp = new Date().toISOString();
    const record = { ...validation.value, createdAt: timestamp, updatedAt: timestamp };
    const finalValidation = executor?.validateRecord?.(record) ?? validateDeliveryRecordEnvelope(record);
    if (!finalValidation.ok) throw new PdlcError("VALIDATION_FAILED", `Initialized Delivery Record is invalid for Flow ${flow.id}`, finalValidation.issues);
    const riskLevel = (record as { risk?: { level?: AuditEvent["riskLevel"] } }).risk?.level;
    const event = this.audit.create(record, {
      recordId: record.id,
      eventType: "DELIVERY_FLOW_CREATED",
      stage: prepared.stage,
      toStatus: record.status,
      actor: actor.trim(),
      riskLevel,
      evidenceRefs: prepared.evidenceRefs,
    });
    return withLock(this.projectRoot, `delivery-initialization-${record.id}`, async () => {
      const active = await this.activeRecords();
      if (active.length > 0) throw new PdlcError("ACTIVE_RECORD_EXISTS", "A workspace may have only one active Delivery Record", active.map(({ id, status }) => ({ id, status })));
      let previousCurrent: string | undefined;
      try { previousCurrent = await this.store.currentRecordId((selected) => this.isTerminal(selected)); }
      catch (error) { if (!(error instanceof PdlcError) || error.code !== "CURRENT_RECORD_NOT_SET") throw error; }
      let recordCreated = false;
      let currentChanged = false;
      try {
        await this.store.writeRecord(record);
        recordCreated = true;
        await this.store.setCurrentRecord(record.id);
        currentChanged = true;
        await this.audit.append(event);
        return { record, event };
      } catch (error) {
        const failures: string[] = [];
        if (currentChanged) try {
          if (previousCurrent) await this.store.setCurrentRecord(previousCurrent);
          else await unlink(new ProjectPaths(this.projectRoot).currentRecord).catch(ignoreMissing);
        } catch (rollback) { failures.push(`current pointer: ${message(rollback)}`); }
        if (recordCreated) try { await unlink(this.store.recordPath(record.id)).catch(ignoreMissing); }
        catch (rollback) { failures.push(`Delivery Record: ${message(rollback)}`); }
        if (failures.length > 0) throw new PdlcError("INITIALIZATION_ROLLBACK_FAILED", "Delivery Record initialization failed and rollback was incomplete", { cause: message(error), rollbackFailures: failures });
        throw error;
      }
    });
  }

  private genericInitialization(input: unknown, flow: ExecutableDeliveryFlowDefinition) {
    const validation = validateDeliveryRecordEnvelope(input);
    if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", "Initial Delivery Record envelope is invalid", validation.issues);
    return {
      record: validation.value,
      stage: this.harness.model.deliveryFlows.resolve(flow.id, [])[0]?.definition.id ?? flow.stageSequence[0]!.stageId,
      evidenceRefs: [],
    };
  }

  async checkpoint(options: FlowRunnerOptions, checkpointId: string): Promise<unknown> {
    const { record, flow, executor } = await this.read(options);
    return executor?.checkpoint
      ? executor.checkpoint(this.context(flow), options, checkpointId, record)
      : genericCheckpoint(this.context(flow), options, checkpointId, record);
  }

  async action(options: FlowRunnerOptions, actionId: string): Promise<unknown> {
    const { record, flow, executor } = await this.read(options);
    if (!(flow.runtime?.actions ?? []).includes(actionId)) throw new PdlcError("INVALID_ARGUMENT", `Flow ${flow.id} does not declare action '${actionId}'`);
    if (!executor?.action) throw new PdlcError("INVALID_FLOW_EXECUTOR", `Flow ${flow.id} declares actions but has no action executor`);
    return executor.action(this.context(flow), options, actionId, record);
  }

  async status(options: Pick<FlowRunnerOptions, "record">): Promise<unknown> {
    try {
      const { record, flow, executor } = await this.read(options);
      return executor?.status ? executor.status(this.context(flow), record) : genericStatus(flow, record);
    } catch (error) {
      if (!options.record && error instanceof PdlcError && error.code === "CURRENT_RECORD_NOT_SET") return { ok: true, initialized: false, message: error.message };
      throw error;
    }
  }

  async auditSummary(options: Pick<FlowRunnerOptions, "record">): Promise<unknown> {
    try {
      const { record, flow, executor } = await this.read(options);
      const events = await this.audit.readAll(record.id);
      return executor?.auditSummary ? executor.auditSummary(this.context(flow), record, events) : genericAuditSummary(record, events);
    } catch (error) {
      if (!options.record && error instanceof PdlcError && error.code === "CURRENT_RECORD_NOT_SET") return { ok: true, initialized: false, message: "No active Delivery Record is selected" };
      throw error;
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ignoreMissing(error: unknown): void {
  if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
