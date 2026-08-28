import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  validatePocDeliveryRecord,
  validateJourneyDefinition,
  validatePrinciplePack,
  validateRequirementsPolicy,
  validateStageCatalog,
  validateStandardProfile,
} from "../core/schema.ts";

const projectRoot = resolve(import.meta.dirname, "../..");

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

test("validates the canonical POC example", async () => {
  const value = await json(join(projectRoot, "pdlc/examples/poc-delivery-record.json"));
  const result = validatePocDeliveryRecord(value);
  assert.equal(result.ok, true);
});

test("rejects production use in a POC", async () => {
  const value = await json(join(projectRoot, "pdlc/examples/poc-delivery-record.json")) as Record<string, unknown>;
  const scope = value.scope as Record<string, unknown>;
  scope.productionUse = true;
  const result = validatePocDeliveryRecord(value);
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.issues.some((issue) => issue.code === "POC_PRODUCTION_FORBIDDEN"));
});

test("validates every bundled Principle Pack", async () => {
  for (const area of ["security", "solution-architecture", "ux"]) {
    const value = await json(join(projectRoot, `pdlc/principles/${area}/pack.json`));
    const result = validatePrinciplePack(value);
    assert.equal(result.ok, true, `${area}: ${JSON.stringify(result.issues)}`);
  }
});

test("validates the canonical Stage Catalog and every User Journey", async () => {
  const catalog = validateStageCatalog(await json(join(projectRoot, "pdlc/stages/catalog.json")));
  assert.equal(catalog.ok, true, JSON.stringify(catalog.issues));
  if (catalog.ok) assert.equal(catalog.value.stages.length, 30);

  for (const id of ["poc", "implementation", "pdlc"]) {
    const journey = validateJourneyDefinition(await json(join(projectRoot, `pdlc/journeys/${id}.json`)));
    assert.equal(journey.ok, true, `${id}: ${JSON.stringify(journey.issues)}`);
  }
});

test("validates the POC requirements clarification policy", async () => {
  const value = await json(join(projectRoot, "pdlc/workflows/poc/requirements-policy.json"));
  const result = validateRequirementsPolicy(value);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  if (result.ok) {
    assert.equal(result.value.questionRules.maxQuestionsPerRound, 3);
    assert.equal(result.value.questionRules.allowDocumentAnswers, true);
    assert.equal(result.value.questionRules.answerTag, "[Answer]:");
  }
});

test("validates Harness and project standard profiles", async () => {
  for (const path of [
    join(projectRoot, "pdlc/defaults/harness/poc-web-ui.json"),
    join(projectRoot, "pdlc/tests/fixtures/project-web-ui-standard.json"),
  ]) {
    const result = validateStandardProfile(await json(path));
    assert.equal(result.ok, true, `${path}: ${JSON.stringify(result.issues)}`);
  }
});

test("rejects duplicate standard keys inside one profile", async () => {
  const value = await json(join(projectRoot, "pdlc/defaults/harness/poc-web-ui.json")) as Record<string, unknown>;
  const defaults = value.defaults as unknown[];
  defaults.push(structuredClone(defaults[0]));
  const result = validateStandardProfile(value);
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.issues.some((issue) => issue.code === "DUPLICATE_STANDARD_KEY"));
});

test("provides a fillable POC requirements questionnaire", async () => {
  const template = await readFile(join(projectRoot, "pdlc/templates/poc-requirements-questions.md"), "utf8");
  assert(template.includes("<!-- pdlc:poc-requirements-questions:v1 -->"));
  assert(template.includes("X) Other"));
  assert(template.includes("[Answer]:"));
});

test("rejects requirements policies that exceed the chat batch limit", async () => {
  const value = await json(join(projectRoot, "pdlc/workflows/poc/requirements-policy.json")) as Record<string, unknown>;
  const questionRules = value.questionRules as Record<string, unknown>;
  questionRules.maxQuestionsPerRound = 4;
  const result = validateRequirementsPolicy(value);
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.issues.some((issue) => issue.code === "INVALID_QUESTION_LIMIT"));
});

test("allows incomplete business fields while requirements remain draft", async () => {
  const value = await json(join(projectRoot, "pdlc/examples/poc-delivery-record.json")) as Record<string, unknown>;
  const idea = value.idea as Record<string, unknown>;
  idea.hypothesis = "";
  idea.successCriteria = [];
  idea.timebox = "";
  const result = validatePocDeliveryRecord(value);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});
