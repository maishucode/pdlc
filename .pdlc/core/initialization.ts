import { access, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { AuditLog } from "./audit.ts";
import { PdlcError } from "./errors.ts";
import { withLock } from "./lock.ts";
import { contextClassificationIssues, currentPocStage } from "./poc-progress.ts";
import { validatePocDeliveryRecord } from "./schema.ts";
import { FileStateStore } from "./state.ts";
import type { AuditEvent, PocDeliveryRecord, ValidationIssue } from "./types.ts";

export interface PocInitializationResult {
  record: PocDeliveryRecord;
  event: AuditEvent;
}

function initialRecordIssues(record: PocDeliveryRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [...contextClassificationIssues(record)];
  if (record.status !== "DRAFT") issues.push({ code: "INITIAL_STATUS_INVALID", path: "$.status", message: "A new POC must start in DRAFT status." });
  if (record.revision !== 0) issues.push({ code: "INITIAL_REVISION_INVALID", path: "$.revision", message: "A new POC must start at revision 0." });
  if (record.requirements.status !== "draft") issues.push({ code: "INITIAL_REQUIREMENTS_INVALID", path: "$.requirements.status", message: "A new POC must start with draft Requirements." });
  if (record.decision.outcome !== "") issues.push({ code: "INITIAL_DECISION_INVALID", path: "$.decision.outcome", message: "A new POC cannot have a final outcome." });
  if (record.decision.productizationPackage.contentHash !== "") issues.push({ code: "INITIAL_PACKAGE_INVALID", path: "$.decision.productizationPackage.contentHash", message: "A new POC cannot have a bound Productization Package." });
  if ([record.evidence.tests, record.evidence.build, record.evidence.security, record.evidence.demo].some((entries) => entries.length > 0)) {
    issues.push({ code: "INITIAL_EVIDENCE_INVALID", path: "$.evidence", message: "A new POC cannot start with verification evidence." });
  }
  if (record.resolution.contextApplications.length > 0) issues.push({ code: "INITIAL_CONTEXT_INVALID", path: "$.resolution.contextApplications", message: "Stage Context must be applied after POC initialization." });
  return issues;
}

async function removeIfPresent(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  });
}

export async function initializePocDeliveryRecord(
  workspaceRoot: string,
  input: unknown,
  actor: string,
): Promise<PocInitializationResult> {
  if (!actor.trim()) throw new PdlcError("INVALID_ARGUMENT", "POC initialization requires a non-empty actor identity");
  const validation = validatePocDeliveryRecord(input);
  if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", "Initial POC Delivery Record is invalid", validation.issues);
  const issues = initialRecordIssues(validation.value);
  const requirementsPath = resolve(workspaceRoot, validation.value.requirements.documentRef);
  const requirementsFromRoot = relative(resolve(workspaceRoot), requirementsPath);
  if (requirementsFromRoot === ".." || requirementsFromRoot.startsWith(`..${sep}`) || isAbsolute(requirementsFromRoot)) {
    issues.push({ code: "INITIAL_REQUIREMENTS_REF_UNSAFE", path: "$.requirements.documentRef", message: "Initial Requirements must remain inside the project workspace." });
  }
  if (issues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Initial POC Delivery Record violates initialization constraints", issues);
  try { await access(requirementsPath); }
  catch { throw new PdlcError("VALIDATION_FAILED", "Initial Requirements document does not exist", [{ code: "INITIAL_REQUIREMENTS_MISSING", path: "$.requirements.documentRef", message: `Create ${validation.value.requirements.documentRef} before initializing the POC.` }]); }

  const timestamp = new Date().toISOString();
  const record: PocDeliveryRecord = { ...validation.value, createdAt: timestamp, updatedAt: timestamp };
  const store = new FileStateStore(workspaceRoot);
  const audit = new AuditLog(workspaceRoot);
  const event = audit.create(record, {
    recordId: record.id,
    eventType: "DELIVERY_FLOW_CREATED",
    stage: currentPocStage(record),
    toStatus: record.status,
    actor: actor.trim(),
    riskLevel: record.risk.level,
    evidenceRefs: [record.requirements.documentRef],
  });

  return withLock(workspaceRoot, "poc-initialization", async () => {
    let previousCurrent: string | undefined;
    try {
      previousCurrent = await store.currentRecordId();
      await store.readRecord(previousCurrent);
    } catch (error) {
      if (!(error instanceof PdlcError) || error.code !== "CURRENT_RECORD_NOT_SET") throw error;
    }

    let recordCreated = false;
    let currentChanged = false;
    try {
      await store.writeRecord(record);
      recordCreated = true;
      await store.setCurrentRecord(record.id);
      currentChanged = true;
      await audit.append(event);
      return { record, event };
    } catch (error) {
      const rollbackFailures: string[] = [];
      if (currentChanged) {
        try {
          if (previousCurrent) await store.setCurrentRecord(previousCurrent);
          else await removeIfPresent(join(workspaceRoot, ".pdlc", "runtime", "current"));
        } catch (rollbackError) {
          rollbackFailures.push(`current pointer: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        }
      }
      if (recordCreated) {
        try { await removeIfPresent(store.recordPath(record.id)); }
        catch (rollbackError) { rollbackFailures.push(`Delivery Record: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`); }
      }
      if (rollbackFailures.length > 0) {
        throw new PdlcError("INITIALIZATION_ROLLBACK_FAILED", "POC initialization failed and rollback was incomplete", { cause: error instanceof Error ? error.message : String(error), rollbackFailures });
      }
      throw error;
    }
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
