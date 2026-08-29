import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PdlcError } from "./errors.ts";
import { validateDeliveryFlowCatalog, validateDeliveryFlowDefinition } from "./schema.ts";
import type {
  DeliveryFlowCatalog,
  DeliveryFlowDefinition,
  DeliveryFlowId,
  ExecutableDeliveryFlowDefinition,
  StageDefinition,
} from "./types.ts";
import type { StageRegistry } from "./stage-registry.ts";

export interface ResolvedDeliveryFlowStage {
  definition: StageDefinition;
  inclusion: "required" | "conditional";
  matchedActivationTags: string[];
}

export class DeliveryFlowRegistry {
  readonly catalog: DeliveryFlowCatalog;
  readonly definitions: ReadonlyMap<DeliveryFlowId, DeliveryFlowDefinition>;
  readonly stages: StageRegistry;

  constructor(catalog: DeliveryFlowCatalog, definitions: DeliveryFlowDefinition[], stages: StageRegistry) {
    const byId = new Map<DeliveryFlowId, DeliveryFlowDefinition>();
    for (const definition of definitions) {
      if (byId.has(definition.id)) {
        throw new PdlcError("DUPLICATE_DELIVERY_FLOW", `Duplicate Delivery Flow definition: ${definition.id}`);
      }
      for (const [index, stage] of definition.stageSequence.entries()) {
        if (!stages.has(stage.stageId)) {
          throw new PdlcError("UNKNOWN_STAGE_REF", `Delivery Flow ${definition.id} references unknown Stage ${stage.stageId}`, [
            {
              code: "UNKNOWN_STAGE_REF",
              path: `$.stageSequence[${index}].stageId`,
              message: `Stage is not defined in the canonical Stage Catalog: ${stage.stageId}`,
            },
          ]);
        }
      }
      for (const [index, checkpoint] of (definition.controls?.checkpoints ?? []).entries()) if (!stages.roles.has(checkpoint.ownerRole)) {
        throw new PdlcError("UNKNOWN_ROLE_REF", `Delivery Flow ${definition.id} checkpoint ${checkpoint.id} references unregistered Role ${checkpoint.ownerRole}`, [{ code: "UNKNOWN_ROLE_REF", path: `$.controls.checkpoints[${index}].ownerRole`, message: `Role is not registered in the Role Catalog: ${checkpoint.ownerRole}` }]);
      }
      byId.set(definition.id, definition);
    }
    this.catalog = catalog;
    this.definitions = byId;
    this.stages = stages;
  }

  static async load(catalogFile: string, stages: StageRegistry): Promise<DeliveryFlowRegistry> {
    const catalogValidation = validateDeliveryFlowCatalog(JSON.parse(await readFile(catalogFile, "utf8")) as unknown);
    if (!catalogValidation.ok) {
      throw new PdlcError("VALIDATION_FAILED", `Invalid Delivery Flow Catalog: ${catalogFile}`, catalogValidation.issues);
    }
    const catalog = catalogValidation.value;
    const definitions: DeliveryFlowDefinition[] = [];
    for (const [index, entry] of catalog.flows.entries()) {
      const file = resolve(dirname(catalogFile), entry.definition);
      const validation = validateDeliveryFlowDefinition(JSON.parse(await readFile(file, "utf8")) as unknown);
      if (!validation.ok) {
        throw new PdlcError("VALIDATION_FAILED", `Invalid Delivery Flow definition: ${file}`, validation.issues);
      }
      if (validation.value.id !== entry.id) {
        throw new PdlcError("DELIVERY_FLOW_ID_MISMATCH", `Delivery Flow Catalog entry ${entry.id} points to ${validation.value.id}`, [
          {
            code: "DELIVERY_FLOW_ID_MISMATCH",
            path: `$.flows[${index}]`,
            message: `Catalog id ${entry.id} must match definition id ${validation.value.id}`,
          },
        ]);
      }
      definitions.push(validation.value);
    }
    return new DeliveryFlowRegistry(catalog, definitions, stages);
  }

  get(id: DeliveryFlowId): DeliveryFlowDefinition {
    const definition = this.definitions.get(id);
    if (!definition) throw new PdlcError("DELIVERY_FLOW_NOT_FOUND", `Delivery Flow not found: ${id}`);
    return definition;
  }

  getExecutable(id: DeliveryFlowId): ExecutableDeliveryFlowDefinition {
    const definition = this.get(id);
    if (definition.status !== "active" || !definition.controls) {
      throw new PdlcError("DELIVERY_FLOW_NOT_EXECUTABLE", `Delivery Flow is planned but not executable: ${id}`);
    }
    return definition as ExecutableDeliveryFlowDefinition;
  }

  list(): DeliveryFlowDefinition[] {
    return [...this.definitions.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  resolve(id: DeliveryFlowId, activeTags: readonly string[] = []): ResolvedDeliveryFlowStage[] {
    const tags = new Set(activeTags);
    return this.get(id).stageSequence.flatMap((reference) => {
      const matchedActivationTags = (reference.activationTags ?? []).filter((tag) => tags.has(tag));
      if (reference.inclusion === "conditional" && matchedActivationTags.length === 0) return [];
      return [{
        definition: this.stages.get(reference.stageId),
        inclusion: reference.inclusion,
        matchedActivationTags,
      }];
    });
  }

  requiredRoles(id: DeliveryFlowId, activeTags: readonly string[] = []): string[] {
    const flow = this.get(id);
    const roles = new Set(this.resolve(id, activeTags).flatMap(({ definition }) => definition.roleSlots));
    for (const checkpoint of flow.controls?.checkpoints ?? []) roles.add(checkpoint.ownerRole);
    return [...roles].sort();
  }
}
