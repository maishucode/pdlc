import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runCli } from "../cli.ts";
import { applyStageContext } from "../commands/context.ts";
import { AuditLog } from "../core/audit.ts";
import { FlowEngine } from "../core/flow-engine.ts";
import { sha256 } from "../core/hash.ts";
import { FileStateStore } from "../core/state.ts";
import type { ContextualDeliveryRecord, StageContextReceipt } from "../core/types.ts";
import type { PocDeliveryRecord } from "../core/types.ts";
import { assessContractChange, assessDeliveryContract } from "../delivery-flows/product-requirements-analysis/delivery-contract.ts";
import type { RequirementsAnalysisRecord } from "../delivery-flows/product-requirements-analysis/types.ts";

const harnessProjectRoot = resolve(import.meta.dirname, "../..");
const execFile = promisify(execFileCallback);

interface ContextOutput {
  contextHash: string;
  controls: Array<{ ref: string }>;
  knowledge: Array<{ ref: string }>;
  disciplineContributions: Array<{
    discipline: string;
    version: string;
    agent: { id: string };
    skills: Array<{ name: string }>;
  }>;
  integrations: Array<{ ref: string; skills: Array<{ id: string }> }>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function temporaryWorkspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function initializeRequirementsRecord(workspace: string, record: RequirementsAnalysisRecord) {
  await mkdir(dirname(join(workspace, record.requirements.documentRef)), { recursive: true });
  await writeFile(join(workspace, record.requirements.documentRef), `# ${record.id} Requirements\n`, { flag: "w" });
  const input = `pdlc/.state/inbox/${record.id}.json`;
  await writeJson(join(workspace, input), record);
  return runCli(["init", "--root", workspace, "--input", input, "--actor", "product-owner"], workspace);
}

async function initializePocRecord(workspace: string, record: PocDeliveryRecord) {
  const input = `pdlc/.state/inbox/${record.id}.json`;
  await writeJson(join(workspace, input), record);
  return runCli(["init", "--root", workspace, "--input", input, "--actor", "pdlc-agent"], workspace);
}

async function applyResolvedContext(workspace: string, stage: string, evidenceRefs: string[]): Promise<ContextOutput> {
  const context = await runCli(["context", stage, "--root", workspace], workspace);
  assert.equal(context.exitCode, 0, JSON.stringify(context.output));
  const output = context.output as ContextOutput;
  const receipt: StageContextReceipt = {
    schemaVersion: 1,
    stage,
    contextHash: output.contextHash,
    policies: output.controls.map(({ ref }) => ({ ref, notes: `Applied ${ref}.` })),
    knowledge: output.knowledge.map(({ ref }) => ({ ref, disposition: "used", notes: `Consulted ${ref}.`, evidenceRefs })),
    disciplineContributions: output.disciplineContributions.map(({ discipline, version, agent, skills }) => ({
      ref: `${discipline}@${version}:${agent.id}`,
      agent: agent.id,
      skills: skills.map(({ name }) => name),
      disposition: "used",
      notes: `Executed ${agent.id}.`,
      evidenceRefs,
    })),
    integrations: output.integrations.map(({ ref, skills }) => ({
      ref,
      skills: skills.map(({ id }) => id),
      disposition: "used",
      notes: `Used ${ref}.`,
      evidenceRefs,
    })),
  };
  const receiptPath = `pdlc/evidence/context/${stage}.json`;
  await writeJson(join(workspace, receiptPath), receipt);
  const applied = await runCli(["context-apply", stage, "--root", workspace, "--receipt", receiptPath, "--actor", "product-owner"], workspace);
  assert.equal(applied.exitCode, 0, JSON.stringify(applied.output));
  return output;
}

async function initializeGitProject(workspace: string): Promise<void> {
  await writeFile(join(workspace, "README.md"), "# Framework E2E fixture\n");
  await execFile("git", ["init"], { cwd: workspace });
  await execFile("git", ["config", "user.email", "framework-e2e@example.com"], { cwd: workspace });
  await execFile("git", ["config", "user.name", "Framework E2E"], { cwd: workspace });
  await execFile("git", ["add", "README.md"], { cwd: workspace });
  await execFile("git", ["commit", "-m", "initialize fixture"], { cwd: workspace });
}

test("runs a concrete Flow executor through delivery, controlled change, and revised handoff", async (context) => {
  const workspace = await temporaryWorkspace("lean-pdlc-framework-e2e-");
  context.after(() => rm(workspace, { recursive: true, force: true }));
  await initializeGitProject(workspace);

  const record = JSON.parse(await readFile(join(harnessProjectRoot, ".pdlc/examples/requirements-analysis-record.json"), "utf8")) as RequirementsAnalysisRecord;
  record.id = "REQ-FRAMEWORK-E2E";
  record.requirements.documentRef = "pdlc/requirements/REQ-FRAMEWORK-E2E.md";
  record.requirements.clarification.questionsAnswered = 7;
  record.requirements.clarification.coverage = Object.fromEntries(
    Object.keys(record.requirements.clarification.coverage).map((topic) => [topic, "complete"]),
  ) as RequirementsAnalysisRecord["requirements"]["clarification"]["coverage"];
  assert.equal((await initializeRequirementsRecord(workspace, record)).exitCode, 0);

  const requirementStages = [
    "requirements-clarification",
    "requirements-analysis",
    "acceptance-criteria-definition",
    "data-integration-boundaries",
    "risk-classification",
    "requirements-approval",
  ];
  for (const stage of requirementStages) {
    const resolved = await applyResolvedContext(workspace, stage, [record.requirements.documentRef]);
    if (stage === "requirements-clarification") {
      assert(resolved.controls.some(({ ref }) => ref === "product-management.requirements-quality@1.0.0"));
      assert(resolved.knowledge.some(({ ref }) => ref === "product-management.requirements-writing@1.0.0"));
    }
  }
  assert.equal((await runCli(["checkpoint", "requirements-approve", "--root", workspace, "--actor", "product-owner"], workspace)).exitCode, 0);

  const storyRef = "pdlc/artifacts/stories/STORY-FRAMEWORK-E2E.md";
  const storyContent = "# Story Framework E2E\n\nThe approved delivery scope can be handed off.\n";
  await mkdir(dirname(join(workspace, storyRef)), { recursive: true });
  await writeFile(join(workspace, storyRef), storyContent);
  const story = {
    localId: "STORY-FRAMEWORK-E2E",
    artifactRef: storyRef,
    externalKey: "",
    revision: 1,
    contentHash: sha256(storyContent),
    requirementRefs: ["FR-1"],
    acceptanceCriteria: ["The terminal Sprint Scope is auditable"],
    dependencies: [],
  };
  await writeJson(join(workspace, "stories-binding.json"), { kind: "stories", stories: [story] });
  assert.equal((await runCli(["action", "artifacts-bind", "--root", workspace, "--input", "stories-binding.json", "--actor", "product-owner"], workspace)).exitCode, 0);
  await applyResolvedContext(workspace, "work-item-planning", [storyRef]);
  assert.equal((await runCli(["checkpoint", "work-items-ready", "--root", workspace, "--actor", "product-owner"], workspace)).exitCode, 0);

  const scopeRef = "pdlc/artifacts/scopes/SPRINT-FRAMEWORK-E2E.json";
  const sprint = { id: "SPRINT-FRAMEWORK-E2E", name: "Framework E2E", capturedAt: "2026-08-30T00:00:00.000Z" };
  await writeJson(join(workspace, scopeRef), {
    artifactType: "product-management.sprint-scope",
    version: 1,
    previousScopeHash: "",
    epicRef: "EPIC-FRAMEWORK-E2E",
    sprint,
    stories: [story],
  });
  await writeJson(join(workspace, "scope-binding.json"), {
    kind: "scope",
    scope: {
      artifactType: "product-management.sprint-scope",
      documentRef: scopeRef,
      version: 1,
      previousScopeHash: "",
      scopeHash: "",
      epicRef: "EPIC-FRAMEWORK-E2E",
      sprint,
      storyIds: [story.localId],
      approvedBy: "",
      approvedAt: "",
    },
  });
  assert.equal((await runCli(["action", "artifacts-bind", "--root", workspace, "--input", "scope-binding.json", "--actor", "product-owner"], workspace)).exitCode, 0);
  await applyResolvedContext(workspace, "delivery-planning", [scopeRef]);
  await execFile("git", ["add", "."], { cwd: workspace });
  await execFile("git", ["commit", "-m", "bind sprint handoff"], { cwd: workspace });
  assert.equal((await runCli(["checkpoint", "scope-approve", "--root", workspace, "--actor", "product-owner"], workspace)).exitCode, 0);

  const store = new FileStateStore(workspace);
  const firstHandoff = await store.readRecord<RequirementsAnalysisRecord>(record.id);
  assert.equal(firstHandoff.status, "SCOPED");
  assert.match(firstHandoff.source.deliveredRevision, /^[a-f0-9]{7,64}$/);
  const firstContractAssessment = await assessDeliveryContract(workspace, firstHandoff, [story.localId]);
  assert.equal(firstContractAssessment.ok, true, JSON.stringify(firstContractAssessment.issues));

  await writeJson(join(workspace, "change-binding.json"), {
    kind: "change",
    change: {
      id: "CHANGE-FRAMEWORK-E2E",
      type: "requirements-change",
      storyIds: [story.localId],
      reason: "Clarify the observable handoff behavior discovered during implementation.",
      impact: "Revise the selected Story and publish Sprint Scope version 2; downstream work must rebase.",
    },
  });
  assert.equal((await runCli(["action", "artifacts-bind", "--root", workspace, "--input", "change-binding.json", "--actor", "product-owner"], workspace)).exitCode, 0);
  assert.equal((await runCli(["checkpoint", "change-approve", "--root", workspace, "--actor", "product-owner"], workspace)).exitCode, 0);
  const reopened = await store.readRecord<RequirementsAnalysisRecord>(record.id);
  assert.equal(reopened.status, "DRAFT");
  assert.equal(reopened.scope.version, 2);
  assert.equal(reopened.scope.previousScopeHash, firstHandoff.scope.scopeHash);

  await writeFile(join(workspace, record.requirements.documentRef), `# ${record.id} Requirements\n\nFR-2: Preserve an explicit revised handoff.\n`);
  assert.equal((await runCli(["checkpoint", "requirements-approve", "--root", workspace, "--actor", "product-owner"], workspace)).exitCode, 0);
  const revisedStoryContent = `${storyContent}\nThe revised handoff is explicit and versioned.\n`;
  await writeFile(join(workspace, storyRef), revisedStoryContent);
  const revisedStory = { ...story, revision: 2, contentHash: sha256(revisedStoryContent), requirementRefs: ["FR-1", "FR-2"] };
  await writeJson(join(workspace, "stories-binding-v2.json"), { kind: "stories", stories: [revisedStory] });
  assert.equal((await runCli(["action", "artifacts-bind", "--root", workspace, "--input", "stories-binding-v2.json", "--actor", "product-owner"], workspace)).exitCode, 0);
  assert.equal((await runCli(["checkpoint", "work-items-ready", "--root", workspace, "--actor", "product-owner"], workspace)).exitCode, 0);
  await writeJson(join(workspace, scopeRef), {
    artifactType: "product-management.sprint-scope",
    version: 2,
    previousScopeHash: firstHandoff.scope.scopeHash,
    epicRef: "EPIC-FRAMEWORK-E2E",
    sprint,
    stories: [revisedStory],
  });
  await writeJson(join(workspace, "scope-binding-v2.json"), {
    kind: "scope",
    scope: {
      artifactType: "product-management.sprint-scope",
      documentRef: scopeRef,
      version: 2,
      previousScopeHash: firstHandoff.scope.scopeHash,
      scopeHash: "",
      epicRef: "EPIC-FRAMEWORK-E2E",
      sprint,
      storyIds: [revisedStory.localId],
      approvedBy: "",
      approvedAt: "",
    },
  });
  assert.equal((await runCli(["action", "artifacts-bind", "--root", workspace, "--input", "scope-binding-v2.json", "--actor", "product-owner"], workspace)).exitCode, 0);
  await execFile("git", ["add", "."], { cwd: workspace });
  await execFile("git", ["commit", "-m", "approve revised sprint handoff"], { cwd: workspace });
  assert.equal((await runCli(["checkpoint", "scope-approve", "--root", workspace, "--actor", "product-owner"], workspace)).exitCode, 0);

  const revisedHandoff = await store.readRecord<RequirementsAnalysisRecord>(record.id);
  assert.equal(revisedHandoff.status, "SCOPED");
  assert.equal(revisedHandoff.scope.version, 2);
  const revisedContractAssessment = await assessDeliveryContract(workspace, revisedHandoff, [revisedStory.localId]);
  assert.equal(revisedContractAssessment.ok, true, JSON.stringify(revisedContractAssessment.issues));
  const downstreamChange = assessContractChange(firstContractAssessment.contract!, revisedContractAssessment.contract!);
  assert(downstreamChange.issues.some(({ code }) => code === "SELECTED_STORY_CHANGED"));

  const events = await new AuditLog(workspace).readAll(record.id);
  assert.equal(events[0]?.eventType, "DELIVERY_FLOW_CREATED");
  assert.equal(events.filter(({ eventType }) => eventType === "DELIVERY_ARTIFACTS_BOUND").length, 5);
  assert.deepEqual(
    events.filter(({ eventType }) => eventType === "CHECKPOINT_APPROVED").map(({ checkpoint }) => checkpoint),
    ["requirements-approve", "work-items-ready", "scope-approve", "change-approve", "requirements-approve", "work-items-ready", "scope-approve"],
  );
});

test("runs the lightweight POC Flow from Draft through guarded evidence to Parked", async (context) => {
  const workspace = await temporaryWorkspace("lean-pdlc-poc-e2e-");
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const record = JSON.parse(await readFile(join(harnessProjectRoot, ".pdlc/examples/poc-delivery-record.json"), "utf8")) as PocDeliveryRecord;
  record.id = "POC-FRAMEWORK-E2E";
  record.requirements.documentRef = `pdlc/requirements/${record.id}.md`;
  record.requirements.clarification = {
    questionsAnswered: 8,
    coverage: {
      productContext: "complete",
      functionalBehavior: "complete",
      userScenarios: "complete",
      uxInteraction: "complete",
      qualityAttributes: "complete",
      dataIntegrations: "complete",
      scopeSuccess: "complete",
    },
    openQuestions: [],
    contradictions: [],
  };
  record.design.summary = "One reversible local function and focused verification evidence.";
  record.design.decisions = ["Use no network, credentials, or persistent production dependency."];
  record.design.technologies = [];
  record.design.disciplines = [];
  record.risk = { level: "low", triggers: [] };
  const applicableControls = [
    "product-management.requirements-quality@1.0.0",
    "security.credential-boundary@1.0.0",
    "solution-architecture.reversible-delivery@1.0.0",
  ];
  record.resolution.controls.applicable = applicableControls;
  record.resolution.controls.applications = applicableControls.map((control) => ({
    control,
    disposition: "satisfied",
    notes: `Applied ${control} to the bounded local experiment.`,
    evidenceRefs: [record.requirements.documentRef],
    approvedBy: control === "product-management.requirements-quality@1.0.0" ? "" : "product-owner",
  }));
  await mkdir(dirname(join(workspace, record.requirements.documentRef)), { recursive: true });
  await writeFile(join(workspace, record.requirements.documentRef), await readFile(join(harnessProjectRoot, ".pdlc/tests/fixtures/ready-poc-minimal.md"), "utf8"));
  assert.equal((await initializePocRecord(workspace, record)).exitCode, 0);
  await applyResolvedContext(workspace, "requirements-clarification", [record.requirements.documentRef]);
  await applyResolvedContext(workspace, "build-readiness", [record.requirements.documentRef]);

  const store = new FileStateStore(workspace);
  const beforeCheck = await store.readRecord<PocDeliveryRecord>(record.id);
  const beforeCheckEvents = await new AuditLog(workspace).readAll(record.id);
  const preflight = await runCli(["action", "build-readiness", "--check", "--root", workspace, "--actor", "product-owner"], workspace);
  assert.equal(preflight.exitCode, 0, JSON.stringify(preflight.output));
  assert.deepEqual(await store.readRecord(record.id), beforeCheck);
  assert.deepEqual(await new AuditLog(workspace).readAll(record.id), beforeCheckEvents);

  const committed = await runCli(["action", "build-readiness", "--root", workspace, "--actor", "product-owner"], workspace);
  assert.equal(committed.exitCode, 0, JSON.stringify(committed.output));
  const committedRecord = await store.readRecord<PocDeliveryRecord>(record.id);
  assert.equal(committedRecord.status, "COMMITTED");
  assert.deepEqual(committedRecord.assignments, { product: "product-owner", developer: "product-owner", qa: "product-owner" });

  const blockedVerify = await runCli(["checkpoint", "verify", "--root", workspace, "--actor", "product-owner"], workspace);
  assert.equal(blockedVerify.exitCode, 2);
  const blockedCodes = (blockedVerify.output as { error: { details: Array<{ code: string }> } }).error.details.map(({ code }) => code);
  assert(blockedCodes.includes("TEST_EVIDENCE_MISSING"));
  assert(blockedCodes.includes("BUILD_EVIDENCE_MISSING"));
  assert(blockedCodes.includes("DEMO_EVIDENCE_MISSING"));

  const evidence = {
    tests: "pdlc/evidence/poc/tests.txt",
    build: "pdlc/evidence/poc/build.txt",
    demo: "pdlc/evidence/poc/demo.txt",
  };
  for (const [kind, ref] of Object.entries(evidence)) {
    await mkdir(dirname(join(workspace, ref)), { recursive: true });
    await writeFile(join(workspace, ref), `${kind} evidence passed\n`);
  }
  const prepared: PocDeliveryRecord = {
    ...committedRecord,
    revision: committedRecord.revision + 1,
    updatedAt: new Date().toISOString(),
    resolution: {
      ...committedRecord.resolution,
      controls: {
        ...committedRecord.resolution.controls,
        applications: committedRecord.resolution.controls.applications.map((application) => ({
          ...application,
          evidenceRefs: [...new Set([...application.evidenceRefs, ...Object.values(evidence)])],
        })),
      },
    },
    evidence: {
      tests: [{ kind: "file", ref: evidence.tests, description: "Focused automated check." }],
      build: [{ kind: "file", ref: evidence.build, description: "Reproducible local build check." }],
      security: [],
      demo: [{ kind: "demo", ref: evidence.demo, description: "Bounded acceptance demonstration." }],
    },
    decision: {
      ...committedRecord.decision,
      rationale: "The bounded hypothesis was answered without expanding into production delivery.",
      followUp: "Retain the evidence and start a formal Flow only if the idea becomes a priority.",
    },
  };
  await store.writeRecord(prepared, committedRecord.revision);
  for (const stage of ["implementation", "developer-verification", "acceptance-verification"]) {
    await applyResolvedContext(workspace, stage, Object.values(evidence));
  }
  const verified = await runCli(["checkpoint", "verify", "--root", workspace, "--actor", "product-owner"], workspace);
  assert.equal(verified.exitCode, 0, JSON.stringify(verified.output));
  const parked = await runCli(["checkpoint", "decide", "--root", workspace, "--actor", "product-owner", "--outcome", "park"], workspace);
  assert.equal(parked.exitCode, 0, JSON.stringify(parked.output));

  const final = await store.readRecord<PocDeliveryRecord>(record.id);
  assert.equal(final.status, "PARKED");
  assert.equal(final.decision.outcome, "park");
  assert.equal(final.evidence.security.length, 0, "low-risk POCs must not require an inactive Security Stage");
  const events = await new AuditLog(workspace).readAll(record.id);
  assert.deepEqual(events.filter(({ eventType }) => eventType === "CHECKPOINT_APPROVED").map(({ checkpoint }) => checkpoint), ["commit", "verify", "decide"]);
  assert.equal(new Set(events.map(({ recordHash }) => recordHash)).size, events.length);
});

test("discovers a new Stage, Flow, Policy, Knowledge, Agent and Skill without Core changes", async (context) => {
  const workspace = await temporaryWorkspace("lean-pdlc-extension-e2e-");
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const harnessRoot = join(workspace, "harness");
  const projectRoot = join(workspace, "project");
  await cp(join(harnessProjectRoot, ".pdlc"), join(harnessRoot, ".pdlc"), {
    recursive: true,
    filter: (source) => basename(source) !== "node_modules",
  });
  await mkdir(projectRoot, { recursive: true });

  const protectedPaths = [".pdlc/cli.ts", ".pdlc/core/flow-engine.ts", ".pdlc/core/harness-context.ts"];
  const before = await Promise.all(protectedPaths.map(async (path) => sha256(await readFile(join(harnessRoot, path), "utf8"))));

  const stageCatalogPath = join(harnessRoot, ".pdlc/stages/catalog.json");
  const stageCatalog = JSON.parse(await readFile(stageCatalogPath, "utf8")) as { stages: unknown[] };
  stageCatalog.stages.push({
    id: "framework-smoke-review",
    name: "Framework smoke review",
    description: "Exercise dynamically discovered delivery context and governance assets.",
    phase: "verify",
    roleSlots: ["developer", "qa"],
    requirements: ["Resolve and acknowledge the framework assurance context."],
    outputs: ["framework-smoke-evidence"],
  });
  await writeJson(stageCatalogPath, stageCatalog);

  const flowCatalogPath = join(harnessRoot, ".pdlc/delivery-flows/catalog.json");
  const flowCatalog = JSON.parse(await readFile(flowCatalogPath, "utf8")) as { flows: unknown[] };
  flowCatalog.flows.push({ id: "framework-smoke", definition: "framework-smoke/flow.json" });
  await writeJson(flowCatalogPath, flowCatalog);
  await writeJson(join(harnessRoot, ".pdlc/delivery-flows/framework-smoke/flow.json"), {
    schemaVersion: 2,
    id: "framework-smoke",
    name: "Framework Smoke Flow",
    description: "A configuration-only Flow proving the generic engine extension contract.",
    status: "active",
    stageSequence: [{ stageId: "framework-smoke-review", inclusion: "required" }],
    controls: {
      initialStatus: "DRAFT",
      terminalStatuses: ["PASSED"],
      checkpoints: [
        { id: "review", from: ["DRAFT"], to: "REVIEWED", ownerRole: "developer" },
        { id: "pass", from: ["REVIEWED"], to: "PASSED", ownerRole: "qa" },
      ],
      deliveryDefaults: { roleAssignmentMode: "explicit-role-assignment", timebox: "one minute", collectDuringRequirements: true },
      constraints: { productionUse: false, externalIntegrations: [], allowSinglePersonAllRoles: true },
    },
  });

  const disciplineRoot = join(harnessRoot, ".pdlc/disciplines/framework-assurance");
  await writeJson(join(disciplineRoot, "discipline.json"), {
    schemaVersion: 1,
    id: "framework-assurance",
    name: "Framework Assurance",
    description: "Test-only assets proving dynamic Discipline discovery.",
    owners: ["framework-team"],
    policyApprovers: ["framework-governance"],
    maintainers: ["framework-team"],
    contributionMode: { artifacts: "reviewed", policies: "restricted", knowledge: "open", skills: "reviewed", agents: "reviewed", hooks: "reviewed" },
  });
  await writeJson(join(disciplineRoot, "policies/stability.policy.json"), {
    schemaVersion: 1,
    id: "framework-assurance.stability",
    title: "Framework stability",
    description: "Require deterministic local evidence from the smoke Stage.",
    ownerDiscipline: "framework-assurance",
    version: "1.0.0",
    appliesTo: { deliveryFlows: ["framework-smoke"], stages: ["framework-smoke-review"] },
    rules: [{ id: "deterministic-smoke", statement: "Produce deterministic local smoke evidence.", enforcement: "automatic", enforceAt: ["framework-smoke-review"] }],
  });
  await writeJson(join(disciplineRoot, "knowledge/guidance/smoke-method.json"), {
    schemaVersion: 1,
    id: "framework-assurance.smoke-method",
    title: "Smoke test method",
    description: "A minimal repeatable framework verification method.",
    ownerDiscipline: "framework-assurance",
    version: "1.0.0",
    kind: "guidance",
    appliesTo: { deliveryFlows: ["framework-smoke"], stages: ["framework-smoke-review"] },
    contentRef: "smoke-method.md",
  });
  await mkdir(join(disciplineRoot, "agents"), { recursive: true });
  await mkdir(join(disciplineRoot, "skills/framework-smoke"), { recursive: true });
  await writeFile(join(disciplineRoot, "knowledge/guidance/smoke-method.md"), "# Smoke method\n\nResolve, apply, checkpoint.\n");
  await writeFile(join(disciplineRoot, "agents/framework-smoke.agent.md"), "# Framework Smoke Agent\n\nCoordinates the smoke review.\n");
  await writeFile(join(disciplineRoot, "skills/framework-smoke/SKILL.md"), "# Framework Smoke Skill\n\nCreate deterministic local evidence.\n");
  await writeJson(join(disciplineRoot, "hooks/stages.json"), {
    schemaVersion: 1,
    discipline: "framework-assurance",
    version: "1.0.0",
    deliveryFlows: ["framework-smoke"],
    enabled: true,
    permissions: { filesystem: "write", network: false, externalWrites: false },
    bindings: [{
      stage: "framework-smoke-review",
      agent: "framework-smoke",
      skills: ["framework-smoke"],
      mode: "verify",
      handoff: "Produce local framework smoke evidence.",
      approvalBoundary: "The Agent reports evidence; the QA checkpoint remains external to the contribution.",
    }],
  });

  const record = {
    schemaVersion: 1,
    id: "FRAMEWORK-SMOKE-E2E",
    deliveryFlow: "framework-smoke",
    status: "DRAFT",
    title: "Framework extension smoke",
    revision: 0,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    assignments: { developer: "developer@example.com", qa: "qa@example.com" },
    source: { baseRevision: "", derivedFromRecord: "", deliveredRevision: "" },
    risk: { level: "low", triggers: [] },
    resolution: { controls: { applicable: [], exceptions: [], applications: [] }, baselines: [], defaults: [], knowledge: [], integrations: [], contextApplications: [] },
    design: { summary: "", decisions: [], technologies: [], disciplines: ["framework-assurance"] },
  };
  const engine = await FlowEngine.load(harnessRoot, projectRoot);
  assert.equal(await engine.executor(engine.flow("framework-smoke")), undefined);
  await engine.initialize(record, "qa@example.com");

  const material = await engine.harness.resolveStage("framework-smoke-review", record as unknown as ContextualDeliveryRecord);
  assert.deepEqual(material.resolved.controls.map(({ ref }) => ref), ["framework-assurance.stability@1.0.0"]);
  assert.deepEqual(material.resolved.knowledge.map(({ ref }) => ref), ["framework-assurance.smoke-method@1.0.0"]);
  assert.deepEqual(material.disciplineGuidance.contributions.map(({ discipline, agent, skills }) => ({ discipline, agent: agent.id, skills: skills.map(({ name }) => name) })), [
    { discipline: "framework-assurance", agent: "framework-smoke", skills: ["framework-smoke"] },
  ]);

  const evidenceRef = "pdlc/evidence/framework-smoke.txt";
  await mkdir(dirname(join(projectRoot, evidenceRef)), { recursive: true });
  await writeFile(join(projectRoot, evidenceRef), "framework smoke passed\n");
  const receipt: StageContextReceipt = {
    schemaVersion: 1,
    stage: "framework-smoke-review",
    contextHash: material.snapshot.contextHash,
    policies: material.resolved.controls.map(({ ref }) => ({ ref, notes: "Acknowledged by the E2E fixture." })),
    knowledge: material.resolved.knowledge.map(({ ref }) => ({ ref, disposition: "used", notes: "Applied the smoke method.", evidenceRefs: [evidenceRef] })),
    disciplineContributions: material.disciplineGuidance.contributions.map(({ discipline, version, agent, skills }) => ({
      ref: `${discipline}@${version}:${agent.id}`,
      agent: agent.id,
      skills: skills.map(({ name }) => name),
      disposition: "used",
      notes: "Executed the discovered Discipline component.",
      evidenceRefs: [evidenceRef],
    })),
    integrations: [],
  };
  await writeJson(join(projectRoot, "pdlc/evidence/context/framework-smoke-review.json"), receipt);
  await applyStageContext(harnessRoot, {
    root: projectRoot,
    receipt: "pdlc/evidence/context/framework-smoke-review.json",
    actor: "qa@example.com",
  }, "framework-smoke-review");
  await assert.rejects(
    engine.checkpoint({ root: projectRoot, actor: "qa@example.com" }, "review"),
    /assigned developer role/,
  );
  const reviewed = await engine.checkpoint({ root: projectRoot, actor: "developer@example.com" }, "review") as { to: string; revision: number };
  assert.deepEqual({ to: reviewed.to, revision: reviewed.revision }, { to: "REVIEWED", revision: 2 });
  const transition = await engine.checkpoint({ root: projectRoot, actor: "qa@example.com" }, "pass") as { to: string; revision: number };
  assert.deepEqual({ to: transition.to, revision: transition.revision }, { to: "PASSED", revision: 3 });
  assert.equal((await engine.activeRecords()).length, 0);
  assert.deepEqual((await new AuditLog(projectRoot).readAll(record.id)).map(({ eventType }) => eventType), [
    "DELIVERY_FLOW_CREATED",
    "STAGE_CONTEXT_APPLIED",
    "CHECKPOINT_APPROVED",
    "CHECKPOINT_APPROVED",
  ]);

  const after = await Promise.all(protectedPaths.map(async (path) => sha256(await readFile(join(harnessRoot, path), "utf8"))));
  assert.deepEqual(after, before, "extension assets must not modify CLI or Core dispatch files");
});
