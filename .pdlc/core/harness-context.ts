import { join } from "node:path";
import { createStageContextSnapshot, type StageContextSnapshot } from "./context-receipt.ts";
import { DeliveryFlowRegistry } from "./delivery-flow-registry.ts";
import { resolveDisciplineGuidance } from "./discipline-guidance.ts";
import { DisciplineRegistry } from "./discipline-registry.ts";
import { resolveDisciplineContext } from "./discipline-resolver.ts";
import { PdlcError } from "./errors.ts";
import { IntegrationRegistry } from "./integration-registry.ts";
import { ProjectOverlay } from "./project-overlay.ts";
import { RoleRegistry, type ResolvedRole } from "./role-registry.ts";
import { StageRegistry } from "./stage-registry.ts";
import type { ContextualDeliveryRecord, DisciplineGuidanceResolution, ValidationIssue } from "./types.ts";

export interface HarnessModel {
  roles: RoleRegistry;
  stages: StageRegistry;
  deliveryFlows: DeliveryFlowRegistry;
  disciplines: DisciplineRegistry;
  integrations: IntegrationRegistry;
  project: ProjectOverlay;
}

export interface ResolvedStageMaterial {
  deliveryFlow: string;
  stage: ReturnType<StageRegistry["get"]>;
  resolved: ReturnType<typeof resolveDisciplineContext>;
  disciplineGuidance: DisciplineGuidanceResolution;
  snapshot: StageContextSnapshot;
  project: ProjectOverlay;
  roles: ResolvedRole[];
}

/** A command-scoped, immutable view of the Harness and project overlay. */
export class HarnessContext {
  private constructor(
    readonly harnessRoot: string,
    readonly projectRoot: string,
    readonly model: HarnessModel,
  ) {}

  static async load(harnessRoot: string, projectRoot: string): Promise<HarnessContext> {
    const rolesPromise = RoleRegistry.load(join(harnessRoot, ".pdlc", "roles", "catalog.json"));
    const disciplinesPromise = DisciplineRegistry.load(join(harnessRoot, ".pdlc", "disciplines"));
    const integrationsPromise = IntegrationRegistry.load(join(harnessRoot, ".pdlc", "integrations", "catalog.json"));

    const roles = await rolesPromise;
    const stagesPromise = StageRegistry.load(join(harnessRoot, ".pdlc", "stages", "catalog.json"), roles);
    const disciplines = await disciplinesPromise;
    const projectPromise = ProjectOverlay.load(projectRoot, new Set(disciplines.list().map(({ manifest }) => manifest.id)));
    const [stages, integrations, project] = await Promise.all([stagesPromise, integrationsPromise, projectPromise]);
    const deliveryFlows = await DeliveryFlowRegistry.load(join(harnessRoot, ".pdlc", "delivery-flows", "catalog.json"), stages);
    return new HarnessContext(harnessRoot, projectRoot, { roles, stages, deliveryFlows, disciplines, integrations, project });
  }

  static async loadDisciplineView(harnessRoot: string): Promise<{ stages: StageRegistry; disciplines: DisciplineRegistry }> {
    const rolesPromise = RoleRegistry.load(join(harnessRoot, ".pdlc", "roles", "catalog.json"));
    const disciplinesPromise = DisciplineRegistry.load(join(harnessRoot, ".pdlc", "disciplines"));
    const [roles, disciplines] = await Promise.all([rolesPromise, disciplinesPromise]);
    const stages = await StageRegistry.load(join(harnessRoot, ".pdlc", "stages", "catalog.json"), roles);
    return { stages, disciplines };
  }

  static loadIntegrationView(harnessRoot: string): Promise<IntegrationRegistry> {
    return IntegrationRegistry.load(join(harnessRoot, ".pdlc", "integrations", "catalog.json"));
  }

  async resolveStage(stageId: string, record?: ContextualDeliveryRecord): Promise<ResolvedStageMaterial> {
    const { roles, stages, deliveryFlows, disciplines, integrations, project } = this.model;
    const stage = stages.get(stageId);
    const stageRoles = stage.roleSlots.map((role) => roles.get(role));
    const deliveryFlow = record?.deliveryFlow ?? "poc";
    const deliveryFlowDefinition = deliveryFlows.getExecutable(deliveryFlow);
    const riskTriggers = record?.risk.triggers ?? [];
    const technologies = record?.design.technologies ?? [];
    const selectedDisciplines = record?.design.disciplines ?? [];
    const resolved = resolveDisciplineContext(disciplines, integrations, project, {
      deliveryFlow,
      stages: [stageId],
      riskTriggers,
      technologies,
      disciplines: selectedDisciplines,
    });
    if (resolved.issues.length > 0) {
      throw new PdlcError("CONTEXT_RESOLUTION_FAILED", `Cannot resolve context for Stage ${stageId}`, resolved.issues);
    }
    const disciplineGuidance = await resolveDisciplineGuidance(stages, disciplines, this.harnessRoot, stageId, deliveryFlow);
    const snapshot = await createStageContextSnapshot({
      harnessRoot: this.harnessRoot,
      deliveryFlow,
      deliveryFlowDefinition,
      riskTriggers,
      technologies,
      disciplines: selectedDisciplines,
      stage: stageId,
      stageDefinition: stage,
      roles: stageRoles,
      controls: resolved.controls,
      baselines: resolved.baselines,
      defaults: resolved.defaults,
      knowledge: resolved.knowledge,
      disciplineGuidance,
      integrations: resolved.integrations,
    });
    return { deliveryFlow, stage, resolved, disciplineGuidance, snapshot, project, roles: stageRoles };
  }

  async contextIssues(record: ContextualDeliveryRecord, stages: string[]): Promise<ValidationIssue[]> {
    const uniqueStages = [...new Set(stages)];
    const materials = await Promise.all(uniqueStages.map((stageId) => this.resolveStage(stageId, record)));
    const applications = new Map(record.resolution.contextApplications.map((entry) => [entry.stage, entry]));
    return uniqueStages.flatMap((stage, index) => {
      const application = applications.get(stage);
      if (!application) return [{ code: "STAGE_CONTEXT_APPLICATION_MISSING", path: "$.resolution.contextApplications", message: `Stage context has not been applied: ${stage}` }];
      return application.contextHash !== materials[index]!.snapshot.contextHash
        ? [{ code: "STALE_STAGE_CONTEXT_APPLICATION", path: `$.resolution.contextApplications.${stage}.contextHash`, message: `Resolved assets or activation inputs changed after the Stage context was applied: ${stage}` }]
        : [];
    });
  }
}
