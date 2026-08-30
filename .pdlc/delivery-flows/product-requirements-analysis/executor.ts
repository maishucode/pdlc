import { access, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { persistRecordAndAudit } from "../../core/controlled-mutation.ts";
import { resolveDisciplineContext } from "../../core/discipline-resolver.ts";
import { PdlcError } from "../../core/errors.ts";
import { checkpointFor } from "../../core/flow-guard.ts";
import type { DeliveryFlowExecutor, FlowExecutionContext, FlowRunnerOptions } from "../../core/flow-executor.ts";
import { genericAuditSummary } from "../../core/flow-executor.ts";
import { HarnessContext } from "../../core/harness-context.ts";
import { sha256 } from "../../core/hash.ts";
import { contextTags } from "../../core/poc-progress.ts";
import { inspectGitSource } from "../../core/source-integrity.ts";
import { FileStateStore } from "../../core/state.ts";
import type { BaseDeliveryRecord, ValidationIssue } from "../../core/types.ts";
import { validateRequirementsAnalysisRecord } from "./record-validator.ts";
import type { DeliveryChange, RequirementsAnalysisRecord, SprintScopeBinding, StorySnapshot } from "./types.ts";

type RunnerOptions = FlowRunnerOptions;

function issue(code: string, path: string, message: string): ValidationIssue { return { code, path, message }; }

function workspacePath(root: string, ref: string): string | undefined {
  if (!ref || isAbsolute(ref)) return undefined;
  const path = resolve(root, ref);
  const location = relative(resolve(root), path);
  return location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location) ? undefined : path;
}

async function contentHash(root: string, ref: string, path: string): Promise<string> {
  const file = workspacePath(root, ref);
  if (!file) throw new PdlcError("CHECKPOINT_NOT_READY", "Artifact reference is outside the workspace", [issue("UNSAFE_ARTIFACT_REF", path, ref)]);
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a regular file");
    return sha256(await readFile(file, "utf8"));
  } catch (error) {
    throw new PdlcError("CHECKPOINT_NOT_READY", "Artifact is not readable", [issue("ARTIFACT_UNREADABLE", path, `${ref}: ${error instanceof Error ? error.message : String(error)}`)]);
  }
}

async function validateStories(root: string, stories: StorySnapshot[]): Promise<ValidationIssue[]> {
  const ids = new Set(stories.map(({ localId }) => localId));
  const issues: ValidationIssue[] = [];
  for (const story of stories) {
    const actual = await contentHash(root, story.artifactRef, `$.stories.${story.localId}.artifactRef`);
    if (actual !== story.contentHash) issues.push(issue("STORY_CONTENT_HASH_MISMATCH", `$.stories.${story.localId}.contentHash`, "Story snapshot does not match its artifact"));
    story.dependencies.forEach((dependency) => {
      if (!ids.has(dependency)) issues.push(issue("STORY_DEPENDENCY_UNKNOWN", `$.stories.${story.localId}.dependencies`, `Unknown dependency: ${dependency}`));
    });
  }
  return issues;
}

async function validateScopeDocument(root: string, record: RequirementsAnalysisRecord): Promise<ValidationIssue[]> {
  const file = workspacePath(root, record.scope.documentRef);
  if (!file) return [issue("UNSAFE_ARTIFACT_REF", "$.scope.documentRef", record.scope.documentRef)];
  let document: Record<string, unknown>;
  try { document = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>; }
  catch (error) { return [issue("SPRINT_SCOPE_INVALID", "$.scope.documentRef", error instanceof Error ? error.message : String(error))]; }
  const issues: ValidationIssue[] = [];
  if (document.artifactType !== "product-management.sprint-scope") issues.push(issue("SPRINT_SCOPE_TYPE_MISMATCH", "$.scope.documentRef", "Expected product-management.sprint-scope"));
  if (document.version !== record.scope.version) issues.push(issue("SPRINT_SCOPE_VERSION_MISMATCH", "$.scope.version", "Document and Record versions differ"));
  if (document.previousScopeHash !== record.scope.previousScopeHash) issues.push(issue("SPRINT_SCOPE_LINEAGE_MISMATCH", "$.scope.previousScopeHash", "Document and Record previous Scope hashes differ"));
  if (document.epicRef !== record.scope.epicRef) issues.push(issue("SPRINT_SCOPE_EPIC_MISMATCH", "$.scope.epicRef", "Document and Record Epic references differ"));
  const sprint = document.sprint as Record<string, unknown> | undefined;
  if (!sprint || sprint.id !== record.scope.sprint.id || sprint.name !== record.scope.sprint.name || sprint.capturedAt !== record.scope.sprint.capturedAt) issues.push(issue("SPRINT_SCOPE_SPRINT_MISMATCH", "$.scope.sprint", "Document and Record Sprint snapshots differ"));
  const entries = Array.isArray(document.stories) ? document.stories as Array<Record<string, unknown>> : [];
  const snapshots = new Map(record.stories.map((story) => [story.localId, story]));
  const documentIds = entries.map(({ localId }) => String(localId));
  if (JSON.stringify([...documentIds].sort()) !== JSON.stringify([...record.scope.storyIds].sort())) issues.push(issue("SPRINT_SCOPE_STORY_SET_MISMATCH", "$.scope.storyIds", "Document and Record Story selections differ"));
  entries.forEach((entry, index) => {
    const snapshot = snapshots.get(String(entry.localId));
    if (!snapshot || entry.artifactRef !== snapshot.artifactRef || entry.externalKey !== snapshot.externalKey || entry.revision !== snapshot.revision || entry.contentHash !== snapshot.contentHash) issues.push(issue("SPRINT_SCOPE_STORY_BINDING_MISMATCH", `$.scope.stories[${index}]`, "Sprint Scope must reproduce the approved Story snapshot exactly"));
  });
  return issues;
}

export async function requirementsAnalysisCheckpoint(
  context: FlowExecutionContext,
  options: RunnerOptions,
  checkpointId: string,
  original: RequirementsAnalysisRecord,
): Promise<unknown> {
  const actor = options.actor?.trim();
  if (!actor) throw new PdlcError("INVALID_ARGUMENT", `Checkpoint '${checkpointId}' requires --actor <identity>`);
  const harness = context.harness;
  const flow = context.flow;
  const tags = contextTags(original);
  const activeStages = harness.model.deliveryFlows.resolve(original.deliveryFlow, tags).map(({ definition }) => definition.id);
  const resolved = resolveDisciplineContext(harness.model.disciplines, harness.model.integrations, harness.model.project, {
    deliveryFlow: original.deliveryFlow,
    stages: activeStages,
    riskTriggers: original.risk.triggers,
    technologies: original.design.technologies,
    disciplines: original.design.disciplines,
  });
  if (resolved.issues.length > 0) throw new PdlcError("CHECKPOINT_NOT_READY", "Discipline context contains unresolved conflicts", resolved.issues);
  const checkpoint = checkpointFor(flow, checkpointId);
  if (!checkpoint.from.includes(original.status) || !checkpoint.to) throw new PdlcError("INVALID_ARGUMENT", `Checkpoint '${checkpointId}' cannot transition a record in status ${original.status}`);
  const assigned = original.assignments[checkpoint.ownerRole];
  if (checkpointId !== "requirements-approve" && assigned !== actor) throw new PdlcError("INVALID_ARGUMENT", `Checkpoint '${checkpointId}' must be performed by the assigned ${checkpoint.ownerRole} role`);
  if (checkpointId === "requirements-approve" && assigned && assigned !== actor) throw new PdlcError("INVALID_ARGUMENT", `Checkpoint '${checkpointId}' must be performed by the assigned ${checkpoint.ownerRole} role`);
  const contextStages = checkpointId === "requirements-approve"
    ? ["requirements-clarification", "requirements-analysis", "acceptance-criteria-definition", "data-integration-boundaries", "risk-classification", "requirements-approval"]
    : checkpointId === "work-items-ready"
      ? ["work-item-planning"]
      : checkpointId === "scope-approve"
        ? ["delivery-planning"]
        : ["requirements-analysis"];
  const contextIssues = await harness.contextIssues(original, contextStages);
  if (contextIssues.length > 0) throw new PdlcError("CHECKPOINT_NOT_READY", "Required Stage context is missing or stale", contextIssues);
  if (original.requirements.status === "approved") {
    const currentRequirementsHash = await contentHash(options.root, original.requirements.documentRef, "$.requirements.documentRef");
    if (currentRequirementsHash !== original.requirements.approvedContentHash) throw new PdlcError("CHECKPOINT_NOT_READY", "Requirements changed after approval", [issue("REQUIREMENTS_CHANGED_AFTER_APPROVAL", "$.requirements.approvedContentHash", "Approve the revised Requirements before continuing")]);
  }

  const timestamp = new Date().toISOString();
  let updated: RequirementsAnalysisRecord;
  let evidenceRefs: string[] = [];
  if (checkpointId === "requirements-approve") {
    const clarification = original.requirements.clarification;
    const incomplete = Object.entries(clarification.coverage).filter(([, value]) => value !== "complete").map(([topic]) => topic);
    const issues = [
      ...incomplete.map((topic) => issue("REQUIREMENTS_TOPIC_INCOMPLETE", `$.requirements.clarification.coverage.${topic}`, "Complete this clarification topic before approval")),
      ...clarification.openQuestions.map((question, index) => issue("OPEN_QUESTION", `$.requirements.clarification.openQuestions[${index}]`, question)),
      ...clarification.contradictions.map((contradiction, index) => issue("REQUIREMENTS_CONTRADICTION", `$.requirements.clarification.contradictions[${index}]`, contradiction)),
    ];
    if (issues.length > 0) throw new PdlcError("CHECKPOINT_NOT_READY", "Requirements clarification is incomplete", issues);
    const requirementsHash = await contentHash(options.root, original.requirements.documentRef, "$.requirements.documentRef");
    const source = await inspectGitSource(options.root);
    const requiredRoles = harness.model.deliveryFlows.requiredRoles(original.deliveryFlow, []);
    const proposed: RequirementsAnalysisRecord = {
      ...original,
      status: "REQUIREMENTS_APPROVED",
      revision: original.revision + 1,
      updatedAt: timestamp,
      assignments: Object.fromEntries(requiredRoles.map((role) => [role, actor])),
      source: { ...original.source, baseRevision: source?.revision ?? original.source.baseRevision },
      requirements: { ...original.requirements, status: "approved", approvedBy: actor, approvedAt: timestamp, approvedContentHash: requirementsHash, approvedContractHash: "" },
      resolution: {
        controls: { ...original.resolution.controls, applicable: resolved.controls.map(({ ref }) => ref) },
        baselines: resolved.baselines.map(({ ref }) => ref),
        defaults: resolved.defaults.map(({ sourceRef, key }) => `${sourceRef}:${key}`),
        knowledge: resolved.knowledge.map(({ ref }) => ref),
        integrations: resolved.integrations.map(({ ref }) => ref),
        contextApplications: original.resolution.contextApplications,
      },
    };
    updated = { ...proposed, requirements: { ...proposed.requirements, approvedContractHash: sha256({ requirementsHash, risk: proposed.risk, design: proposed.design, assignments: proposed.assignments, sourceBaseRevision: proposed.source.baseRevision }) } };
    evidenceRefs = [original.requirements.documentRef];
  } else if (checkpointId === "work-items-ready") {
    if (original.stories.length === 0) throw new PdlcError("CHECKPOINT_NOT_READY", "At least one Story is required", [issue("STORIES_MISSING", "$.stories", "Create Story artifacts and snapshots first")]);
    const issues = await validateStories(options.root, original.stories);
    if (issues.length > 0) throw new PdlcError("CHECKPOINT_NOT_READY", "Story artifacts are not ready", issues);
    const completedStages = new Set(activeStages.slice(0, activeStages.indexOf("work-item-planning") + 1));
    const applications = resolved.controls
      .filter(({ policy }) => {
        if (policy.id !== "product-management.requirements-quality") return false;
        const relevant = policy.rules.flatMap(({ enforceAt }) => enforceAt).filter((stage) => activeStages.includes(stage));
        return relevant.length > 0 && relevant.every((stage) => completedStages.has(stage));
      })
      .map(({ ref }) => ({ control: ref, disposition: "satisfied" as const, notes: "Requirements approval and Story traceability checkpoints passed.", evidenceRefs: [original.requirements.documentRef, ...original.stories.map(({ artifactRef }) => artifactRef)], approvedBy: actor }));
    updated = { ...original, status: "WORK_ITEMS_PREPARED", revision: original.revision + 1, updatedAt: timestamp, resolution: { ...original.resolution, controls: { ...original.resolution.controls, applicable: resolved.controls.map(({ ref }) => ref), applications } } };
    evidenceRefs = original.stories.map(({ artifactRef }) => artifactRef);
  } else if (checkpointId === "scope-approve") {
    if (original.scope.storyIds.length === 0) throw new PdlcError("CHECKPOINT_NOT_READY", "Sprint Scope must select at least one Story", [issue("SCOPE_EMPTY", "$.scope.storyIds", "Select Story ids for the Sprint")]);
    const storyIssues = await validateStories(options.root, original.stories);
    const known = new Set(original.stories.map(({ localId }) => localId));
    original.scope.storyIds.forEach((storyId, index) => { if (!known.has(storyId)) storyIssues.push(issue("SCOPE_STORY_UNKNOWN", `$.scope.storyIds[${index}]`, storyId)); });
    storyIssues.push(...await validateScopeDocument(options.root, original));
    if (storyIssues.length > 0) throw new PdlcError("CHECKPOINT_NOT_READY", "Sprint Scope contains invalid Story bindings", storyIssues);
    const scopeHash = await contentHash(options.root, original.scope.documentRef, "$.scope.documentRef");
    const source = await inspectGitSource(options.root);
    if (!source?.revision) throw new PdlcError("CHECKPOINT_NOT_READY", "Sprint Scope approval requires a Git-backed project revision", [issue("SOURCE_REVISION_UNAVAILABLE", "$.source.deliveredRevision", "Commit the project in a Git repository before scope approval")]);
    if (source && source.dirtyApplicationPaths.length > 0) throw new PdlcError("CHECKPOINT_NOT_READY", "The shared handoff must bind to a clean Git revision", source.dirtyApplicationPaths.map((path) => issue("APPLICATION_SOURCE_DIRTY", path, "Commit or remove the application change before scope approval")));
    updated = {
      ...original,
      status: "SCOPED",
      revision: original.revision + 1,
      updatedAt: timestamp,
      source: { ...original.source, deliveredRevision: source.revision },
      scope: { ...original.scope, scopeHash, approvedBy: actor, approvedAt: timestamp },
      changes: original.changes.map((change) => change.status === "approved" ? { ...change, status: "applied" as const } : change),
      resolution: {
        ...original.resolution,
        controls: {
          ...original.resolution.controls,
          applicable: resolved.controls.map(({ ref }) => ref),
          applications: original.resolution.controls.applications,
        },
      },
    };
    evidenceRefs = [original.scope.documentRef, ...original.stories.map(({ artifactRef }) => artifactRef)];
  } else if (checkpointId === "change-approve") {
    const active = (await context.activeRecords()).filter(({ id }) => id !== original.id);
    if (active.length > 0) throw new PdlcError("ACTIVE_RECORD_EXISTS", "Cannot reopen this scoped delivery while another Delivery Record is active", active.map(({ id, status }) => ({ id, status })));
    const changeIndex = original.changes.findLastIndex(({ status }) => status === "proposed" || status === "impact-assessed");
    if (changeIndex < 0) throw new PdlcError("CHECKPOINT_NOT_READY", "No assessed change proposal is awaiting approval", [issue("CHANGE_PROPOSAL_MISSING", "$.changes", "Bind a change proposal before requesting approval")]);
    const change = original.changes[changeIndex]!;
    if (change.type === "implementation-defect") throw new PdlcError("INVALID_ARGUMENT", "An implementation defect does not change the approved Story contract; route it through the implementation delivery instead");
    if (!change.impact.trim()) throw new PdlcError("CHECKPOINT_NOT_READY", "The change impact must be assessed before approval", [issue("CHANGE_IMPACT_MISSING", `$.changes[${changeIndex}].impact`, "Describe affected Stories, dependencies, tests, and scope")]);
    const changes = original.changes.map((entry, index) => index === changeIndex ? { ...entry, status: "approved" as const, approvedBy: actor, approvedAt: timestamp } : entry);
    updated = {
      ...original,
      status: "DRAFT",
      revision: original.revision + 1,
      updatedAt: timestamp,
      changes,
      source: { ...original.source, deliveredRevision: "" },
      requirements: { ...original.requirements, status: "draft", approvedBy: "", approvedAt: "", approvedContentHash: "", approvedContractHash: "" },
      scope: {
        ...original.scope,
        version: original.scope.version + 1,
        previousScopeHash: original.scope.scopeHash,
        scopeHash: "",
        approvedBy: "",
        approvedAt: "",
      },
    };
    evidenceRefs = [original.scope.documentRef];
  } else {
    throw new PdlcError("INVALID_ARGUMENT", `Unsupported requirements analysis checkpoint: ${checkpointId}`);
  }

  await persistRecordAndAudit(options.root, original, updated, {
    eventType: "CHECKPOINT_APPROVED",
    checkpoint: checkpointId,
    fromStatus: original.status,
    toStatus: updated.status,
    actor,
    riskLevel: updated.risk.level,
    evidenceRefs,
  });
  return { ok: true, recordId: updated.id, checkpoint: checkpointId, from: original.status, to: updated.status, revision: updated.revision };
}

export async function readRequirementsAnalysisRecord(options: RunnerOptions): Promise<RequirementsAnalysisRecord> {
  const store = new FileStateStore(options.root);
  const record = options.record ? await store.readRecord(options.record) : await store.readCurrentRecord();
  if (record.deliveryFlow !== "product-requirements-analysis") throw new PdlcError("INVALID_ARGUMENT", `Delivery Record ${record.id} is not a requirements analysis`);
  const validation = validateRequirementsAnalysisRecord(record);
  if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", `Requirements Analysis Record is invalid: ${record.id}`, validation.issues);
  return validation.value;
}

/** Binds editable project artifacts into the controlled Record before a checkpoint. */
export async function bindRequirementsAnalysisArtifacts(options: RunnerOptions, selected?: RequirementsAnalysisRecord): Promise<unknown> {
  const actor = options.actor?.trim();
  if (!actor || !options.input) throw new PdlcError("INVALID_ARGUMENT", "Artifact binding requires --input <binding.json> --actor <identity>");
  const original = selected ?? await readRequirementsAnalysisRecord(options);
  if (original.assignments.product && !Object.values(original.assignments).includes(actor)) throw new PdlcError("INVALID_ARGUMENT", "Only an assigned delivery participant may bind artifacts");
  const inputPath = workspacePath(options.root, options.input);
  if (!inputPath) throw new PdlcError("INVALID_ARGUMENT", "Binding input must be a JSON file inside the workspace");
  let input: Record<string, unknown>;
  try { input = JSON.parse(await readFile(inputPath, "utf8")) as Record<string, unknown>; }
  catch (error) { throw new PdlcError("VALIDATION_FAILED", "Artifact binding input cannot be read", error instanceof Error ? error.message : String(error)); }
  const kind = input.kind;
  const timestamp = new Date().toISOString();
  let updated: RequirementsAnalysisRecord;
  let evidenceRefs: string[] = [options.input];

  if (kind === "stories") {
    if (!["REQUIREMENTS_APPROVED", "WORK_ITEMS_PREPARED"].includes(original.status)) throw new PdlcError("INVALID_ARGUMENT", `Stories cannot be bound while status is ${original.status}`);
    if (!Array.isArray(input.stories)) throw new PdlcError("VALIDATION_FAILED", "Story binding requires a stories array");
    const stories = input.stories as StorySnapshot[];
    const previous = new Map(original.stories.map((story) => [story.localId, story]));
    for (const story of stories) {
      const prior = previous.get(story.localId);
      if (prior && (story.revision !== prior.revision + 1 || story.contentHash === prior.contentHash)) {
        throw new PdlcError("VALIDATION_FAILED", `Story revision does not advance its prior snapshot: ${story.localId}`, [issue("STORY_REVISION_CONFLICT", "$.stories", `Expected revision ${prior.revision + 1} with changed content`)]);
      }
    }
    const candidate = { ...original, revision: original.revision + 1, updatedAt: timestamp, stories };
    const validation = validateRequirementsAnalysisRecord(candidate);
    if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", "Story binding is invalid", validation.issues);
    const issues = await validateStories(options.root, stories);
    if (issues.length > 0) throw new PdlcError("CHECKPOINT_NOT_READY", "Story artifacts cannot be bound", issues);
    updated = { ...original, revision: original.revision + 1, updatedAt: timestamp, stories };
    evidenceRefs = [options.input, ...stories.map(({ artifactRef }) => artifactRef)];
  } else if (kind === "scope") {
    if (original.status !== "WORK_ITEMS_PREPARED") throw new PdlcError("INVALID_ARGUMENT", `Sprint Scope cannot be bound while status is ${original.status}`);
    if (!input.scope || typeof input.scope !== "object") throw new PdlcError("VALIDATION_FAILED", "Scope binding requires a scope object");
    const scope = input.scope as SprintScopeBinding;
    const expectedVersion = original.scope.version === 0 ? 1 : original.scope.version;
    if (scope.version !== expectedVersion || scope.previousScopeHash !== original.scope.previousScopeHash) throw new PdlcError("VALIDATION_FAILED", "Sprint Scope version lineage does not match the controlled Record", [issue("SCOPE_VERSION_CONFLICT", "$.scope", `Expected version ${expectedVersion} and previousScopeHash ${original.scope.previousScopeHash || "<empty>"}`)]);
    const known = new Set(original.stories.map(({ localId }) => localId));
    const unknown = Array.isArray(scope.storyIds) ? scope.storyIds.filter((id) => !known.has(id)) : [];
    if (unknown.length > 0) throw new PdlcError("VALIDATION_FAILED", "Sprint Scope references unknown Stories", unknown.map((id) => issue("SCOPE_STORY_UNKNOWN", "$.scope.storyIds", id)));
    updated = { ...original, revision: original.revision + 1, updatedAt: timestamp, scope: { ...scope, scopeHash: "", approvedBy: "", approvedAt: "" } };
    const validation = validateRequirementsAnalysisRecord(updated);
    if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", "Sprint Scope binding is invalid", validation.issues);
    evidenceRefs = [options.input, scope.documentRef];
  } else if (kind === "change") {
    if (original.status !== "SCOPED") throw new PdlcError("INVALID_ARGUMENT", `A change proposal can only be bound to a SCOPED delivery, not ${original.status}`);
    if (!input.change || typeof input.change !== "object") throw new PdlcError("VALIDATION_FAILED", "Change binding requires a change object");
    const candidate = input.change as DeliveryChange;
    if (original.changes.some(({ id }) => id === candidate.id)) throw new PdlcError("VALIDATION_FAILED", `Change id already exists: ${candidate.id}`);
    const change: DeliveryChange = { ...candidate, status: "proposed", proposedBy: actor, createdAt: timestamp, approvedBy: "", approvedAt: "" };
    updated = { ...original, revision: original.revision + 1, updatedAt: timestamp, changes: [...original.changes, change] };
    const validation = validateRequirementsAnalysisRecord(updated);
    if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", "Change Proposal binding is invalid", validation.issues);
  } else {
    throw new PdlcError("INVALID_ARGUMENT", "Binding kind must be stories, scope, or change");
  }

  await persistRecordAndAudit(options.root, original, updated, {
    eventType: "DELIVERY_ARTIFACTS_BOUND",
    stage: kind === "stories" ? "work-item-planning" : kind === "scope" ? "delivery-planning" : "requirements-analysis",
    fromStatus: original.status,
    toStatus: updated.status,
    actor,
    riskLevel: updated.risk.level,
    evidenceRefs,
  });
  return { ok: true, recordId: updated.id, kind, status: updated.status, revision: updated.revision };
}

async function prepareInitialization(context: FlowExecutionContext, input: unknown) {
  const validation = validateRequirementsAnalysisRecord(input);
  if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", "Initial Requirements Analysis Record is invalid", validation.issues);
  const record = validation.value;
  const issues: ValidationIssue[] = [];
  if (record.requirements.status !== "draft") issues.push(issue("INITIAL_REQUIREMENTS_INVALID", "$.requirements.status", "A new requirements analysis must start with draft Requirements"));
  if (record.stories.length > 0) issues.push(issue("INITIAL_STORIES_INVALID", "$.stories", "Stories are created after Requirements approval"));
  if (record.scope.version !== 0 || record.scope.scopeHash || record.scope.storyIds.length > 0) issues.push(issue("INITIAL_SCOPE_INVALID", "$.scope", "A new requirements analysis cannot start with a Sprint Scope"));
  if (record.changes.length > 0) issues.push(issue("INITIAL_CHANGES_INVALID", "$.changes", "A new requirements analysis cannot start with change proposals"));
  if (record.resolution.contextApplications.length > 0) issues.push(issue("INITIAL_CONTEXT_INVALID", "$.resolution.contextApplications", "Stage Context is applied after initialization"));
  const file = workspacePath(context.projectRoot, record.requirements.documentRef);
  if (!file) issues.push(issue("INITIAL_REQUIREMENTS_REF_UNSAFE", "$.requirements.documentRef", "Requirements must remain inside the project workspace"));
  if (issues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Initial Requirements Analysis Record violates initialization constraints", issues);
  try { await access(file!); }
  catch { throw new PdlcError("VALIDATION_FAILED", "Initial Requirements document does not exist", [issue("INITIAL_REQUIREMENTS_MISSING", "$.requirements.documentRef", `Create ${record.requirements.documentRef} before initialization`)]); }
  return { record, stage: context.flow.stageSequence[0]!.stageId, evidenceRefs: [record.requirements.documentRef] };
}

async function operationalIssues(context: FlowExecutionContext, record: RequirementsAnalysisRecord): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const requiredContextStages = record.status === "DRAFT"
    ? ["requirements-clarification", "requirements-analysis"]
    : record.status === "REQUIREMENTS_APPROVED"
      ? ["work-item-planning"]
      : record.status === "WORK_ITEMS_PREPARED"
        ? ["delivery-planning"]
        : [];
  issues.push(...await context.harness.contextIssues(record, requiredContextStages));
  if (record.requirements.status === "approved") {
    try {
      const current = await contentHash(context.projectRoot, record.requirements.documentRef, "$.requirements.documentRef");
      if (current !== record.requirements.approvedContentHash) issues.push(issue("REQUIREMENTS_CHANGED_AFTER_APPROVAL", "$.requirements.approvedContentHash", "Approved Requirements content has changed"));
    } catch (error) {
      if (error instanceof PdlcError && Array.isArray(error.details)) issues.push(...error.details as ValidationIssue[]);
      else throw error;
    }
  }
  if (["WORK_ITEMS_PREPARED", "SCOPED"].includes(record.status)) issues.push(...await validateStories(context.projectRoot, record.stories));
  if (record.status === "SCOPED") issues.push(...await validateScopeDocument(context.projectRoot, record));
  return issues;
}

function asRequirementsRecord(record: BaseDeliveryRecord): RequirementsAnalysisRecord {
  const validation = validateRequirementsAnalysisRecord(record);
  if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", `Requirements Analysis Record is invalid: ${record.id}`, validation.issues);
  return validation.value;
}

export const deliveryFlowExecutor: DeliveryFlowExecutor = {
  validateRecord: validateRequirementsAnalysisRecord,
  prepareInitialization: (context, input) => prepareInitialization(context, input),
  isTerminal: (record, flow) => flow.controls.terminalStatuses.includes(record.status)
    && !(asRequirementsRecord(record).changes.some(({ status }) => ["proposed", "impact-assessed", "approved"].includes(status))),
  checkpoint: (context, options, checkpointId, record) => requirementsAnalysisCheckpoint(context, options, checkpointId, asRequirementsRecord(record)),
  action: (context, options, actionId, record) => {
    if (actionId !== "artifacts-bind") throw new PdlcError("INVALID_ARGUMENT", `Unsupported Requirements Analysis action: ${actionId}`);
    return bindRequirementsAnalysisArtifacts(options, asRequirementsRecord(record));
  },
  status: async (context, record) => {
    const selected = asRequirementsRecord(record);
    const issues = await operationalIssues(context, selected);
    return {
      ok: issues.length === 0,
      initialized: true,
      recordId: selected.id,
      deliveryFlow: selected.deliveryFlow,
      status: selected.status,
      revision: selected.revision,
      requirements: selected.requirements,
      stories: selected.stories.map(({ localId, revision, artifactRef, externalKey }) => ({ localId, revision, artifactRef, externalKey })),
      scope: selected.scope,
      source: selected.source,
      operationalIssues: issues,
      availableActions: context.flow.controls.checkpoints.filter(({ from }) => from.includes(selected.status)).map(({ id, to, ownerRole }) => ({ checkpoint: id, to, ownerRole })),
    };
  },
  auditSummary: (_context, record, events) => genericAuditSummary(record, events),
  operationalIssues: (context, record) => operationalIssues(context, asRequirementsRecord(record)),
};
