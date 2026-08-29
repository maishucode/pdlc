import type { PocDeliveryRecord } from "./types.ts";

export const POC_SECURITY_RISK_TRIGGERS = [
  "sensitive-data",
  "external-access",
  "credentials",
  "regulated-data",
] as const;
const SECURITY_RISK_TRIGGER_SET = new Set<string>(POC_SECURITY_RISK_TRIGGERS);

export function currentPocStage(record: PocDeliveryRecord): string {
  if (record.status === "DRAFT") {
    const clarificationComplete = Object.values(record.requirements.clarification.coverage).every((status) => status === "complete")
      && record.requirements.clarification.openQuestions.length === 0
      && record.requirements.clarification.contradictions.length === 0;
    if (!clarificationComplete) return "requirements-clarification";
    if (!record.design.summary.trim()) return "solution-design";
    return "build-readiness";
  }
  if (record.status === "COMMITTED") {
    if (record.evidence.tests.length === 0 || record.evidence.build.length === 0) return "implementation";
    if (requiresSecurityVerification(record) && record.evidence.security.length === 0) return "security-verification";
    return "acceptance-verification";
  }
  return "outcome-review-and-disposition";
}

export function requiresSecurityVerification(record: PocDeliveryRecord): boolean {
  return record.risk.triggers.some((trigger) => SECURITY_RISK_TRIGGER_SET.has(trigger));
}

export function buildReadinessContextStages(): string[] {
  return ["requirements-clarification", "build-readiness"];
}

export function verificationContextStages(record: PocDeliveryRecord): string[] {
  return [
    ...buildReadinessContextStages(),
    "implementation",
    "developer-verification",
    ...(requiresSecurityVerification(record) ? ["security-verification"] : []),
    "acceptance-verification",
  ];
}
