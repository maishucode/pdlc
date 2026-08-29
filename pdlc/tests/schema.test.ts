import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  validateArtifactDefinition,
  validateControlPolicy,
  validateDeliveryFlowCatalog,
  validateDeliveryFlowDefinition,
  validateDomainManifest,
  validateKnowledgeAsset,
  validatePluginManifest,
  validatePocDeliveryRecord,
  validateProjectDefaultProfile,
  validateRequirementsFlowControl,
  validateStageCatalog,
} from "../core/schema.ts";

const projectRoot = resolve(import.meta.dirname, "../..");
async function json(path: string): Promise<unknown> { return JSON.parse(await readFile(path, "utf8")) as unknown; }

test("validates the canonical v2 Delivery Record", async () => {
  assert.equal(validatePocDeliveryRecord(await json(join(projectRoot, "pdlc/examples/poc-delivery-record.json"))).ok, true);
});

test("rejects production use in a POC", async () => {
  const value = await json(join(projectRoot, "pdlc/examples/poc-delivery-record.json")) as Record<string, unknown>;
  (value.scope as Record<string, unknown>).productionUse = true;
  const result = validatePocDeliveryRecord(value);
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.issues.some(({ code }) => code === "POC_PRODUCTION_FORBIDDEN"));
});

test("validates the explicit Delivery Flow Catalog and registered Flows", async () => {
  assert.equal(validateDeliveryFlowCatalog(await json(join(projectRoot, "pdlc/delivery-flows/catalog.json"))).ok, true);
  const stages = validateStageCatalog(await json(join(projectRoot, "pdlc/stages/catalog.json")));
  assert.equal(stages.ok, true, JSON.stringify(stages.issues));
  if (stages.ok) assert.equal(stages.value.stages.length, 29);
  for (const id of ["poc", "implementation", "pdlc"]) {
    const result = validateDeliveryFlowDefinition(await json(join(projectRoot, `pdlc/delivery-flows/${id}/flow.json`)));
    assert.equal(result.ok, true, `${id}: ${JSON.stringify(result.issues)}`);
  }
});

test("validates representative Domain assets", async () => {
  assert.equal(validateDomainManifest(await json(join(projectRoot, "pdlc/domains/ux/domain.json"))).ok, true);
  assert.equal(validateArtifactDefinition(await json(join(projectRoot, "pdlc/domains/product-management/artifacts/requirements/artifact.json"))).ok, true);
  assert.equal(validateControlPolicy(await json(join(projectRoot, "pdlc/domains/ux/controls/experience-quality.policy.json"))).ok, true);
  assert.equal(validateKnowledgeAsset(await json(join(projectRoot, "pdlc/domains/data-platform/knowledge/kb/databricks-connectivity.json"))).ok, true);
  assert.equal(validatePluginManifest(await json(join(projectRoot, "pdlc/domains/ux/capabilities/plugins/lean-pdlc-ux/plugin.json"))).ok, true);
});

test("validates the Requirements Flow Control", async () => {
  const result = validateRequirementsFlowControl(await json(join(projectRoot, "pdlc/delivery-flows/poc/controls/requirements.json")));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  if (result.ok) {
    assert.equal(result.value.artifactType, "product-management.requirements");
    assert.equal(result.value.questionRules.maxQuestionsPerRound, 3);
  }
});

test("rejects Requirements Flow Controls that exceed the conversational batch limit", async () => {
  const value = await json(join(projectRoot, "pdlc/delivery-flows/poc/controls/requirements.json")) as Record<string, unknown>;
  (value.questionRules as Record<string, unknown>).maxQuestionsPerRound = 4;
  const result = validateRequirementsFlowControl(value);
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.issues.some(({ code }) => code === "INVALID_QUESTION_LIMIT"));
});

test("validates project-specific Domain defaults and rejects duplicate keys", async () => {
  const path = join(projectRoot, "pdlc/tests/fixtures/project-web-ui-standard.json");
  const value = await json(path) as Record<string, unknown>;
  assert.equal(validateProjectDefaultProfile(value).ok, true);
  (value.defaults as unknown[]).push(structuredClone((value.defaults as unknown[])[0]));
  const duplicate = validateProjectDefaultProfile(value);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert(duplicate.issues.some(({ code }) => code === "DUPLICATE_STANDARD_KEY"));
});

test("keeps the Requirements questionnaire under the owning Artifact", async () => {
  const template = await readFile(join(projectRoot, "pdlc/domains/product-management/artifacts/requirements/templates/questions.md"), "utf8");
  assert(template.includes("[Answer]:"));
  assert(template.includes("Product role"));
});

test("keeps UX clarification options selectable", async () => {
  const sources = await Promise.all([
    readFile(join(projectRoot, ".agents/skills/lean-pdlc/SKILL.md"), "utf8"),
    readFile(join(projectRoot, "pdlc/domains/ux/capabilities/plugins/lean-pdlc-ux/skills/lean-pdlc-ux-spec/SKILL.md"), "utf8"),
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
  const value = await json(join(projectRoot, "pdlc/examples/poc-delivery-record.json")) as Record<string, unknown>;
  const idea = value.idea as Record<string, unknown>;
  idea.hypothesis = "";
  idea.successCriteria = [];
  idea.timebox = "";
  assert.equal(validatePocDeliveryRecord(value).ok, true);
});
