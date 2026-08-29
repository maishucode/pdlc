import { readFile } from "node:fs/promises";
import { PdlcError } from "./errors.ts";
import { validateRequirementsFlowControl } from "./schema.ts";
import type { RequirementsFlowControl } from "./types.ts";

export async function loadRequirementsFlowControl(file: string): Promise<RequirementsFlowControl> {
  const value = JSON.parse(await readFile(file, "utf8")) as unknown;
  const validation = validateRequirementsFlowControl(value);
  if (!validation.ok) {
    throw new PdlcError("VALIDATION_FAILED", `Invalid Requirements Flow Control: ${file}`, validation.issues);
  }
  return validation.value;
}
