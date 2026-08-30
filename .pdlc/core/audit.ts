import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { PdlcError } from "./errors.ts";
import { sha256 } from "./hash.ts";
import { ProjectPaths } from "./project-paths.ts";
import { validateAuditEvent } from "./schema.ts";
import type { AuditEvent, BaseDeliveryRecord } from "./types.ts";
import { withLock } from "./lock.ts";

export type NewAuditEvent = Omit<AuditEvent, "schemaVersion" | "eventId" | "timestamp" | "recordHash">;

export class AuditLog {
  readonly workspaceRoot: string;
  readonly paths: ProjectPaths;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.paths = new ProjectPaths(workspaceRoot);
  }

  pathFor(recordId: string): string {
    return this.paths.audit(recordId);
  }

  create(record: BaseDeliveryRecord, input: NewAuditEvent): AuditEvent {
    return {
      schemaVersion: 1,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      recordHash: sha256(record),
      ...input,
    };
  }

  async append(event: AuditEvent): Promise<void> {
    const validation = validateAuditEvent(event);
    if (!validation.ok) {
      throw new PdlcError("VALIDATION_FAILED", "Refusing to append an invalid audit event", validation.issues);
    }
    const path = this.pathFor(event.recordId);
    await mkdir(dirname(path), { recursive: true });
    await withLock(this.workspaceRoot, `audit-${event.recordId}`, async () => {
      await appendFile(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    });
  }

  async readAll(recordId?: string): Promise<AuditEvent[]> {
    if (recordId) return this.readFile(this.pathFor(recordId));
    let files: string[];
    try {
      files = (await readdir(this.paths.auditRoot)).filter((file) => file.endsWith(".jsonl")).sort();
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }
    const groups = await Promise.all(files.map((file) => this.readFile(join(this.paths.auditRoot, file))));
    return groups.flat().sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.eventId.localeCompare(right.eventId));
  }

  private async readFile(path: string): Promise<AuditEvent[]> {
    let contents: string;
    try {
      contents = await readFile(path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }
    const events = contents
      .split("\n")
      .filter(Boolean)
      .map((line, index) => {
        const value = JSON.parse(line) as unknown;
        const validation = validateAuditEvent(value);
        if (!validation.ok) {
          throw new PdlcError("VALIDATION_FAILED", `Invalid audit event at line ${index + 1}`, validation.issues);
        }
        return validation.value;
      });
    const expectedRecordId = basename(path, ".jsonl");
    events.forEach((event, index) => {
      if (event.recordId !== expectedRecordId) {
        throw new PdlcError("AUDIT_RECORD_MISMATCH", `Audit event at line ${index + 1} belongs to ${event.recordId}, not ${expectedRecordId}`);
      }
    });
    return events;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
