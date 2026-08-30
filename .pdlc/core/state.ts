import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PdlcError } from "./errors.ts";
import { ProjectPaths, safeRecordId } from "./project-paths.ts";
import { validateDeliveryRecordEnvelope } from "./schema.ts";
import type { BaseDeliveryRecord } from "./types.ts";
import { withLock } from "./lock.ts";

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
  readonly paths: ProjectPaths;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.paths = new ProjectPaths(workspaceRoot);
    this.stateRoot = this.paths.stateRoot;
  }

  recordPath(recordId: string): string {
    return this.paths.record(recordId);
  }

  async readRecord<T extends BaseDeliveryRecord = BaseDeliveryRecord>(recordId: string): Promise<T> {
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
    const validation = validateDeliveryRecordEnvelope(parsed);
    if (!validation.ok) {
      throw new PdlcError("VALIDATION_FAILED", `Delivery Record is invalid: ${recordId}`, validation.issues);
    }
    return validation.value as T;
  }

  async writeRecord(record: BaseDeliveryRecord, expectedRevision?: number): Promise<void> {
    const validation = validateDeliveryRecordEnvelope(record);
    if (!validation.ok) {
      throw new PdlcError("VALIDATION_FAILED", `Refusing to write invalid Delivery Record: ${record.id}`, validation.issues);
    }
    await withLock(this.workspaceRoot, `record-${record.id}`, async () => {
      let existing: BaseDeliveryRecord | undefined;
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

  async restoreRecordAfterFailedMutation(record: BaseDeliveryRecord, expectedCurrentRevision: number): Promise<void> {
    const validation = validateDeliveryRecordEnvelope(record);
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
      await atomicWrite(this.paths.currentRecord, `${safeId}\n`);
    });
  }

  async listRecords(): Promise<BaseDeliveryRecord[]> {
    let files: string[];
    try {
      files = await readdir(this.paths.recordsRoot);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }
    const ids = files
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -".json".length))
      .sort();
    return Promise.all(ids.map((recordId) => this.readRecord(recordId)));
  }

  async activeRecords(isTerminal?: (record: BaseDeliveryRecord) => boolean | Promise<boolean>): Promise<BaseDeliveryRecord[]> {
    const records = await this.listRecords();
    if (!isTerminal) return records;
    const terminal = await Promise.all(records.map((record) => isTerminal(record)));
    return records.filter((_, index) => !terminal[index]);
  }

  async currentRecordId(isTerminal?: (record: BaseDeliveryRecord) => boolean | Promise<boolean>): Promise<string> {
    let value: string;
    try {
      value = (await readFile(this.paths.currentRecord, "utf8")).trim();
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        const active = await this.activeRecords(isTerminal);
        if (active.length === 1) return active[0]!.id;
        if (active.length > 1) {
          throw new PdlcError("MULTIPLE_ACTIVE_RECORDS", "Multiple active Delivery Records exist; select one explicitly", active.map(({ id, status }) => ({ id, status })));
        }
        throw new PdlcError("CURRENT_RECORD_NOT_SET", "No active Delivery Record is selected");
      }
      throw error;
    }
    return safeRecordId(value);
  }

  async readCurrentRecord<T extends BaseDeliveryRecord = BaseDeliveryRecord>(isTerminal?: (record: BaseDeliveryRecord) => boolean | Promise<boolean>): Promise<T> {
    return this.readRecord<T>(await this.currentRecordId(isTerminal));
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
