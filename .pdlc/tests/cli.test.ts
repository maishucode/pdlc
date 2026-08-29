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

interface ContextOutput {
  contextHash: string;
  controls: Array<{ ref: string }>;
  knowledge: Array<{ ref: string }>;
  domainContributions: Array<{ domain: string; version: string; agent: { id: string }; skills: Array<{ name: string }> }>;
  integrations: Array<{ ref: string; skills: Array<{ id: string }> }>;
}

async function applyContextReceipt(workspace: string, stage: string, actor = "pdlc-agent", evidenceRefs = ["requirements.md"]): Promise<void> {
  const context = await runCli(["context", stage, "--root", workspace], workspace);
  assert.equal(context.exitCode, 0, JSON.stringify(context.output));
  const output = context.output as ContextOutput;
  const receipt = {
    schemaVersion: 1,
    stage,
    contextHash: output.contextHash,
    policies: output.controls.map(({ ref }) => ({ ref, notes: `Applied ${ref} while performing ${stage}.` })),
    knowledge: output.knowledge.map(({ ref }) => ({ ref, disposition: "used", notes: `Consulted ${ref}.`, evidenceRefs })),
    domainContributions: output.domainContributions.map(({ domain, version, agent, skills }) => ({
      ref: `${domain}@${version}:${agent.id}`,
      agent: agent.id,
      skills: skills.map(({ name }) => name),
      disposition: "used",
      notes: `Executed ${agent.id} guidance for ${stage}.`,
      evidenceRefs,
    })),
    integrations: output.integrations.map(({ ref, skills }) => ({ ref, skills: skills.map(({ id }) => id), disposition: "used", notes: `Used ${ref}.`, evidenceRefs })),
  };
  const receiptPath = `receipt-${stage}.json`;
  await writeFile(join(workspace, receiptPath), JSON.stringify(receipt));
  const applied = await runCli(["context-apply", stage, "--root", workspace, "--receipt", receiptPath, "--actor", actor], workspace);
  assert.equal(applied.exitCode, 0, JSON.stringify(applied.output));
}

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

test("explains that Commit is owned by Build Readiness", async () => {
  const result = await runCli(["checkpoint", "commit"]);
  assert.equal(result.exitCode, 2);
  assert.equal(
    (result.output as { error: { code: string } }).error.code,
    "INVALID_ARGUMENT",
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
  ].map((control) => ({ control, disposition: "satisfied", notes: `Apply ${control}.`, evidenceRefs: ["requirements.md"], approvedBy: "product-owner" }));
  await writeFile(
    join(workspace, "requirements.md"),
    await readFile(join(projectRoot, ".pdlc/tests/fixtures/ready-requirements.md"), "utf8"),
  );
  const store = new FileStateStore(workspace);
  await store.writeRecord(record);
  await store.setCurrentRecord(record.id);

  await applyContextReceipt(workspace, "requirements-clarification");
  await applyContextReceipt(workspace, "build-readiness");

  const result = await runCli(["readiness", "build", "--root", workspace, "--actor", "product-owner"], workspace);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  const approved = await store.readRecord(record.id);
  assert.equal(approved.status, "COMMITTED");
  assert.equal(approved.requirements.status, "approved");
  assert.equal(approved.requirements.approvedBy, "product-owner");
  assert.equal(approved.requirements.approvedContentHash.length, 64);
  assert.deepEqual(approved.assignments, {
    product: "product-owner",
    developer: "product-owner",
    qa: "product-owner",
  });
  assert.equal(approved.idea.timebox, "1 working day");
  const events = await new AuditLog(workspace).readAll();
  assert.deepEqual(events.map(({ eventType }) => eventType), ["STAGE_CONTEXT_APPLIED", "STAGE_CONTEXT_APPLIED", "CHECKPOINT_APPROVED"]);
  assert.deepEqual(events.at(-1) && { checkpoint: events.at(-1)?.checkpoint, from: events.at(-1)?.fromStatus, to: events.at(-1)?.toStatus }, { checkpoint: "commit", from: "DRAFT", to: "COMMITTED" });

  const verificationEvidence = ["evidence/tests.txt", "evidence/build.txt", "evidence/security.txt", "evidence/demo.txt"];
  const prepared: PocDeliveryRecord = {
    ...approved,
    revision: approved.revision + 1,
    updatedAt: new Date().toISOString(),
    resolution: {
      ...approved.resolution,
      controls: {
        ...approved.resolution.controls,
        applications: approved.resolution.controls.applications.map((application) => ({ ...application, evidenceRefs: [...new Set([...application.evidenceRefs, ...verificationEvidence])] })),
      },
    },
    evidence: {
      tests: [{ kind: "file", ref: verificationEvidence[0], description: "Passing test output." }],
      build: [{ kind: "file", ref: verificationEvidence[1], description: "Successful production build." }],
      security: [{ kind: "file", ref: verificationEvidence[2], description: "Sensitive-data verification." }],
      demo: [{ kind: "demo", ref: verificationEvidence[3], description: "Browser acceptance demonstration." }],
    },
    decision: { outcome: "", rationale: "The POC met its acceptance criteria.", followUp: "Prepare an Implementation Delivery Flow." },
  };
  await store.writeRecord(prepared, approved.revision);
  for (const stage of ["implementation", "developer-verification", "security-verification", "acceptance-verification"]) {
    await applyContextReceipt(workspace, stage, "product-owner", verificationEvidence);
  }
  const verified = await runCli(["checkpoint", "verify", "--root", workspace, "--actor", "product-owner"], workspace);
  assert.equal(verified.exitCode, 0, JSON.stringify(verified.output));
  assert.equal((await store.readRecord(record.id)).status, "VERIFIED");

  const decided = await runCli(["checkpoint", "decide", "--root", workspace, "--actor", "product-owner", "--outcome", "productize"], workspace);
  assert.equal(decided.exitCode, 0, JSON.stringify(decided.output));
  const closed = await store.readRecord(record.id);
  assert.equal(closed.status, "CLOSED_PRODUCTIZED");
  assert.equal(closed.decision.outcome, "productize");
  const completedEvents = await new AuditLog(workspace).readAll();
  assert.deepEqual(completedEvents.filter(({ eventType }) => eventType === "CHECKPOINT_APPROVED").map(({ checkpoint }) => checkpoint), ["commit", "verify", "decide"]);
});

test("resolves Stage context without writing runtime state and rejects stale receipts", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "lean-pdlc-context-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const result = await runCli(["context", "requirements-clarification", "--root", workspace], workspace);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  assert.deepEqual((result.output as { roles: Array<{ id: string }> }).roles.map(({ id }) => id), ["product", "developer", "qa"]);
  await assert.rejects(readFile(join(workspace, ".pdlc/runtime/current"), "utf8"));

  const record = JSON.parse(await readFile(join(projectRoot, ".pdlc/examples/poc-delivery-record.json"), "utf8")) as PocDeliveryRecord;
  const store = new FileStateStore(workspace);
  await store.writeRecord(record);
  await store.setCurrentRecord(record.id);
  const output = result.output as ContextOutput;
  const receiptPath = "stale-receipt.json";
  await writeFile(join(workspace, receiptPath), JSON.stringify({ schemaVersion: 1, stage: "requirements-clarification", contextHash: output.contextHash.replace(/^./, output.contextHash.startsWith("a") ? "b" : "a"), policies: [], knowledge: [], domainContributions: [], integrations: [] }));
  const applied = await runCli(["context-apply", "requirements-clarification", "--root", workspace, "--receipt", receiptPath, "--actor", "pdlc-agent"], workspace);
  assert.equal(applied.exitCode, 2);
  assert.equal((applied.output as { error: { code: string } }).error.code, "CONTEXT_RECEIPT_INVALID");
});
