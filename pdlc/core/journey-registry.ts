import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PdlcError } from "./errors.ts";
import { validateJourneyDefinition } from "./schema.ts";
import type { JourneyDefinition, StageDefinition, WorkflowId } from "./types.ts";
import type { StageRegistry } from "./stage-registry.ts";

export interface ResolvedJourneyStage {
  definition: StageDefinition;
  inclusion: "required" | "conditional";
  matchedActivationTags: string[];
}

export class JourneyRegistry {
  readonly definitions: ReadonlyMap<WorkflowId, JourneyDefinition>;
  readonly stages: StageRegistry;

  constructor(definitions: JourneyDefinition[], stages: StageRegistry) {
    const byId = new Map<WorkflowId, JourneyDefinition>();
    for (const definition of definitions) {
      if (byId.has(definition.id)) {
        throw new PdlcError("DUPLICATE_JOURNEY", `Duplicate User Journey definition: ${definition.id}`);
      }
      for (const [index, stage] of definition.stageSequence.entries()) {
        if (!stages.has(stage.stageId)) {
          throw new PdlcError("UNKNOWN_STAGE_REF", `User Journey ${definition.id} references unknown Stage ${stage.stageId}`, [
            {
              code: "UNKNOWN_STAGE_REF",
              path: `$.stageSequence[${index}].stageId`,
              message: `Stage is not defined in the canonical Stage Catalog: ${stage.stageId}`,
            },
          ]);
        }
      }
      byId.set(definition.id, definition);
    }
    this.definitions = byId;
    this.stages = stages;
  }

  static async load(directory: string, stages: StageRegistry): Promise<JourneyRegistry> {
    const entries = await readdir(directory, { withFileTypes: true });
    const definitions: JourneyDefinition[] = [];
    for (const entry of entries
      .filter((item) => item.isFile() && item.name.endsWith(".json"))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const file = join(directory, entry.name);
      const validation = validateJourneyDefinition(JSON.parse(await readFile(file, "utf8")) as unknown);
      if (!validation.ok) {
        throw new PdlcError("VALIDATION_FAILED", `Invalid User Journey definition: ${file}`, validation.issues);
      }
      definitions.push(validation.value);
    }
    return new JourneyRegistry(definitions, stages);
  }

  get(id: WorkflowId): JourneyDefinition {
    const definition = this.definitions.get(id);
    if (!definition) throw new PdlcError("JOURNEY_NOT_FOUND", `User Journey not found: ${id}`);
    return definition;
  }

  list(): JourneyDefinition[] {
    return [...this.definitions.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  resolve(id: WorkflowId, activeTags: readonly string[] = []): ResolvedJourneyStage[] {
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
}
