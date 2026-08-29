import { AuditLog, type NewAuditEvent } from "./audit.ts";
import { PdlcError } from "./errors.ts";
import { withLock } from "./lock.ts";
import { FileStateStore } from "./state.ts";
import type { AuditEvent, PocDeliveryRecord } from "./types.ts";

type ControlledAuditInput = Omit<NewAuditEvent, "recordId">;

export async function persistRecordAndAudit(
  workspaceRoot: string,
  original: PocDeliveryRecord,
  updated: PocDeliveryRecord,
  auditInput: ControlledAuditInput,
): Promise<AuditEvent> {
  if (updated.id !== original.id) {
    throw new PdlcError("INVALID_ARGUMENT", "A controlled mutation cannot change the Delivery Record id");
  }
  const store = new FileStateStore(workspaceRoot);
  const audit = new AuditLog(workspaceRoot);
  const event = audit.create(updated, { recordId: updated.id, ...auditInput });

  return withLock(workspaceRoot, `controlled-mutation-${updated.id}`, async () => {
    let recordWritten = false;
    try {
      await store.writeRecord(updated, original.revision);
      recordWritten = true;
      await audit.append(event);
      return event;
    } catch (error) {
      if (recordWritten) {
        try {
          await store.restoreRecordAfterFailedMutation(original, updated.revision);
        } catch (rollbackError) {
          throw new PdlcError("STATE_AUDIT_ROLLBACK_FAILED", "Controlled Delivery Record mutation failed and rollback was incomplete", {
            cause: error instanceof Error ? error.message : String(error),
            rollbackFailure: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          });
        }
        throw new PdlcError("STATE_AUDIT_PERSISTENCE_FAILED", "Controlled Delivery Record mutation was not committed because its Audit Event could not be persisted; the previous Record was restored", {
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  });
}
