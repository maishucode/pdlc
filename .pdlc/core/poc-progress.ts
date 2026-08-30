import type { ContextualDeliveryRecord, PocDeliveryRecord, ValidationIssue } from "./types.ts";

export const POC_SECURITY_RISK_TRIGGERS = [
  "sensitive-data",
  "external-access",
  "credentials",
  "regulated-data",
] as const;
const SECURITY_RISK_TRIGGER_SET = new Set<string>(POC_SECURITY_RISK_TRIGGERS);
const TECHNOLOGY_TAG_ALIASES = new Map([
  ["web", "web-ui"],
  ["browser", "web-ui"],
  ["browser-ui", "web-ui"],
  ["mobile", "mobile-ui"],
  ["native-mobile", "mobile-ui"],
]);

export function contextTags(record: ContextualDeliveryRecord): string[] {
  return [...new Set([
    ...record.risk.triggers.map((value) => `risk:${value}`),
    ...record.design.technologies.map((value) => `technology:${value}`),
    ...record.design.disciplines.map((value) => `discipline:${value}`),
  ])].sort();
}

export function contextClassificationIssues(record: ContextualDeliveryRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const classifications = [
    { values: record.risk.triggers, path: "$.risk.triggers", prefix: "risk:" },
    { values: record.design.technologies, path: "$.design.technologies", prefix: "technology:" },
    { values: record.design.disciplines, path: "$.design.disciplines", prefix: "discipline:" },
  ];
  for (const { values, path, prefix } of classifications) {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) issues.push({ code: "DUPLICATE_CONTEXT_VALUE", path: `${path}[${index}]`, message: `Context classification '${value}' is duplicated.` });
      seen.add(value);
      if (value.startsWith(prefix)) issues.push({
        code: "PREFIXED_CONTEXT_VALUE",
        path: `${path}[${index}]`,
        message: `Store the classification without its '${prefix}' prefix; use '${value.slice(prefix.length)}'.`,
      });
      if (value !== value.trim() || value !== value.toLowerCase() || !/^[a-z0-9][a-z0-9.+-]*$/.test(value)) issues.push({
        code: "NON_CANONICAL_CONTEXT_VALUE",
        path: `${path}[${index}]`,
        message: `Context classification '${value}' must be a lowercase canonical tag without whitespace.`,
      });
    });
  }
  record.design.technologies.forEach((technology, index) => {
    const canonical = TECHNOLOGY_TAG_ALIASES.get(technology);
    if (canonical) issues.push({
      code: "NON_CANONICAL_TECHNOLOGY_TAG",
      path: `$.design.technologies[${index}]`,
      message: `Technology '${technology}' does not activate the intended context; use '${canonical}'.`,
    });
  });
  return issues;
}

export function technologyTagIssues(record: PocDeliveryRecord): ValidationIssue[] {
  return contextClassificationIssues(record);
}

export function currentPocStage(record: PocDeliveryRecord): string {
  const appliedStages = new Set(record.resolution.contextApplications.map(({ stage }) => stage));
  if (record.status === "DRAFT") {
    const clarificationComplete = Object.values(record.requirements.clarification.coverage).every((status) => status === "complete")
      && record.requirements.clarification.openQuestions.length === 0
      && record.requirements.clarification.contradictions.length === 0;
    if (!clarificationComplete) return "requirements-clarification";
    if (!record.design.summary.trim()) return "solution-design";
    if (record.design.technologies.some((technology) => technology === "web-ui" || technology === "mobile-ui") && !appliedStages.has("ux-design")) return "ux-design";
    if (!appliedStages.has("build-readiness")) return "build-readiness";
    return "requirements-approval";
  }
  if (record.status === "COMMITTED") {
    if (!appliedStages.has("implementation") || record.evidence.build.length === 0) return "implementation";
    if (!appliedStages.has("developer-verification") || record.evidence.tests.length === 0) return "developer-verification";
    if (requiresSecurityVerification(record) && (!appliedStages.has("security-verification") || record.evidence.security.length === 0)) return "security-verification";
    return "acceptance-verification";
  }
  return "outcome-review-and-disposition";
}

export function requiresSecurityVerification(record: PocDeliveryRecord): boolean {
  return record.risk.triggers.some((trigger) => SECURITY_RISK_TRIGGER_SET.has(trigger));
}

export function buildReadinessContextStages(record?: ContextualDeliveryRecord): string[] {
  return [
    "requirements-clarification",
    ...(record?.design.technologies.some((technology) => technology === "web-ui" || technology === "mobile-ui") ? ["ux-design"] : []),
    "build-readiness",
  ];
}

export function verificationContextStages(record: PocDeliveryRecord): string[] {
  return [
    ...buildReadinessContextStages(record),
    "implementation",
    "developer-verification",
    ...(requiresSecurityVerification(record) ? ["security-verification"] : []),
    "acceptance-verification",
  ];
}

export function operationalContextStages(record: PocDeliveryRecord): string[] {
  if (record.status === "DRAFT") return buildReadinessContextStages(record);
  if (record.status === "COMMITTED") return verificationContextStages(record);
  return [];
}
