import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  validateArtifactDefinition,
  validateControlPolicy,
  validateDeliveryFlowCatalog,
  validateDeliveryFlowDefinition,
  validateDisciplineStageHooks,
  validateDisciplineManifest,
  validateIntegrationCatalog,
  validateIntegrationManifest,
  validateKnowledgeAsset,
  validatePocDeliveryRecord,
  validateProjectDefaultProfile,
  validateRequirementsFlowControl,
  validateRoleCatalog,
  validateStageCatalog,
  validateStageContextReceipt,
} from "../core/schema.ts";
import { validateRequirementsAnalysisRecord } from "../delivery-flows/product-requirements-analysis/record-validator.ts";

const projectRoot = resolve(import.meta.dirname, "../..");
async function json(path: string): Promise<unknown> { return JSON.parse(await readFile(path, "utf8")) as unknown; }

test("enforces the Harness and project workspace ownership boundary", async () => {
  await Promise.all([
    access(join(projectRoot, ".pdlc/package.json")),
    access(join(projectRoot, ".pdlc/bun.lock")),
    access(join(projectRoot, ".pdlc/tsconfig.json")),
    access(join(projectRoot, ".pdlc/core")),
    access(join(projectRoot, "pdlc/records/.gitkeep")),
    access(join(projectRoot, "pdlc/audit/.gitkeep")),
    access(join(projectRoot, ".pdlc/integrations/catalog.json")),
    access(join(projectRoot, "pdlc/disciplines/.gitkeep")),
    access(join(projectRoot, "pdlc/requirements/.gitkeep")),
    access(join(projectRoot, "pdlc/evidence/.gitkeep")),
    access(join(projectRoot, "pdlc/artifacts/.gitkeep")),
  ]);
  await Promise.all([
    assert.rejects(access(join(projectRoot, "pdlc/core"))),
    assert.rejects(access(join(projectRoot, "pdlc/config"))),
    assert.rejects(access(join(projectRoot, ".pdlc/config"))),
    assert.rejects(access(join(projectRoot, ".pdlc/disciplines/ux/capabilities"))),
    assert.rejects(access(join(projectRoot, ".pdlc/disciplines/ux/controls"))),
    assert.rejects(access(join(projectRoot, "pdlc/.state"))),
  ]);
});

test("keeps the Runner entry point as a thin composition root", async () => {
  const cli = await readFile(join(projectRoot, ".pdlc/cli.ts"), "utf8");
  assert(cli.split("\n").length < 150, "CLI orchestration should stay compact");
  assert.doesNotMatch(cli, /\.\/core\/[^"\n]*-registry\.ts/);
  assert.doesNotMatch(cli, /createStageContextSnapshot/);
  assert.match(cli, /\.\/commands\/context\.ts/);
  assert.match(cli, /\.\/commands\/validate\.ts/);
  assert.match(cli, /\.\/core\/flow-engine\.ts/);
  assert.doesNotMatch(cli, /deliveryFlow\s*[!=]==?\s*["']/);
  assert.doesNotMatch(cli, /product-requirements-analysis|deliveryFlow.*poc/);
});

test("validates the canonical POC Delivery Record", async () => {
  assert.equal(validatePocDeliveryRecord(await json(join(projectRoot, ".pdlc/examples/poc-delivery-record.json"))).ok, true);
});

test("validates the canonical Requirements Analysis Delivery Record", async () => {
  const result = validateRequirementsAnalysisRecord(await json(join(projectRoot, ".pdlc/examples/requirements-analysis-record.json")));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("requires evidence when a Stage Context asset is declared used", () => {
  const result = validateStageContextReceipt({
    schemaVersion: 1,
    stage: "requirements-clarification",
    contextHash: "a".repeat(64),
    policies: [],
    knowledge: [{ ref: "product-management.requirements-writing@1.0.0", disposition: "used", notes: "Consulted it.", evidenceRefs: [] }],
    disciplineContributions: [],
    integrations: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.issues.some(({ code }) => code === "TOO_FEW_ITEMS"));
});

test("rejects production use in a POC", async () => {
  const value = await json(join(projectRoot, ".pdlc/examples/poc-delivery-record.json")) as Record<string, unknown>;
  (value.scope as Record<string, unknown>).productionUse = true;
  const result = validatePocDeliveryRecord(value);
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.issues.some(({ code }) => code === "POC_PRODUCTION_FORBIDDEN"));
});

test("keeps terminal POC status and outcome consistent", async () => {
  const value = await json(join(projectRoot, ".pdlc/examples/poc-delivery-record.json")) as Record<string, unknown>;
  value.status = "PARKED";
  const result = validatePocDeliveryRecord(value);
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.issues.some(({ code }) => code === "OUTCOME_STATUS_MISMATCH"));
});

test("validates the explicit Delivery Flow Catalog and registered Flows", async () => {
  assert.equal(validateDeliveryFlowCatalog(await json(join(projectRoot, ".pdlc/delivery-flows/catalog.json"))).ok, true);
  const stages = validateStageCatalog(await json(join(projectRoot, ".pdlc/stages/catalog.json")));
  assert.equal(stages.ok, true, JSON.stringify(stages.issues));
  if (stages.ok) assert.equal(stages.value.stages.length, 29);
  for (const id of ["poc", "product-requirements-analysis", "implementation", "pdlc"]) {
    const result = validateDeliveryFlowDefinition(await json(join(projectRoot, `.pdlc/delivery-flows/${id}/flow.json`)));
    assert.equal(result.ok, true, `${id}: ${JSON.stringify(result.issues)}`);
  }
});

test("allows Flow-owned delivery controls without changing the base schema", async () => {
  const value = await json(join(projectRoot, ".pdlc/delivery-flows/poc/flow.json")) as {
    controls: { deliveryDefaults: { roleAssignmentMode: string; collectDuringRequirements: boolean } };
  };
  value.controls.deliveryDefaults.roleAssignmentMode = "explicit-role-assignment";
  value.controls.deliveryDefaults.collectDuringRequirements = true;
  const result = validateDeliveryFlowDefinition(value);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("rejects duplicate, unreachable, and dead-end Delivery Flow transitions", async () => {
  const duplicate = await json(join(projectRoot, ".pdlc/delivery-flows/poc/flow.json")) as {
    controls: { checkpoints: Array<Record<string, unknown>>; terminalStatuses: string[] };
  };
  duplicate.controls.checkpoints.push({ ...duplicate.controls.checkpoints[0] });
  const duplicateResult = validateDeliveryFlowDefinition(duplicate);
  assert.equal(duplicateResult.ok, false);
  if (!duplicateResult.ok) assert(duplicateResult.issues.some(({ code }) => code === "DUPLICATE_CHECKPOINT"));

  const unreachable = await json(join(projectRoot, ".pdlc/delivery-flows/poc/flow.json")) as {
    controls: { checkpoints: Array<Record<string, unknown>>; terminalStatuses: string[] };
  };
  unreachable.controls.terminalStatuses.push("UNREACHABLE");
  const unreachableResult = validateDeliveryFlowDefinition(unreachable);
  assert.equal(unreachableResult.ok, false);
  if (!unreachableResult.ok) assert(unreachableResult.issues.some(({ code }) => code === "UNREACHABLE_TERMINAL_STATUS"));

  const deadEnd = await json(join(projectRoot, ".pdlc/delivery-flows/poc/flow.json")) as {
    controls: { checkpoints: Array<Record<string, unknown>> };
  };
  deadEnd.controls.checkpoints.push({ id: "abandon", from: ["DRAFT"], to: "ABANDONED", ownerRole: "product" });
  const deadEndResult = validateDeliveryFlowDefinition(deadEnd);
  assert.equal(deadEndResult.ok, false);
  if (!deadEndResult.ok) assert(deadEndResult.issues.some(({ code }) => code === "DEAD_END_STATUS"));
});

test("validates the explicit Role Catalog", async () => {
  const result = validateRoleCatalog(await json(join(projectRoot, ".pdlc/roles/catalog.json")));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  if (result.ok) assert.deepEqual(result.value.roles.map(({ id }) => id), ["product", "developer", "qa"]);
});

test("validates representative Discipline assets", async () => {
  assert.equal(validateDisciplineManifest(await json(join(projectRoot, ".pdlc/disciplines/ux/discipline.json"))).ok, true);
  assert.equal(validateArtifactDefinition(await json(join(projectRoot, ".pdlc/disciplines/product-management/artifacts/requirements/artifact.json"))).ok, true);
  assert.equal(validateArtifactDefinition(await json(join(projectRoot, ".pdlc/disciplines/product-management/artifacts/productization-package/artifact.json"))).ok, true);
  assert.equal(validateArtifactDefinition(await json(join(projectRoot, ".pdlc/disciplines/product-management/artifacts/sprint-scope/artifact.json"))).ok, true);
  assert.equal(validateArtifactDefinition(await json(join(projectRoot, ".pdlc/disciplines/product-management/artifacts/change-proposal/artifact.json"))).ok, true);
  assert.equal(validateControlPolicy(await json(join(projectRoot, ".pdlc/disciplines/ux/policies/experience-quality.policy.json"))).ok, true);
  assert.equal(validateKnowledgeAsset(await json(join(projectRoot, ".pdlc/disciplines/data-platform/knowledge/kb/databricks-connectivity.json"))).ok, true);
  assert.equal(validateKnowledgeAsset(await json(join(projectRoot, ".pdlc/examples/project-overlay/pdlc/disciplines/solution-architecture/knowledge/guidance/system-context.json"))).ok, true);
  assert.equal(validateDisciplineStageHooks(await json(join(projectRoot, ".pdlc/disciplines/ux/hooks/stages.json"))).ok, true);
  assert.equal(validateIntegrationCatalog(await json(join(projectRoot, ".pdlc/integrations/catalog.json"))).ok, true);
  assert.equal(validateIntegrationManifest(await json(join(projectRoot, ".pdlc/integrations/databricks/integration.json"))).ok, true);
});

test("validates the Requirements Flow Control", async () => {
  const result = validateRequirementsFlowControl(await json(join(projectRoot, ".pdlc/delivery-flows/poc/controls/requirements.json")));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  if (result.ok) {
    assert.equal(result.value.artifactType, "product-management.requirements");
    assert.equal(result.value.questionRules.maxQuestionsPerRound, 3);
  }
});

test("rejects Requirements Flow Controls that exceed the conversational batch limit", async () => {
  const value = await json(join(projectRoot, ".pdlc/delivery-flows/poc/controls/requirements.json")) as Record<string, unknown>;
  (value.questionRules as Record<string, unknown>).maxQuestionsPerRound = 4;
  const result = validateRequirementsFlowControl(value);
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.issues.some(({ code }) => code === "INVALID_QUESTION_LIMIT"));
});

test("validates project-specific Discipline defaults and rejects duplicate keys", async () => {
  const path = join(projectRoot, ".pdlc/tests/fixtures/project-web-ui-standard.json");
  const value = await json(path) as Record<string, unknown>;
  assert.equal(validateProjectDefaultProfile(value).ok, true);
  (value.defaults as unknown[]).push(structuredClone((value.defaults as unknown[])[0]));
  const duplicate = validateProjectDefaultProfile(value);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert(duplicate.issues.some(({ code }) => code === "DUPLICATE_STANDARD_KEY"));
});

test("keeps the Requirements questionnaire under the owning Artifact", async () => {
  const template = await readFile(join(projectRoot, ".pdlc/disciplines/product-management/artifacts/requirements/templates/questions.md"), "utf8");
  assert(template.includes("[Answer]:"));
  assert(template.includes("Product role"));
});

test("keeps UX clarification options selectable", async () => {
  const sources = await Promise.all([
    readFile(join(projectRoot, ".agents/skills/lean-pdlc/SKILL.md"), "utf8"),
    readFile(join(projectRoot, ".pdlc/disciplines/ux/skills/lean-pdlc-ux-spec/SKILL.md"), "utf8"),
  ]);
  for (const source of sources) {
    assert.match(source, /2[–-]4 mutually exclusive, selectable options/i);
    assert.match(source, /X\) Other/i);
    assert.match(source, /(?:must not|do not) ask an open-ended question as the primary answer/i);
  }
});

test("keeps fresh POC activation on the fast-start path", async () => {
  const skill = await readFile(join(projectRoot, ".agents/skills/lean-pdlc/SKILL.md"), "utf8");
  assert.match(skill, /Fast start and just-in-time loading/);
  assert.match(skill, /one read-only `context requirements-clarification` Runner call/);
  assert.match(skill, /Do not run full Harness `validate` before the first clarification round/);
  assert.match(skill, /Do not invoke `context` for Ideation, Design, Build, Verification, or any other future Stage in advance/);
  assert.match(skill, /Fast start changes scheduling, never governance strength/);
});

test("allows incomplete business fields while Requirements remain draft", async () => {
  const value = await json(join(projectRoot, ".pdlc/examples/poc-delivery-record.json")) as Record<string, unknown>;
  const idea = value.idea as Record<string, unknown>;
  idea.hypothesis = "";
  idea.successCriteria = [];
  idea.timebox = "";
  assert.equal(validatePocDeliveryRecord(value).ok, true);
});
