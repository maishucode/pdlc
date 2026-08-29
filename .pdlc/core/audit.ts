import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PdlcError } from "./errors.ts";
import { sha256 } from "./hash.ts";
import { validateAuditEvent } from "./schema.ts";
import type { AuditEvent, PocDeliveryRecord } from "./types.ts";
import { withLock } from "./lock.ts";

export type NewAuditEvent = Omit<AuditEvent, "schemaVersion" | "eventId" | "timestamp" | "recordHash">;

export class AuditLog {
  readonly workspaceRoot: string;
  readonly path: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.path = join(workspaceRoot, ".pdlc", "runtime", "audit", "events.jsonl");
  }

  create(record: PocDeliveryRecord, input: NewAuditEvent): AuditEvent {
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
    await mkdir(dirname(this.path), { recursive: true });
    await withLock(this.workspaceRoot, "audit-log", async () => {
      await appendFile(this.path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    });
  }

  async readAll(): Promise<AuditEvent[]> {
    let contents: string;
    try {
      contents = await readFile(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }
    return contents
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
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
