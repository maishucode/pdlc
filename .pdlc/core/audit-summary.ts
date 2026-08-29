import type { AuditEvent, PocDeliveryRecord } from "./types.ts";
import { currentPocStage } from "./poc-progress.ts";

export type AuditMilestoneState = "pending" | "completed" | "not-recorded";

export interface AuditMilestoneSummary {
  id: "build-readiness" | "verification" | "disposition";
  label: string;
  state: AuditMilestoneState;
  actor?: string;
  timestamp?: string;
  evidenceRefs: string[];
}

export interface ReadableAuditEvent {
  eventId: string;
  timestamp: string;
  summary: string;
  actor: string;
  eventType: string;
  stage?: string;
  checkpoint?: string;
  transition?: { from: string; to: string };
  decision?: string;
  evidenceRefs: string[];
}

export interface PocAuditSummary {
  record: {
    id: string;
    title: string;
    deliveryFlow: string;
    status: PocDeliveryRecord["status"];
    stage: string;
    revision: number;
    updatedAt: string;
  };
  headline: string;
  milestones: AuditMilestoneSummary[];
  timeline: ReadableAuditEvent[];
  evidence: { count: number; refs: string[] };
  controls: {
    applicable: string[];
    satisfied: string[];
    exceptions: string[];
    pending: string[];
  };
  decision: {
    outcome: PocDeliveryRecord["decision"]["outcome"];
    rationale: string;
    followUp: string;
    productizationPackage?: { documentRef: string; contentHash: string };
  };
  audit: {
    eventCount: number;
    firstEventAt?: string;
    latestEventAt?: string;
    warnings: string[];
  };
}

function headline(record: PocDeliveryRecord): string {
  if (record.status === "PARKED") return `${record.id} is parked; its artifacts and evidence remain available for future work.`;
  if (record.status === "PRODUCTIZATION_RECOMMENDED") return `${record.id} is recommended for productization through a new formal Delivery Flow.`;
  if (record.status === "VERIFIED") return `${record.id} is verified and awaiting a Park or Recommend Productization decision.`;
  if (record.status === "COMMITTED") return `${record.id} passed Build Readiness and is in implementation or verification.`;
  return `${record.id} is in requirements clarification and has not passed Build Readiness.`;
}

function latestCheckpoint(events: readonly AuditEvent[], checkpoint: string): AuditEvent | undefined {
  return [...events].reverse().find((event) => event.eventType === "CHECKPOINT_APPROVED" && event.checkpoint === checkpoint);
}

function milestone(
  id: AuditMilestoneSummary["id"],
  label: string,
  event: AuditEvent | undefined,
  recordIndicatesCompletion: boolean,
): AuditMilestoneSummary {
  return {
    id,
    label,
    state: event ? "completed" : recordIndicatesCompletion ? "not-recorded" : "pending",
    actor: event?.actor,
    timestamp: event?.timestamp,
    evidenceRefs: event?.evidenceRefs ?? [],
  };
}

function readableEvent(event: AuditEvent): ReadableAuditEvent {
  let summary: string;
  if (event.eventType === "STAGE_CONTEXT_APPLIED") {
    summary = `Stage context applied: ${event.stage ?? "unknown stage"}`;
  } else if (event.eventType === "CHECKPOINT_APPROVED" && event.checkpoint === "commit") {
    summary = event.fromStatus === "COMMITTED"
      ? "Requirements revision approved and Build Readiness passed again"
      : "Requirements approved and Build Readiness passed";
  } else if (event.eventType === "CHECKPOINT_APPROVED" && event.checkpoint === "verify") {
    summary = "Verification approved";
  } else if (event.eventType === "CHECKPOINT_APPROVED" && event.checkpoint === "decide") {
    summary = event.decision === "park" ? "POC parked" : event.decision === "recommend-productization" ? "Productization recommended" : "POC disposition approved";
  } else if (event.eventType === "DELIVERY_FLOW_CREATED") {
    summary = "Delivery Flow record created";
  } else {
    summary = event.eventType.toLowerCase().replaceAll("_", " ");
  }
  return {
    eventId: event.eventId,
    timestamp: event.timestamp,
    summary,
    actor: event.actor,
    eventType: event.eventType,
    stage: event.stage,
    checkpoint: event.checkpoint,
    transition: event.fromStatus && event.toStatus ? { from: event.fromStatus, to: event.toStatus } : undefined,
    decision: event.decision,
    evidenceRefs: event.evidenceRefs ?? [],
  };
}

export function buildPocAuditSummary(record: PocDeliveryRecord, allEvents: readonly AuditEvent[]): PocAuditSummary {
  const events = allEvents.filter(({ recordId }) => recordId === record.id);
  const commit = latestCheckpoint(events, "commit");
  const verify = latestCheckpoint(events, "verify");
  const decide = latestCheckpoint(events, "decide");
  const buildComplete = record.status !== "DRAFT" || record.requirements.status === "approved";
  const verificationComplete = ["VERIFIED", "PARKED", "PRODUCTIZATION_RECOMMENDED"].includes(record.status);
  const dispositionComplete = ["PARKED", "PRODUCTIZATION_RECOMMENDED"].includes(record.status);
  const milestones = [
    milestone("build-readiness", "Requirements approved and Build Readiness passed", commit, buildComplete),
    milestone("verification", "Verification approved", verify, verificationComplete),
    milestone(
      "disposition",
      decide?.decision === "park" ? "POC parked" : decide?.decision === "recommend-productization" ? "Productization recommended" : "POC disposition approved",
      decide,
      dispositionComplete,
    ),
  ];
  const warnings = milestones
    .filter(({ state }) => state === "not-recorded")
    .map(({ label }) => `Delivery Record indicates completion, but no matching audit event was found: ${label}`);
  if (decide?.decision && decide.decision !== record.decision.outcome) {
    warnings.push(`Latest audited decision '${decide.decision}' does not match Delivery Record outcome '${record.decision.outcome}'.`);
  }
  const evidenceRefs = [...new Set(events.flatMap(({ evidenceRefs = [] }) => evidenceRefs))].sort();
  const appliedControls = new Set(record.resolution.controls.applications.map(({ control }) => control));
  const satisfiedControls = [...new Set(record.resolution.controls.applications
    .filter(({ disposition }) => disposition === "satisfied")
    .map(({ control }) => control))];
  const productizationPackage = record.decision.productizationPackage.contentHash
    ? {
      documentRef: record.decision.productizationPackage.documentRef,
      contentHash: record.decision.productizationPackage.contentHash,
    }
    : undefined;
  return {
    record: {
      id: record.id,
      title: record.title,
      deliveryFlow: record.deliveryFlow,
      status: record.status,
      stage: currentPocStage(record),
      revision: record.revision,
      updatedAt: record.updatedAt,
    },
    headline: headline(record),
    milestones,
    timeline: events.map(readableEvent),
    evidence: { count: evidenceRefs.length, refs: evidenceRefs },
    controls: {
      applicable: record.resolution.controls.applicable,
      satisfied: satisfiedControls,
      exceptions: record.resolution.controls.exceptions,
      pending: record.resolution.controls.applicable.filter((control) => !appliedControls.has(control)),
    },
    decision: {
      outcome: record.decision.outcome,
      rationale: record.decision.rationale,
      followUp: record.decision.followUp,
      productizationPackage,
    },
    audit: {
      eventCount: events.length,
      firstEventAt: events[0]?.timestamp,
      latestEventAt: events.at(-1)?.timestamp,
      warnings,
    },
  };
}
