import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { AuditLog } from "./audit.ts";
import { PdlcError } from "./errors.ts";
import { withLock } from "./lock.ts";
import { ProjectPaths, safeRecordId } from "./project-paths.ts";
import { validateAuditEvent, validatePocDeliveryRecord } from "./schema.ts";
import type { AuditEvent } from "./types.ts";

export interface StorageMigrationResult {
  migrated: boolean;
  records: string[];
  auditFiles: string[];
  inboxDrafts: string[];
  current?: string;
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function regularFiles(path: string, suffix?: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(path, { withFileTypes: true }); }
  catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name !== ".gitkeep" && (!suffix || entry.name.endsWith(suffix)))
    .map((entry) => entry.name)
    .sort();
}

async function parseLegacyAudit(path: string): Promise<AuditEvent[]> {
  if (!await exists(path)) return [];
  const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
  return lines.map((line, index) => {
    let value: unknown;
    try { value = JSON.parse(line) as unknown; }
    catch (error) { throw new PdlcError("LEGACY_AUDIT_INVALID", `Legacy audit line ${index + 1} is not valid JSON`, error); }
    const validation = validateAuditEvent(value);
    if (!validation.ok) throw new PdlcError("LEGACY_AUDIT_INVALID", `Legacy audit line ${index + 1} is invalid`, validation.issues);
    return validation.value;
  });
}

function upgradeLegacyRecord(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.deliveryFlow === "poc" && record.schemaVersion === 2) {
      return { ...record, schemaVersion: 3, source: { baseRevision: "", derivedFromRecord: "", deliveredRevision: "" } };
    }
  }
  return value;
}

async function upgradedRecordContents(path: string): Promise<string> {
  let parsed: unknown;
  try { parsed = upgradeLegacyRecord(JSON.parse(await readFile(path, "utf8")) as unknown); }
  catch (error) { throw new PdlcError("LEGACY_RECORD_INVALID", `Legacy record is not valid JSON: ${path}`, error); }
  const validation = validatePocDeliveryRecord(parsed);
  if (!validation.ok) throw new PdlcError("LEGACY_RECORD_INVALID", `Legacy record cannot be migrated: ${path}`, validation.issues);
  return `${JSON.stringify(validation.value, null, 2)}\n`;
}

export async function migrateLegacyStorage(workspaceRoot: string): Promise<StorageMigrationResult> {
  const paths = new ProjectPaths(workspaceRoot);
  if (!await exists(paths.legacyRuntimeRoot)) return { migrated: false, records: [], auditFiles: [], inboxDrafts: [] };

  const legacyRecordsRoot = join(paths.legacyRuntimeRoot, "records");
  const recordFiles = await regularFiles(legacyRecordsRoot, ".json");
  const inboxFiles = await regularFiles(paths.legacyInboxRoot, ".json");
  const lockFiles = await regularFiles(paths.legacyLocksRoot);
  const legacyEvents = await parseLegacyAudit(paths.legacyAudit);
  const legacyCurrent = await exists(paths.legacyCurrent) ? (await readFile(paths.legacyCurrent, "utf8")).trim() : undefined;
  if (lockFiles.length > 0) throw new PdlcError("LEGACY_LOCKS_PRESENT", "Cannot migrate while legacy Runner locks exist", lockFiles);

  const newRecords = await regularFiles(paths.recordsRoot, ".json");
  const newAudits = await regularFiles(paths.auditRoot, ".jsonl");
  const newInbox = await regularFiles(paths.inboxRoot, ".json");
  const newCurrentExists = await exists(paths.currentRecord);
  const hasLegacyData = recordFiles.length + inboxFiles.length + legacyEvents.length > 0 || Boolean(legacyCurrent);
  const hasNewData = newRecords.length + newAudits.length + newInbox.length > 0 || newCurrentExists;
  if (hasLegacyData && hasNewData) {
    throw new PdlcError("STORAGE_LAYOUT_CONFLICT", "Both legacy .pdlc/runtime data and project-owned pdlc data exist; refusing to merge them automatically");
  }
  if (!hasLegacyData) {
    await rm(paths.legacyRuntimeRoot, { recursive: true, force: true });
    return { migrated: true, records: [], auditFiles: [], inboxDrafts: [] };
  }

  const groupedEvents = new Map<string, AuditEvent[]>();
  for (const event of legacyEvents) {
    safeRecordId(event.recordId);
    const entries = groupedEvents.get(event.recordId) ?? [];
    entries.push(event);
    groupedEvents.set(event.recordId, entries);
  }
  if (legacyCurrent) safeRecordId(legacyCurrent);

  return withLock(workspaceRoot, "storage-layout-migration", async () => {
    const created: string[] = [];
    try {
      await Promise.all([mkdir(paths.recordsRoot, { recursive: true }), mkdir(paths.auditRoot, { recursive: true }), mkdir(paths.inboxRoot, { recursive: true })]);
      for (const file of recordFiles) {
        const id = safeRecordId(basename(file, ".json"));
        const from = join(legacyRecordsRoot, file);
        const to = paths.record(id);
        await writeFile(to, await upgradedRecordContents(from), { encoding: "utf8", flag: "wx", mode: 0o600 });
        created.push(to);
      }
      for (const file of inboxFiles) {
        const id = safeRecordId(basename(file, ".json"));
        const from = join(paths.legacyInboxRoot, file);
        const to = paths.inbox(id);
        await writeFile(to, await upgradedRecordContents(from), { encoding: "utf8", flag: "wx", mode: 0o600 });
        created.push(to);
      }
      if (legacyCurrent) {
        await mkdir(paths.stateRoot, { recursive: true });
        await writeFile(paths.currentRecord, `${legacyCurrent}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
        created.push(paths.currentRecord);
      }
      for (const [recordId, events] of groupedEvents) {
        const path = new AuditLog(workspaceRoot).pathFor(recordId);
        await writeFile(path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
        created.push(path);
      }
      await rm(paths.legacyRuntimeRoot, { recursive: true, force: true });
      return {
        migrated: true,
        records: recordFiles.map((file) => basename(file, ".json")),
        auditFiles: [...groupedEvents.keys()].sort(),
        inboxDrafts: inboxFiles.map((file) => basename(file, ".json")),
        current: legacyCurrent,
      };
    } catch (error) {
      for (const path of created.reverse()) await unlink(path).catch(() => undefined);
      throw new PdlcError("STORAGE_MIGRATION_FAILED", "Legacy storage migration failed and was rolled back", error instanceof Error ? error.message : String(error));
    }
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
