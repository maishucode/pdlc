import { readFile } from "node:fs/promises";
import { PdlcError } from "./errors.ts";
import { validateRequirementsPolicy } from "./schema.ts";
import type { RequirementsPolicy } from "./types.ts";

export async function loadRequirementsPolicy(file: string): Promise<RequirementsPolicy> {
  const value = JSON.parse(await readFile(file, "utf8")) as unknown;
  const validation = validateRequirementsPolicy(value);
  if (!validation.ok) {
    throw new PdlcError("VALIDATION_FAILED", `Invalid Requirements Policy: ${file}`, validation.issues);
  }
  return validation.value;
}
