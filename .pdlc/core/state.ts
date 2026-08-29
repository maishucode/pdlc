import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PdlcError } from "./errors.ts";
import { validatePocDeliveryRecord } from "./schema.ts";
import type { PocDeliveryRecord } from "./types.ts";
import { withLock } from "./lock.ts";

function safeRecordId(recordId: string): string {
  if (!/^POC-[A-Z0-9][A-Z0-9-]*$/.test(recordId)) {
    throw new PdlcError("INVALID_RECORD_ID", `Unsafe or invalid POC record id: ${recordId}`);
  }
  return recordId;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    });
  }
}

export class FileStateStore {
  readonly workspaceRoot: string;
  readonly stateRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.stateRoot = join(workspaceRoot, ".pdlc", "runtime");
  }

  recordPath(recordId: string): string {
    return join(this.stateRoot, "records", `${safeRecordId(recordId)}.json`);
  }

  async readRecord(recordId: string): Promise<PocDeliveryRecord> {
    const path = this.recordPath(recordId);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new PdlcError("RECORD_NOT_FOUND", `Delivery Record not found: ${recordId}`);
      }
      throw error;
    }
    const validation = validatePocDeliveryRecord(parsed);
    if (!validation.ok) {
      throw new PdlcError("VALIDATION_FAILED", `Delivery Record is invalid: ${recordId}`, validation.issues);
    }
    return validation.value;
  }

  async writeRecord(record: PocDeliveryRecord, expectedRevision?: number): Promise<void> {
    const validation = validatePocDeliveryRecord(record);
    if (!validation.ok) {
      throw new PdlcError("VALIDATION_FAILED", `Refusing to write invalid Delivery Record: ${record.id}`, validation.issues);
    }
    await withLock(this.workspaceRoot, `record-${record.id}`, async () => {
      let existing: PocDeliveryRecord | undefined;
      try {
        existing = await this.readRecord(record.id);
      } catch (error) {
        if (!(error instanceof PdlcError) || error.code !== "RECORD_NOT_FOUND") throw error;
      }

      if (!existing) {
        if (expectedRevision !== undefined || record.revision !== 0) {
          throw new PdlcError("REVISION_CONFLICT", `New Delivery Record ${record.id} must start at revision 0`);
        }
      } else if (
        expectedRevision === undefined
        || existing.revision !== expectedRevision
        || record.revision !== expectedRevision + 1
      ) {
        throw new PdlcError(
          "REVISION_CONFLICT",
          `Delivery Record ${record.id} revision conflict; current=${existing.revision}, expected=${expectedRevision ?? "not supplied"}, proposed=${record.revision}`,
        );
      }
      await atomicWrite(this.recordPath(record.id), `${JSON.stringify(record, null, 2)}\n`);
    });
  }

  async restoreRecordAfterFailedMutation(record: PocDeliveryRecord, expectedCurrentRevision: number): Promise<void> {
    const validation = validatePocDeliveryRecord(record);
    if (!validation.ok) {
      throw new PdlcError("VALIDATION_FAILED", `Refusing to restore invalid Delivery Record: ${record.id}`, validation.issues);
    }
    await withLock(this.workspaceRoot, `record-${record.id}`, async () => {
      const existing = await this.readRecord(record.id);
      if (existing.revision !== expectedCurrentRevision) {
        throw new PdlcError(
          "REVISION_CONFLICT",
          `Cannot roll back Delivery Record ${record.id}; current=${existing.revision}, expected=${expectedCurrentRevision}`,
        );
      }
      await atomicWrite(this.recordPath(record.id), `${JSON.stringify(record, null, 2)}\n`);
    });
  }

  async setCurrentRecord(recordId: string): Promise<void> {
    const safeId = safeRecordId(recordId);
    await this.readRecord(safeId);
    await withLock(this.workspaceRoot, "current-record", async () => {
      await atomicWrite(join(this.stateRoot, "current"), `${safeId}\n`);
    });
  }

  async currentRecordId(): Promise<string> {
    let value: string;
    try {
      value = (await readFile(join(this.stateRoot, "current"), "utf8")).trim();
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new PdlcError("CURRENT_RECORD_NOT_SET", "No active Delivery Record is selected");
      }
      throw error;
    }
    return safeRecordId(value);
  }

  async readCurrentRecord(): Promise<PocDeliveryRecord> {
    return this.readRecord(await this.currentRecordId());
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
