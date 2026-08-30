import { join } from "node:path";
import { effectiveApplicability, type DisciplineRegistry } from "./discipline-registry.ts";
import type { IntegrationRegistry } from "./integration-registry.ts";
import type { ProjectOverlay } from "./project-overlay.ts";
import type {
  Applicability,
  ResolvedBaseline,
  ResolvedControl,
  ResolvedKnowledge,
  ResolvedStandardDefault,
  StandardDefaultEntry,
  ValidationIssue,
} from "./types.ts";

export interface DisciplineResolutionContext {
  deliveryFlow: string;
  stages: string[];
  riskTriggers?: string[];
  technologies?: string[];
  disciplines?: string[];
}

export interface ResolvedIntegration {
  ref: string;
  id: string;
  owners: string[];
  root: string;
  skills: Array<{ id: string; path: string }>;
  permissions: { network: boolean; credentialRefs: string[]; externalWrites: boolean };
}

export interface ResolvedDisciplineContext {
  controls: ResolvedControl[];
  knowledge: ResolvedKnowledge[];
  integrations: ResolvedIntegration[];
  baselines: ResolvedBaseline[];
  defaults: ResolvedStandardDefault[];
  issues: ValidationIssue[];
}

interface DefaultCandidate extends ResolvedStandardDefault {
  precedence: number;
}

export function resolveDisciplineContext(
  registry: DisciplineRegistry,
  integrations: IntegrationRegistry,
  project: ProjectOverlay,
  context: DisciplineResolutionContext,
): ResolvedDisciplineContext {
  const controls = resolveControls(registry, project, context);
  const knowledge = resolveKnowledge(registry, project, context);
  const resolvedIntegrations = resolveIntegrations(integrations, context);
  const baselines = project.baselines().map(({ discipline, baseline }) => ({
    ref: `project:${discipline}:baseline`,
    discipline,
    baseline,
  }));
  const standardResolution = resolveDefaults(registry, project, controls, knowledge, context);
  return {
    controls,
    knowledge,
    integrations: resolvedIntegrations,
    baselines,
    defaults: standardResolution.defaults,
    issues: standardResolution.issues,
  };
}

export function applicabilityMatches(appliesTo: Applicability, context: DisciplineResolutionContext): boolean {
  return matches(appliesTo.deliveryFlows, [context.deliveryFlow])
    && matches(appliesTo.stages, context.stages)
    && matches(appliesTo.riskTriggers, context.riskTriggers)
    && matches(appliesTo.technologies, context.technologies)
    && matches(appliesTo.disciplines, context.disciplines);
}

function resolveControls(
  registry: DisciplineRegistry,
  project: ProjectOverlay,
  context: DisciplineResolutionContext,
): ResolvedControl[] {
  const enterprise = registry.list().flatMap((discipline) => discipline.policies.flatMap(({ policy }) => {
    const appliesTo = effectiveApplicability(discipline.manifest, policy.appliesTo);
    if (!applicabilityMatches(appliesTo, context)) return [];
    return [{
      ref: `${policy.id}@${policy.version}`,
      ownerDiscipline: policy.ownerDiscipline,
      policy,
      matchedStages: intersections(appliesTo.stages, context.stages),
      source: "enterprise" as const,
    }];
  }));
  const projectControls = project.policies().flatMap(({ policy }) => {
    if (!applicabilityMatches(policy.appliesTo, context)) return [];
    return [{
      ref: `project:${policy.id}@${policy.version}`,
      ownerDiscipline: policy.ownerDiscipline,
      policy,
      matchedStages: intersections(policy.appliesTo.stages, context.stages),
      source: "project" as const,
    }];
  });
  return [...enterprise, ...projectControls].sort((a, b) => a.ref.localeCompare(b.ref));
}

function resolveKnowledge(registry: DisciplineRegistry, project: ProjectOverlay, context: DisciplineResolutionContext): ResolvedKnowledge[] {
  const enterprise = registry.list().flatMap((discipline) => discipline.knowledge.flatMap(({ asset, contentPath }) => {
    const appliesTo = effectiveApplicability(discipline.manifest, asset.appliesTo);
    if (!applicabilityMatches(appliesTo, context)) return [];
    return [{
      ref: `${asset.id}@${asset.version}`,
      ownerDiscipline: asset.ownerDiscipline,
      asset,
      matchedStages: intersections(appliesTo.stages, context.stages),
      source: "enterprise" as const,
      contentPath,
    }];
  }));
  const projectKnowledge = project.knowledge().flatMap(({ asset, contentPath }) => {
    if (!applicabilityMatches(asset.appliesTo, context)) return [];
    return [{
      ref: `project:${asset.id}@${asset.version}`,
      ownerDiscipline: asset.ownerDiscipline,
      asset,
      matchedStages: intersections(asset.appliesTo.stages, context.stages),
      source: "project" as const,
      contentPath,
    }];
  });
  return [...enterprise, ...projectKnowledge].sort((a, b) => a.ref.localeCompare(b.ref));
}

function resolveIntegrations(registry: IntegrationRegistry, context: DisciplineResolutionContext): ResolvedIntegration[] {
  return registry.list().flatMap(({ manifest, root }) => applicabilityMatches(manifest.appliesTo, context) ? [{
    ref: `${manifest.id}@${manifest.version}`,
    id: manifest.id,
    owners: manifest.owners,
    root,
    skills: manifest.skills.map((skill) => ({ id: skill.id, path: join(root, skill.path, "SKILL.md") })),
    permissions: manifest.permissions,
  }] : []).sort((left, right) => left.ref.localeCompare(right.ref));
}

function resolveDefaults(
  registry: DisciplineRegistry,
  project: ProjectOverlay,
  controls: ResolvedControl[],
  knowledge: ResolvedKnowledge[],
  context: DisciplineResolutionContext,
): { defaults: ResolvedStandardDefault[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const controlRuleRefs = new Set<string>();
  const candidates: DefaultCandidate[] = [];

  for (const control of controls) {
    for (const rule of control.policy.rules) {
      const ruleRef = `${control.policy.id}@${control.policy.version}#${rule.id}`;
      controlRuleRefs.add(ruleRef);
      if (!rule.standardDefault) continue;
      candidates.push({
        key: rule.standardDefault.key,
        title: control.policy.title,
        topic: rule.standardDefault.topic,
        statement: rule.statement,
        rationale: `Locked Control owned by ${control.ownerDiscipline}.`,
        sourceRef: ruleRef,
        sourceLayer: "discipline",
        locked: true,
        controlRefs: [ruleRef],
        shadowedSources: [],
        precedence: 100,
      });
    }
  }

  for (const entry of knowledge) {
    if (entry.asset.kind !== "default") continue;
    for (const item of entry.asset.defaults ?? []) {
      validateControlRefs(item, entry.ref, controlRuleRefs, issues);
      candidates.push(candidate(item, entry.ref, "discipline", 20));
    }
  }

  for (const { profile } of project.defaults()) {
    if (!applicabilityMatches(profile.appliesTo, context)) continue;
    const ref = `project:${profile.id}@${profile.version}`;
    for (const item of profile.defaults) {
      validateControlRefs(item, ref, controlRuleRefs, issues);
      candidates.push(candidate(item, ref, "project", 30));
    }
  }

  const byKey = new Map<string, DefaultCandidate[]>();
  for (const item of candidates) byKey.set(item.key, [...(byKey.get(item.key) ?? []), item]);
  const defaults: ResolvedStandardDefault[] = [];
  for (const [key, matching] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ranked = [...matching].sort((a, b) => b.precedence - a.precedence || a.sourceRef.localeCompare(b.sourceRef));
    const winner = ranked[0];
    const sameRank = ranked.filter((item) => item.precedence === winner.precedence);
    if (sameRank.some((item) => item.statement !== winner.statement)) {
      issues.push({ code: "AMBIGUOUS_DEFAULT", path: key, message: `Multiple defaults define ${key} at the same precedence` });
      continue;
    }
    if (winner.locked) {
      for (const shadowed of ranked.slice(1)) {
        if (shadowed.statement !== winner.statement) {
          issues.push({ code: "CONTROL_CONSTRAINT_OVERRIDE", path: key, message: `${shadowed.sourceRef} cannot override locked Control ${winner.sourceRef}` });
        }
      }
    }
    defaults.push({
      key: winner.key,
      title: winner.title,
      topic: winner.topic,
      statement: winner.statement,
      rationale: winner.rationale,
      sourceRef: winner.sourceRef,
      sourceLayer: winner.sourceLayer,
      locked: winner.locked,
      controlRefs: winner.controlRefs,
      shadowedSources: ranked.slice(1).map((item) => item.sourceRef),
    });
  }

  for (const baseline of project.baselines()) {
    for (const [key, value] of Object.entries(baseline.baseline.decisions)) {
      const locked = defaults.find((item) => item.key === key && item.locked);
      if (locked && String(value) !== locked.statement) {
        issues.push({
          code: "PROJECT_BASELINE_CONTROL_CONFLICT",
          path: `project:${baseline.discipline}:baseline.${key}`,
          message: `Approved Project Baseline conflicts with locked Control ${locked.sourceRef}`,
        });
      }
    }
  }
  return { defaults, issues };
}

function candidate(entry: StandardDefaultEntry, sourceRef: string, sourceLayer: "discipline" | "project", precedence: number): DefaultCandidate {
  return {
    ...entry,
    sourceRef,
    sourceLayer,
    locked: false,
    shadowedSources: [],
    precedence,
  };
}

function validateControlRefs(entry: StandardDefaultEntry, source: string, known: Set<string>, issues: ValidationIssue[]): void {
  for (const ref of entry.controlRefs) {
    if (!known.has(ref)) issues.push({ code: "UNKNOWN_CONTROL_REF", path: source, message: `Unknown or inapplicable Control reference: ${ref}` });
  }
}

function matches(required: readonly string[] | undefined, actual: readonly string[] | undefined): boolean {
  if (!required || required.length === 0) return true;
  if (!actual || actual.length === 0) return false;
  if (required.includes("*")) return true;
  const values = new Set(actual);
  return required.some((item) => values.has(item));
}

function intersections(required: readonly string[] | undefined, actual: readonly string[]): string[] {
  if (!required || required.length === 0 || required.includes("*")) return [...actual];
  const values = new Set(actual);
  return required.filter((item) => values.has(item));
}
