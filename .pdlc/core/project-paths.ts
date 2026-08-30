import { join } from "node:path";
import { PdlcError } from "./errors.ts";

const RECORD_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;

export function safeRecordId(recordId: string): string {
  if (!RECORD_ID_PATTERN.test(recordId)) {
    throw new PdlcError("INVALID_RECORD_ID", `Unsafe or invalid Delivery Record id: ${recordId}`);
  }
  return recordId;
}

/** Canonical project-owned and legacy Harness-owned paths for one workspace/project. */
export class ProjectPaths {
  readonly workspaceRoot: string;
  readonly pdlcRoot: string;
  readonly recordsRoot: string;
  readonly auditRoot: string;
  readonly evidenceRoot: string;
  readonly artifactsRoot: string;
  readonly requirementsRoot: string;
  readonly disciplinesRoot: string;
  readonly stateRoot: string;
  readonly inboxRoot: string;
  readonly locksRoot: string;
  readonly currentRecord: string;
  readonly legacyRuntimeRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.pdlcRoot = join(workspaceRoot, "pdlc");
    this.recordsRoot = join(this.pdlcRoot, "records");
    this.auditRoot = join(this.pdlcRoot, "audit");
    this.evidenceRoot = join(this.pdlcRoot, "evidence");
    this.artifactsRoot = join(this.pdlcRoot, "artifacts");
    this.requirementsRoot = join(this.pdlcRoot, "requirements");
    this.disciplinesRoot = join(this.pdlcRoot, "disciplines");
    this.stateRoot = join(this.pdlcRoot, ".state");
    this.inboxRoot = join(this.stateRoot, "inbox");
    this.locksRoot = join(this.stateRoot, "locks");
    this.currentRecord = join(this.stateRoot, "current");
    this.legacyRuntimeRoot = join(workspaceRoot, ".pdlc", "runtime");
  }

  record(recordId: string): string {
    return join(this.recordsRoot, `${safeRecordId(recordId)}.json`);
  }

  audit(recordId: string): string {
    return join(this.auditRoot, `${safeRecordId(recordId)}.jsonl`);
  }

  inbox(recordId: string): string {
    return join(this.inboxRoot, `${safeRecordId(recordId)}.json`);
  }

  lock(name: string): string {
    return join(this.locksRoot, `${name}.lock`);
  }

  legacyRecord(recordId: string): string {
    return join(this.legacyRuntimeRoot, "records", `${safeRecordId(recordId)}.json`);
  }

  get legacyAudit(): string {
    return join(this.legacyRuntimeRoot, "audit", "events.jsonl");
  }

  get legacyCurrent(): string {
    return join(this.legacyRuntimeRoot, "current");
  }

  get legacyInboxRoot(): string {
    return join(this.legacyRuntimeRoot, "inbox");
  }

  get legacyLocksRoot(): string {
    return join(this.legacyRuntimeRoot, "locks");
  }
}
