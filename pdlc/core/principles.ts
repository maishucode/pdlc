import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PdlcError } from "./errors.ts";
import { validatePrinciplePack } from "./schema.ts";
import type { PrinciplePack, WorkflowId } from "./types.ts";

export interface PrincipleContext {
  workflow: WorkflowId;
  stage: string;
  riskTriggers?: string[];
  technologies?: string[];
  domains?: string[];
}

export interface ApplicablePrinciplePack {
  pack: PrinciplePack;
  effectiveEnforcement: "required" | "advisory";
  matchedRiskTriggers: string[];
}

export interface JourneyPrincipleContext extends Omit<PrincipleContext, "stage"> {
  stages: string[];
}

export interface JourneyApplicablePrinciplePack extends ApplicablePrinciplePack {
  matchedStages: string[];
}

export async function loadPrinciplePacks(directory: string): Promise<PrinciplePack[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const packs: PrinciplePack[] = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(directory, entry.name, "pack.json");
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      throw error;
    }
    const validation = validatePrinciplePack(JSON.parse(raw) as unknown);
    if (!validation.ok) {
      throw new PdlcError("VALIDATION_FAILED", `Invalid Principle Pack: ${file}`, validation.issues);
    }
    packs.push(validation.value);
  }
  return packs;
}

function intersects(left: readonly string[] = [], right: readonly string[] = []): string[] {
  const rightValues = new Set(right);
  return left.filter((item) => rightValues.has(item));
}

function optionalDimensionMatches(required: readonly string[] | undefined, actual: readonly string[] | undefined): boolean {
  return !required || required.length === 0 || intersects(required, actual).length > 0;
}

export function selectApplicablePrinciples(
  packs: PrinciplePack[],
  context: PrincipleContext,
): ApplicablePrinciplePack[] {
  return packs.flatMap((pack) => {
    if (!pack.appliesTo.workflows.includes(context.workflow)) return [];
    if (!pack.appliesTo.stages.includes(context.stage)) return [];
    if (!optionalDimensionMatches(pack.appliesTo.technologies, context.technologies)) return [];
    if (!optionalDimensionMatches(pack.appliesTo.domains, context.domains)) return [];

    const configured = pack.enforcement[context.workflow];
    if (configured === "not-applicable") return [];
    const matchedRiskTriggers = intersects(pack.appliesTo.riskTriggers, context.riskTriggers);
    const effectiveEnforcement = configured === "required" || (configured === "risk-based" && matchedRiskTriggers.length > 0)
      ? "required"
      : "advisory";
    return [{ pack, effectiveEnforcement, matchedRiskTriggers }];
  });
}

export function selectApplicablePrinciplesForStages(
  packs: PrinciplePack[],
  context: JourneyPrincipleContext,
): JourneyApplicablePrinciplePack[] {
  const byPack = new Map<string, JourneyApplicablePrinciplePack>();
  const { stages, ...sharedContext } = context;
  for (const stage of stages) {
    for (const selected of selectApplicablePrinciples(packs, { ...sharedContext, stage })) {
      const key = `${selected.pack.id}@${selected.pack.version}`;
      const existing = byPack.get(key);
      if (!existing) {
        byPack.set(key, { ...selected, matchedStages: [stage] });
        continue;
      }
      existing.matchedStages.push(stage);
      existing.matchedRiskTriggers = [...new Set([
        ...existing.matchedRiskTriggers,
        ...selected.matchedRiskTriggers,
      ])];
      if (selected.effectiveEnforcement === "required") existing.effectiveEnforcement = "required";
    }
  }
  return [...byPack.values()].sort((left, right) => left.pack.id.localeCompare(right.pack.id));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
