import { join } from "node:path";
import { createStageContextSnapshot, validateReceiptAgainstSnapshot, type StageContextSnapshot } from "./context-receipt.ts";
import { DeliveryFlowRegistry } from "./delivery-flow-registry.ts";
import { resolveDomainGuidance } from "./domain-guidance.ts";
import { DomainRegistry } from "./domain-registry.ts";
import { resolveDomainContext } from "./domain-resolver.ts";
import { PdlcError } from "./errors.ts";
import { IntegrationRegistry } from "./integration-registry.ts";
import { ProjectOverlay } from "./project-overlay.ts";
import { RoleRegistry, type ResolvedRole } from "./role-registry.ts";
import { StageRegistry } from "./stage-registry.ts";
import type { DomainGuidanceResolution, PocDeliveryRecord, ValidationIssue } from "./types.ts";

export interface HarnessModel {
  roles: RoleRegistry;
  stages: StageRegistry;
  deliveryFlows: DeliveryFlowRegistry;
  domains: DomainRegistry;
  integrations: IntegrationRegistry;
  project: ProjectOverlay;
}

export interface ResolvedStageMaterial {
  deliveryFlow: string;
  stage: ReturnType<StageRegistry["get"]>;
  resolved: ReturnType<typeof resolveDomainContext>;
  domainGuidance: DomainGuidanceResolution;
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
    const domainsPromise = DomainRegistry.load(join(harnessRoot, ".pdlc", "domains"));
    const integrationsPromise = IntegrationRegistry.load(join(harnessRoot, ".pdlc", "integrations", "catalog.json"));

    const roles = await rolesPromise;
    const stagesPromise = StageRegistry.load(join(harnessRoot, ".pdlc", "stages", "catalog.json"), roles);
    const domains = await domainsPromise;
    const projectPromise = ProjectOverlay.load(projectRoot, new Set(domains.list().map(({ manifest }) => manifest.id)));
    const [stages, integrations, project] = await Promise.all([stagesPromise, integrationsPromise, projectPromise]);
    const deliveryFlows = await DeliveryFlowRegistry.load(join(harnessRoot, ".pdlc", "delivery-flows", "catalog.json"), stages);
    return new HarnessContext(harnessRoot, projectRoot, { roles, stages, deliveryFlows, domains, integrations, project });
  }

  static async loadDomainView(harnessRoot: string): Promise<{ stages: StageRegistry; domains: DomainRegistry }> {
    const rolesPromise = RoleRegistry.load(join(harnessRoot, ".pdlc", "roles", "catalog.json"));
    const domainsPromise = DomainRegistry.load(join(harnessRoot, ".pdlc", "domains"));
    const [roles, domains] = await Promise.all([rolesPromise, domainsPromise]);
    const stages = await StageRegistry.load(join(harnessRoot, ".pdlc", "stages", "catalog.json"), roles);
    return { stages, domains };
  }

  static loadIntegrationView(harnessRoot: string): Promise<IntegrationRegistry> {
    return IntegrationRegistry.load(join(harnessRoot, ".pdlc", "integrations", "catalog.json"));
  }

  async resolveStage(stageId: string, record?: PocDeliveryRecord): Promise<ResolvedStageMaterial> {
    const { roles, stages, deliveryFlows, domains, integrations, project } = this.model;
    const stage = stages.get(stageId);
    const stageRoles = stage.roleSlots.map((role) => roles.get(role));
    const deliveryFlow = record?.deliveryFlow ?? "poc";
    const deliveryFlowDefinition = deliveryFlows.getExecutable(deliveryFlow);
    const riskTriggers = record?.risk.triggers ?? [];
    const technologies = record?.design.technologies ?? [];
    const selectedDomains = record?.design.domains ?? [];
    const resolved = resolveDomainContext(domains, integrations, project, {
      deliveryFlow,
      stages: [stageId],
      riskTriggers,
      technologies,
      domains: selectedDomains,
    });
    if (resolved.issues.length > 0) {
      throw new PdlcError("CONTEXT_RESOLUTION_FAILED", `Cannot resolve context for Stage ${stageId}`, resolved.issues);
    }
    const domainGuidance = await resolveDomainGuidance(stages, domains, this.harnessRoot, stageId, deliveryFlow);
    const snapshot = await createStageContextSnapshot({
      harnessRoot: this.harnessRoot,
      projectRoot: this.projectRoot,
      deliveryFlow,
      deliveryFlowDefinition,
      riskTriggers,
      technologies,
      domains: selectedDomains,
      stage: stageId,
      stageDefinition: stage,
      roles: stageRoles,
      controls: resolved.controls,
      baselines: resolved.baselines,
      defaults: resolved.defaults,
      knowledge: resolved.knowledge,
      project,
      domainGuidance,
      integrations: resolved.integrations,
    });
    return { deliveryFlow, stage, resolved, domainGuidance, snapshot, project, roles: stageRoles };
  }

  async contextIssues(record: PocDeliveryRecord, stages: string[]): Promise<ValidationIssue[]> {
    const uniqueStages = [...new Set(stages)];
    const materials = await Promise.all(uniqueStages.map((stageId) => this.resolveStage(stageId, record)));
    const applications = new Map(record.resolution.contextApplications.map((entry) => [entry.stage, entry]));
    return uniqueStages.flatMap((stage, index) => {
      const application = applications.get(stage);
      if (!application) return [{ code: "STAGE_CONTEXT_APPLICATION_MISSING", path: "$.resolution.contextApplications", message: `Stage context has not been applied: ${stage}` }];
      return validateReceiptAgainstSnapshot(application, materials[index]!.snapshot).map((issue) => issue.code === "STALE_CONTEXT_RECEIPT"
        ? { code: "STALE_STAGE_CONTEXT_APPLICATION", path: `$.resolution.contextApplications.${stage}.contextHash`, message: `Resolved assets or activation inputs changed after the Stage context was applied: ${stage}` }
        : { ...issue, path: `$.resolution.contextApplications.${stage}${issue.path.slice(1)}` });
    });
  }
}
