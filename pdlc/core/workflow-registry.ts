import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PdlcError } from "./errors.ts";
import { validateWorkflowDefinition } from "./schema.ts";
import type { WorkflowDefinition, WorkflowId } from "./types.ts";

export class WorkflowRegistry {
  readonly definitions: ReadonlyMap<WorkflowId, WorkflowDefinition>;

  constructor(definitions: WorkflowDefinition[]) {
    const byId = new Map<WorkflowId, WorkflowDefinition>();
    for (const definition of definitions) {
      if (byId.has(definition.id)) {
        throw new PdlcError("DUPLICATE_WORKFLOW", `Duplicate workflow definition: ${definition.id}`);
      }
      byId.set(definition.id, definition);
    }
    this.definitions = byId;
  }

  static async load(directory: string): Promise<WorkflowRegistry> {
    const entries = await readdir(directory, { withFileTypes: true });
    const definitions: WorkflowDefinition[] = [];
    for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(directory, entry.name, "workflow.json");
      let raw: string;
      try {
        raw = await readFile(file, "utf8");
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") continue;
        throw error;
      }
      const validation = validateWorkflowDefinition(JSON.parse(raw) as unknown);
      if (!validation.ok) {
        throw new PdlcError("VALIDATION_FAILED", `Invalid workflow definition: ${file}`, validation.issues);
      }
      definitions.push(validation.value);
    }
    return new WorkflowRegistry(definitions);
  }

  get(id: WorkflowId): WorkflowDefinition {
    const definition = this.definitions.get(id);
    if (!definition) throw new PdlcError("WORKFLOW_NOT_FOUND", `Workflow not found: ${id}`);
    return definition;
  }

  list(): WorkflowDefinition[] {
    return [...this.definitions.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

