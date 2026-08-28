import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PdlcError } from "./errors.ts";
import {
  selectApplicablePrinciples,
  type PrincipleContext,
} from "./principles.ts";
import { validateStandardProfile } from "./schema.ts";
import type {
  PrinciplePack,
  ResolvedStandardDefault,
  StandardProfile,
  ValidationIssue,
} from "./types.ts";

interface StandardCandidate extends ResolvedStandardDefault {
  precedence: number;
}

export interface StandardResolution {
  defaults: ResolvedStandardDefault[];
  issues: ValidationIssue[];
}

export interface JourneyStandardContext extends Omit<PrincipleContext, "stage"> {
  stages: string[];
}

export async function loadStandardProfiles(
  directory: string,
  expectedLayer?: StandardProfile["layer"],
): Promise<StandardProfile[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }

  const profiles: StandardProfile[] = [];
  for (const entry of entries
    .filter((item) => item.isFile() && item.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const file = join(directory, entry.name);
    const validation = validateStandardProfile(
      JSON.parse(await readFile(file, "utf8")) as unknown,
    );
    if (!validation.ok) {
      throw new PdlcError(
        "VALIDATION_FAILED",
        `Invalid Standard Profile: ${file}`,
        validation.issues,
      );
    }
    if (expectedLayer && validation.value.layer !== expectedLayer) {
      throw new PdlcError(
        "VALIDATION_FAILED",
        `Standard Profile has the wrong layer: ${file}`,
        [
          {
            code: "STANDARD_LAYER_MISMATCH",
            path: "$.layer",
            message: `Expected ${expectedLayer} but found ${validation.value.layer}`,
          },
        ],
      );
    }
    profiles.push(validation.value);
  }
  return profiles;
}

function intersects(left: readonly string[] = [], right: readonly string[] = []): boolean {
  const values = new Set(right);
  return left.some((item) => values.has(item));
}

function optionalDimensionMatches(
  required: readonly string[] | undefined,
  actual: readonly string[] | undefined,
): boolean {
  return !required || required.length === 0 || intersects(required, actual);
}

function profileApplies(profile: StandardProfile, context: PrincipleContext): boolean {
  return profile.appliesTo.workflows.includes(context.workflow)
    && profile.appliesTo.stages.includes(context.stage)
    && optionalDimensionMatches(profile.appliesTo.technologies, context.technologies)
    && optionalDimensionMatches(profile.appliesTo.domains, context.domains);
}

function enterpriseCandidates(
  packs: PrinciplePack[],
  context: PrincipleContext,
): StandardCandidate[] {
  return selectApplicablePrinciples(packs, context).flatMap(({ pack }) =>
    pack.principles.flatMap((principle) => {
      if (!principle.standardDefault) return [];
      const sourceRef = `${pack.id}@${pack.version}#${principle.id}`;
      const locked = principle.standardDefault.policy === "constraint";
      return [{
        key: principle.standardDefault.key,
        title: principle.title,
        topic: principle.standardDefault.topic,
        statement: principle.requirement,
        rationale: `Enterprise standard owned by ${pack.owner}.`,
        sourceRef,
        sourceLayer: "enterprise" as const,
        locked,
        principleRefs: [sourceRef],
        shadowedSources: [],
        precedence: locked ? 100 : 20,
      }];
    }),
  );
}

function profileCandidates(
  profiles: StandardProfile[],
  context: PrincipleContext,
  knownPrinciples: Set<string>,
  issues: ValidationIssue[],
): StandardCandidate[] {
  return profiles.flatMap((profile) => {
    if (!profileApplies(profile, context)) return [];
    const sourceRef = `${profile.layer}:${profile.id}@${profile.version}`;
    return profile.defaults.map((entry, index) => {
      for (const principleRef of entry.principleRefs) {
        if (!knownPrinciples.has(principleRef)) {
          issues.push({
            code: "UNKNOWN_PRINCIPLE_REF",
            path: `${sourceRef}.defaults[${index}].principleRefs`,
            message: `Unknown Principle reference: ${principleRef}`,
          });
        }
      }
      return {
        ...entry,
        sourceRef,
        sourceLayer: profile.layer,
        locked: false,
        shadowedSources: [],
        precedence: profile.layer === "project" ? 30 : 10,
      };
    });
  });
}

export function resolveStandardDefaults(
  packs: PrinciplePack[],
  profiles: StandardProfile[],
  context: PrincipleContext,
): StandardResolution {
  const issues: ValidationIssue[] = [];
  const knownPrinciples = new Set(
    packs.flatMap((pack) =>
      pack.principles.map((principle) => `${pack.id}@${pack.version}#${principle.id}`),
    ),
  );
  const candidates = [
    ...enterpriseCandidates(packs, context),
    ...profileCandidates(profiles, context, knownPrinciples, issues),
  ];
  const byKey = new Map<string, StandardCandidate[]>();
  for (const candidate of candidates) {
    const existing = byKey.get(candidate.key) ?? [];
    existing.push(candidate);
    byKey.set(candidate.key, existing);
  }

  const defaults: ResolvedStandardDefault[] = [];
  for (const [key, matching] of [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const ranked = [...matching].sort((left, right) =>
      right.precedence - left.precedence || left.sourceRef.localeCompare(right.sourceRef),
    );
    const winner = ranked[0];
    const sameRank = ranked.filter((candidate) => candidate.precedence === winner.precedence);
    if (sameRank.some((candidate) => candidate.statement !== winner.statement)) {
      issues.push({
        code: "AMBIGUOUS_STANDARD_DEFAULT",
        path: key,
        message: `Multiple ${winner.sourceLayer} standards define ${key} at the same precedence`,
      });
      continue;
    }

    if (winner.locked) {
      for (const candidate of ranked.slice(1)) {
        if (candidate.statement !== winner.statement) {
          issues.push({
            code: "STANDARD_CONSTRAINT_OVERRIDE",
            path: key,
            message: `${candidate.sourceRef} cannot override locked enterprise constraint ${winner.sourceRef}`,
          });
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
      principleRefs: winner.principleRefs,
      shadowedSources: ranked.slice(1).map((candidate) => candidate.sourceRef),
    });
  }

  return {
    defaults: defaults.sort((left, right) =>
      left.topic.localeCompare(right.topic) || left.key.localeCompare(right.key),
    ),
    issues,
  };
}

export function resolveStandardDefaultsForStages(
  packs: PrinciplePack[],
  profiles: StandardProfile[],
  context: JourneyStandardContext,
): StandardResolution {
  const aggregateStage = "__resolved-journey__";
  const { stages, ...sharedContext } = context;
  const scopedPacks = packs
    .filter((pack) => intersects(pack.appliesTo.stages, stages))
    .map((pack) => ({
      ...pack,
      appliesTo: { ...pack.appliesTo, stages: [aggregateStage] },
    }));
  const scopedProfiles = profiles
    .filter((profile) => intersects(profile.appliesTo.stages, stages))
    .map((profile) => ({
      ...profile,
      appliesTo: { ...profile.appliesTo, stages: [aggregateStage] },
    }));
  return resolveStandardDefaults(scopedPacks, scopedProfiles, {
    ...sharedContext,
    stage: aggregateStage,
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
