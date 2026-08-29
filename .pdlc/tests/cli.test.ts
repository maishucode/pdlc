import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runCli } from "../cli.ts";
import { FileStateStore } from "../core/state.ts";
import { AuditLog } from "../core/audit.ts";
import type { PocDeliveryRecord } from "../core/types.ts";

const projectRoot = resolve(import.meta.dirname, "../..");

test("status is safe when no record is active", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "lean-pdlc-cli-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const result = await runCli(["status", "--root", workspace], workspace);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.output, {
    ok: true,
    initialized: false,
    message: "No active Delivery Record is selected",
  });
});

test("validate checks all v2 Harness assets", async () => {
  const result = await runCli(["validate"]);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  assert.equal((result.output as { ok: boolean }).ok, true);
});

test("rejects unimplemented checkpoint execution deterministically", async () => {
  const result = await runCli(["checkpoint", "commit"]);
  assert.equal(result.exitCode, 2);
  assert.equal(
    (result.output as { error: { code: string } }).error.code,
    "CHECKPOINT_NOT_IMPLEMENTED",
  );
});

test("build readiness rejects an unapproved requirements draft", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "lean-pdlc-readiness-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const record = JSON.parse(await readFile(join(projectRoot, ".pdlc/examples/poc-delivery-record.json"), "utf8")) as PocDeliveryRecord;
  const store = new FileStateStore(workspace);
  await store.writeRecord(record);
  await store.setCurrentRecord(record.id);

  const result = await runCli(["readiness", "build", "--root", workspace], workspace);
  assert.equal(result.exitCode, 2);
  assert.equal((result.output as { error: { code: string } }).error.code, "BUILD_NOT_READY");
});

test("build readiness records one approved and content-bound decision", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "lean-pdlc-approval-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const record = JSON.parse(await readFile(join(projectRoot, ".pdlc/examples/poc-delivery-record.json"), "utf8")) as PocDeliveryRecord;
  record.requirements.documentRef = "requirements.md";
  record.requirements.profile = "standard";
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
  record.design.summary = "A reversible browser-only experiment.";
  record.design.decisions = ["Use local browser state only."];
  record.design.technologies = ["web-ui", "react"];
  record.risk.triggers = ["sensitive-data"];
  record.resolution.controls.applications = [
    "product-management.requirements-quality@1.0.0",
    "security.credential-boundary@1.0.0",
    "security.sensitive-data@1.0.0",
    "solution-architecture.reversible-delivery@1.0.0",
    "ux.experience-quality@1.0.0",
  ].map((control) => ({ control, disposition: "satisfied", notes: `Apply ${control}.` }));
  await writeFile(
    join(workspace, "requirements.md"),
    await readFile(join(projectRoot, ".pdlc/tests/fixtures/ready-requirements.md"), "utf8"),
  );
  const store = new FileStateStore(workspace);
  await store.writeRecord(record);
  await store.setCurrentRecord(record.id);

  const result = await runCli(["readiness", "build", "--root", workspace, "--actor", "product-owner"], workspace);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  const approved = await store.readRecord(record.id);
  assert.equal(approved.requirements.status, "approved");
  assert.equal(approved.requirements.approvedBy, "product-owner");
  assert.equal(approved.requirements.approvedContentHash.length, 64);
  assert.deepEqual(approved.assignments, {
    product: "product-owner",
    developer: "product-owner",
    qa: "product-owner",
  });
  assert.equal(approved.idea.timebox, "1 working day");
  assert.equal((await new AuditLog(workspace).readAll())[0]?.eventType, "BUILD_READINESS_APPROVED");
});
