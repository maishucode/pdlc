import { readFile } from "node:fs/promises";
import { PdlcError } from "./errors.ts";
import { validateStageCatalog } from "./schema.ts";
import type { StageCatalog, StageDefinition } from "./types.ts";
import type { RoleRegistry } from "./role-registry.ts";

export class StageRegistry {
  readonly catalog: StageCatalog;
  readonly definitions: ReadonlyMap<string, StageDefinition>;
  readonly roles: RoleRegistry;

  constructor(catalog: StageCatalog, roles: RoleRegistry) {
    this.catalog = catalog;
    const definitions = new Map<string, StageDefinition>();
    for (const stage of catalog.stages) {
      if (definitions.has(stage.id)) {
        throw new PdlcError("DUPLICATE_STAGE", `Duplicate canonical Stage: ${stage.id}`);
      }
      for (const [index, role] of stage.roleSlots.entries()) if (!roles.has(role)) {
        throw new PdlcError("UNKNOWN_ROLE_REF", `Stage ${stage.id} references unregistered Role ${role}`, [{ code: "UNKNOWN_ROLE_REF", path: `stage:${stage.id}.roleSlots[${index}]`, message: `Role is not registered in the Role Catalog: ${role}` }]);
      }
      definitions.set(stage.id, stage);
    }
    this.definitions = definitions;
    this.roles = roles;
  }

  static async load(file: string, roles: RoleRegistry): Promise<StageRegistry> {
    const validation = validateStageCatalog(JSON.parse(await readFile(file, "utf8")) as unknown);
    if (!validation.ok) {
      throw new PdlcError("VALIDATION_FAILED", `Invalid Stage Catalog: ${file}`, validation.issues);
    }
    return new StageRegistry(validation.value, roles);
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
