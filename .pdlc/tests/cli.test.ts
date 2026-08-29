import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function productizationPackage(record: PocDeliveryRecord): string {
  const evidenceRefs = [record.evidence.tests, record.evidence.build, record.evidence.security, record.evidence.demo].flat().map(({ ref }) => ref);
  return `<!-- pdlc:productization-package:v1 -->
# Productization Package: ${record.title}

## Package Identity

- Source POC: \`${record.id}\`
- Source revision: \`${record.revision}\`
- Approved Requirements: \`${record.requirements.documentRef}\`
- Recommendation: \`recommend-productization\`

<!-- pdlc:section:validated-outcome -->
## Validated Outcome

- The POC met its approved success measures and is recommended for formal delivery.

<!-- pdlc:section:evidence -->
## Evidence Index

${evidenceRefs.map((ref) => `- \`${ref}\``).join("\n")}

<!-- pdlc:section:gaps -->
## Productization Gaps

- Expand production requirements, operations, security, and release readiness in the formal Delivery Flow.

<!-- pdlc:section:reuse -->
## Reuse Disposition

| Asset | Disposition | Rationale |
|---|---|---|
| Requirements | \`refine\` | Expand the validated behavior for production. |
| Design | \`replace\` | Perform formal architecture review. |
| Code | \`refine\` | Reuse only after formal engineering review. |

<!-- pdlc:section:control-handoff -->
## Risks and Control Handoff

${record.resolution.controls.applicable.map((ref) => `- \`${ref}\``).join("\n")}
${record.resolution.controls.exceptions.map((ref) => `- Exception: \`${ref}\``).join("\n")}

<!-- pdlc:section:delivery-handoff -->
## Formal Delivery Handoff

- Recommended Delivery Flow: \`implementation\`
- Generate production Requirements, design, Stories, acceptance criteria, test cases, and approved Integration work items.
- Accountable follow-up: Product starts formal requirements analysis with Developer and QA.

<!-- pdlc:productization-review:presented -->
`;
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

test("audit summary is safe when no record is active", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "lean-pdlc-audit-empty-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const result = await runCli(["audit", "summary", "--root", workspace], workspace);
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

test("parks a verified POC without requiring a Productization Package", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "lean-pdlc-park-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const record = JSON.parse(await readFile(join(projectRoot, ".pdlc/examples/poc-delivery-record.json"), "utf8")) as PocDeliveryRecord;
  record.status = "VERIFIED";
  record.requirements.status = "approved";
  record.requirements.approvedBy = "owner@example.com";
  record.requirements.approvedAt = new Date().toISOString();
  record.requirements.approvedContentHash = "a".repeat(64);
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
  record.design.summary = "A bounded, reversible design that was verified during the POC.";
  record.decision.rationale = "The POC is useful but is not a current delivery priority.";
  record.decision.followUp = "Retain the artifacts and evidence for a possible future iteration.";
  const store = new FileStateStore(workspace);
  await store.writeRecord(record);
  await store.setCurrentRecord(record.id);

  const result = await runCli(["checkpoint", "decide", "--root", workspace, "--actor", "owner@example.com", "--outcome", "park"], workspace);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  const parked = await store.readRecord(record.id);
  assert.equal(parked.status, "PARKED");
  assert.equal(parked.decision.outcome, "park");
  assert.equal(parked.decision.productizationPackage.contentHash, "");
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
    decision: {
      outcome: "",
      rationale: "The POC met its acceptance criteria.",
      followUp: "Prepare an Implementation Delivery Flow.",
      productizationPackage: { artifactType: "product-management.productization-package", documentRef: "", contentHash: "" },
    },
  };
  await store.writeRecord(prepared, approved.revision);
  for (const stage of ["implementation", "developer-verification", "security-verification", "acceptance-verification"]) {
    await applyContextReceipt(workspace, stage, "product-owner", verificationEvidence);
  }
  const verified = await runCli(["checkpoint", "verify", "--root", workspace, "--actor", "product-owner"], workspace);
  assert.equal(verified.exitCode, 0, JSON.stringify(verified.output));
  const verifiedRecord = await store.readRecord(record.id);
  assert.equal(verifiedRecord.status, "VERIFIED");

  const missingPackage = await runCli(["checkpoint", "decide", "--root", workspace, "--actor", "product-owner", "--outcome", "recommend-productization"], workspace);
  assert.equal(missingPackage.exitCode, 2);
  assert.equal((missingPackage.output as { error: { code: string } }).error.code, "BUILD_NOT_READY");

  const packageRef = `pdlc/artifacts/${record.id}/productization-package.md`;
  await mkdir(join(workspace, "pdlc", "artifacts", record.id), { recursive: true });
  await writeFile(join(workspace, packageRef), productizationPackage(verifiedRecord));

  const decided = await runCli(["checkpoint", "decide", "--root", workspace, "--actor", "product-owner", "--outcome", "recommend-productization"], workspace);
  assert.equal(decided.exitCode, 0, JSON.stringify(decided.output));
  const recommended = await store.readRecord(record.id);
  assert.equal(recommended.status, "PRODUCTIZATION_RECOMMENDED");
  assert.equal(recommended.decision.outcome, "recommend-productization");
  assert.equal(recommended.decision.productizationPackage.documentRef, packageRef);
  assert.match(recommended.decision.productizationPackage.contentHash, /^[a-f0-9]{64}$/);
  const completedEvents = await new AuditLog(workspace).readAll();
  assert.deepEqual(completedEvents.filter(({ eventType }) => eventType === "CHECKPOINT_APPROVED").map(({ checkpoint }) => checkpoint), ["commit", "verify", "decide"]);

  const auditResult = await runCli(["audit", "summary", "--root", workspace], workspace);
  assert.equal(auditResult.exitCode, 0, JSON.stringify(auditResult.output));
  const auditSummary = auditResult.output as {
    initialized: boolean;
    record: { status: string };
    headline: string;
    milestones: Array<{ id: string; state: string; label: string }>;
    timeline: Array<{ summary: string }>;
    evidence: { refs: string[] };
    controls: { pending: string[] };
    audit: { eventCount: number; warnings: string[] };
  };
  assert.equal(auditSummary.initialized, true);
  assert.equal(auditSummary.record.status, "PRODUCTIZATION_RECOMMENDED");
  assert.match(auditSummary.headline, /recommended for productization/i);
  assert.deepEqual(auditSummary.milestones.map(({ id, state }) => ({ id, state })), [
    { id: "build-readiness", state: "completed" },
    { id: "verification", state: "completed" },
    { id: "disposition", state: "completed" },
  ]);
  assert(auditSummary.timeline.some(({ summary }) => summary === "Requirements approved and Build Readiness passed"));
  assert(auditSummary.timeline.some(({ summary }) => summary === "Verification approved"));
  assert(auditSummary.timeline.some(({ summary }) => summary === "Productization recommended"));
  assert(auditSummary.evidence.refs.includes(packageRef));
  assert.deepEqual(auditSummary.controls.pending, []);
  assert.equal(auditSummary.audit.eventCount, completedEvents.length);
  assert.deepEqual(auditSummary.audit.warnings, []);
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
