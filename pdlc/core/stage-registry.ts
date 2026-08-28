import { readFile } from "node:fs/promises";
import { PdlcError } from "./errors.ts";
import { validateStageCatalog } from "./schema.ts";
import type { StageCatalog, StageDefinition } from "./types.ts";

export class StageRegistry {
  readonly catalog: StageCatalog;
  readonly definitions: ReadonlyMap<string, StageDefinition>;

  constructor(catalog: StageCatalog) {
    this.catalog = catalog;
    const definitions = new Map<string, StageDefinition>();
    for (const stage of catalog.stages) {
      if (definitions.has(stage.id)) {
        throw new PdlcError("DUPLICATE_STAGE", `Duplicate canonical Stage: ${stage.id}`);
      }
      definitions.set(stage.id, stage);
    }
    this.definitions = definitions;
  }

  static async load(file: string): Promise<StageRegistry> {
    const validation = validateStageCatalog(JSON.parse(await readFile(file, "utf8")) as unknown);
    if (!validation.ok) {
      throw new PdlcError("VALIDATION_FAILED", `Invalid Stage Catalog: ${file}`, validation.issues);
    }
    return new StageRegistry(validation.value);
  }

  get(id: string): StageDefinition {
    const definition = this.definitions.get(id);
    if (!definition) throw new PdlcError("STAGE_NOT_FOUND", `Canonical Stage not found: ${id}`);
    return definition;
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  list(): StageDefinition[] {
    return this.catalog.stages;
  }
}
