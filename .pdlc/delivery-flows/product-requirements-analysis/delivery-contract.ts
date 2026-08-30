import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { sha256 } from "../../core/hash.ts";
import type { ValidationIssue } from "../../core/types.ts";
import type { RequirementsAnalysisRecord, StorySnapshot } from "./types.ts";

export interface DeliveryContract {
  upstreamRecordId: string;
  sourceRevision: string;
  scopeHash: string;
  stories: Array<Pick<StorySnapshot, "localId" | "revision" | "contentHash">>;
}

export interface DeliveryContractAssessment {
  ok: boolean;
  contract?: DeliveryContract;
  issues: ValidationIssue[];
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}

function workspacePath(workspaceRoot: string, ref: string): string | undefined {
  if (!ref || isAbsolute(ref)) return undefined;
  const path = resolve(workspaceRoot, ref);
  const location = relative(resolve(workspaceRoot), path);
  if (location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) return undefined;
  return path;
}

async function readableRegularFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); }
  catch { return false; }
}

/** Verifies the immutable handoff consumed by development or QA. */
export async function assessDeliveryContract(
  workspaceRoot: string,
  upstream: RequirementsAnalysisRecord,
  selectedStoryIds: string[],
): Promise<DeliveryContractAssessment> {
  const issues: ValidationIssue[] = [];
  if (upstream.status !== "SCOPED") issues.push(issue("UPSTREAM_NOT_SCOPED", "$.status", "The upstream requirements analysis must be SCOPED"));
  if (!upstream.source.deliveredRevision) issues.push(issue("SOURCE_REVISION_MISSING", "$.source.deliveredRevision", "The scoped handoff must be bound to a Git revision"));

  const selected = [...new Set(selectedStoryIds)];
  if (selected.length === 0) issues.push(issue("STORY_SELECTION_EMPTY", "$.scope.storyIds", "Select at least one Story from the approved Sprint Scope"));
  const scoped = new Set(upstream.scope.storyIds);
  const stories = new Map(upstream.stories.map((story) => [story.localId, story]));
  selected.forEach((storyId, index) => {
    if (!scoped.has(storyId)) issues.push(issue("STORY_OUTSIDE_SCOPE", `$.selectedStoryIds[${index}]`, `${storyId} is not in the approved Sprint Scope`));
    if (!stories.has(storyId)) issues.push(issue("STORY_UNKNOWN", `$.selectedStoryIds[${index}]`, `${storyId} has no Story snapshot`));
  });

  for (const storyId of selected) {
    const story = stories.get(storyId);
    if (!story) continue;
    const path = workspacePath(workspaceRoot, story.artifactRef);
    if (!path || !await readableRegularFile(path)) {
      issues.push(issue("STORY_ARTIFACT_UNREADABLE", `$.stories.${storyId}.artifactRef`, `Story artifact is not a readable file inside the workspace: ${story.artifactRef}`));
      continue;
    }
    const actualHash = sha256(await readFile(path, "utf8"));
    if (actualHash !== story.contentHash) issues.push(issue("STORY_CONTENT_CHANGED", `$.stories.${storyId}.contentHash`, `Story content no longer matches its approved hash`));
  }

  const scopePath = workspacePath(workspaceRoot, upstream.scope.documentRef);
  if (!scopePath || !await readableRegularFile(scopePath)) {
    issues.push(issue("SPRINT_SCOPE_UNREADABLE", "$.scope.documentRef", `Sprint Scope is not a readable file inside the workspace: ${upstream.scope.documentRef}`));
  } else if (sha256(await readFile(scopePath, "utf8")) !== upstream.scope.scopeHash) {
    issues.push(issue("SPRINT_SCOPE_CHANGED", "$.scope.scopeHash", "Sprint Scope content no longer matches its approved hash"));
  }

  for (const storyId of selected) {
    const story = stories.get(storyId);
    if (!story) continue;
    story.dependencies.forEach((dependency) => {
      if (!scoped.has(dependency)) issues.push(issue("DEPENDENCY_OUTSIDE_SCOPE", `$.stories.${storyId}.dependencies`, `${dependency} is not included in the approved Sprint Scope`));
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    issues: [],
    contract: {
      upstreamRecordId: upstream.id,
      sourceRevision: upstream.source.deliveredRevision,
      scopeHash: upstream.scope.scopeHash,
      stories: selected.map((storyId) => {
        const story = stories.get(storyId)!;
        return { localId: story.localId, revision: story.revision, contentHash: story.contentHash };
      }),
    },
  };
}

/** Returns whether an already-started downstream delivery must rebase after scope evolution. */
export function assessContractChange(previous: DeliveryContract, current: DeliveryContract): DeliveryContractAssessment {
  const issues: ValidationIssue[] = [];
  if (previous.upstreamRecordId !== current.upstreamRecordId) issues.push(issue("UPSTREAM_RECORD_CHANGED", "$.upstreamRecordId", "The upstream Delivery Record changed"));
  const currentStories = new Map(current.stories.map((story) => [story.localId, story]));
  previous.stories.forEach((story) => {
    const next = currentStories.get(story.localId);
    if (!next) issues.push(issue("SELECTED_STORY_REMOVED", `$.stories.${story.localId}`, "A selected Story was removed from scope"));
    else if (next.revision !== story.revision || next.contentHash !== story.contentHash) issues.push(issue("SELECTED_STORY_CHANGED", `$.stories.${story.localId}`, "A selected Story changed and must be explicitly rebased"));
  });
  if (issues.length === 0 && previous.scopeHash !== current.scopeHash) issues.push(issue("SCOPE_ACKNOWLEDGEMENT_REQUIRED", "$.scopeHash", "Only unrelated Sprint Scope content changed; acknowledge the new scope version before continuing"));
  return { ok: issues.length === 0, contract: current, issues };
}
