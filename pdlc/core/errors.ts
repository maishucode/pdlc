export type PdlcErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_RECORD_ID"
  | "RECORD_NOT_FOUND"
  | "CURRENT_RECORD_NOT_SET"
  | "REVISION_CONFLICT"
  | "LOCK_HELD"
  | "LOCK_OWNERSHIP_LOST"
  | "VALIDATION_FAILED"
  | "WORKFLOW_NOT_FOUND"
  | "DUPLICATE_WORKFLOW"
  | "CHECKPOINT_NOT_IMPLEMENTED"
  | "BUILD_NOT_READY"
  | "PORTABILITY_VIOLATION";

export class PdlcError extends Error {
  readonly code: PdlcErrorCode;
  readonly details?: unknown;

  constructor(code: PdlcErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "PdlcError";
    this.code = code;
    this.details = details;
  }
}
