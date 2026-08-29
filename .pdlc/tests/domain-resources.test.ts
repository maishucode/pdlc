import assert from "node:assert/strict";
import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runCli } from "../cli.ts";

const projectRoot = resolve(import.meta.dirname, "../..");
const uxRoot = join(projectRoot, ".pdlc/domains/ux");

test("keeps UX Skills, Agent, and Stage Hooks directly in its Domain", async () => {
  const hooks = JSON.parse(await readFile(join(uxRoot, "hooks/stages.json"), "utf8"));
  assert.equal(hooks.domain, "ux");
  assert.equal(hooks.enabled, true);
  assert.deepEqual(hooks.deliveryFlows, ["poc"]);
  assert.deepEqual(hooks.permissions, { filesystem: "write", network: false, externalWrites: false });
  await readFile(join(uxRoot, "agents/atlas-pdlc-ux.agent.md"), "utf8");
  for (const skill of ["atlas-pdlc-ux-spec", "atlas-pdlc-ux-react-ui-delivery", "atlas-pdlc-ux-review"]) {
    const contents = await readFile(join(uxRoot, "skills", skill, "SKILL.md"), "utf8");
    assert.match(contents, new RegExp(`name: ${skill}`));
  }
});

test("lists direct Domain resources without Plugin wrappers", async () => {
  const result = await runCli(["domain", "list"], projectRoot);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  const ux = (result.output as { domains: Array<Record<string, unknown>> }).domains.find(({ id }) => id === "ux");
  assert.deepEqual(ux, {
    id: "ux",
    artifacts: 0,
    policies: 1,
    knowledge: 2,
    skills: ["atlas-pdlc-ux-react-ui-delivery", "atlas-pdlc-ux-review", "atlas-pdlc-ux-spec"],
    agents: ["atlas-pdlc-ux"],
    hooks: 1,
    stages: ["requirements-clarification", "ux-design", "implementation", "developer-verification", "acceptance-verification"],
  });
});

test("requires the main POC entry point to compose Domain resources at every Stage", async () => {
  const skill = await readFile(join(projectRoot, ".agents/skills/atlas-pdlc/SKILL.md"), "utf8");
  const agent = await readFile(join(projectRoot, ".github/agents/atlas-pdlc.agent.md"), "utf8");
  assert.match(skill, /context <stage-id>/);
  assert.match(skill, /Never ask the end user to select a Domain Agent manually/);
  assert.match(agent, /Domain contributions extend this Agent; they do not replace it/);
  const fastStart = skill.match(/## Fast start and just-in-time loading[\s\S]*?## Select the Delivery Flow/)?.[0] ?? "";
  assert.match(fastStart, /requiredAgentInvocations/);
  assert.match(fastStart, /task\(agent_type=contract\.agentType/);
  assert.match(fastStart, /agent-capability-result/);
});

test("wires required Domain capabilities to a generic native Copilot subagent", async () => {
  const mainAgent = await readFile(join(projectRoot, ".github/agents/atlas-pdlc.agent.md"), "utf8");
  const skill = await readFile(join(projectRoot, ".agents/skills/atlas-pdlc/SKILL.md"), "utf8");
  const canonicalUxAgent = await readFile(join(uxRoot, "agents/atlas-pdlc-ux.agent.md"), "utf8");

  assert.match(mainAgent, /tools: \["read", "edit", "search", "execute", "agent"\]/);
  assert.match(mainAgent, /requiredAgentInvocations/);
  assert.match(mainAgent, /must not emulate/i);
  assert.match(mainAgent, /task\(agent_type=contract\.agentType/);
  assert.match(mainAgent, /contract\.agent\.path/);
  assert.match(mainAgent, /github-copilot:subagent:/);
  assert.match(skill, /task\(agent_type=contract\.agentType/);
  assert.match(skill, /agent-capability-result/);
  await assert.rejects(access(join(projectRoot, ".github/agents/atlas-pdlc-ux.agent.md")));
  assert.match(canonicalUxAgent, /generic GitHub Copilot subagent/i);
  assert.match(canonicalUxAgent, /role profile/i);
  for (const field of ["invocationId", "capability", "permissions", "platformExecutionRef", "evidenceRefs"]) {
    assert.match(canonicalUxAgent, new RegExp(field));
  }
});

test("syncs Skills without requiring a Domain custom-agent projection", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "atlas-pdlc-domain-sync-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  await cp(join(projectRoot, ".pdlc"), join(workspace, ".pdlc"), { recursive: true });
  await assert.rejects(access(join(workspace, ".github/agents/atlas-pdlc-ux.agent.md")));
  const first = await runCli(["domain", "sync", "--root", workspace], projectRoot);
  assert.equal(first.exitCode, 0, JSON.stringify(first.output));
  assert.deepEqual((first.output as { installed: string[] }).installed, [
    ".github/skills/atlas-pdlc-ux-react-ui-delivery/SKILL.md",
    ".github/skills/atlas-pdlc-ux-review/SKILL.md",
    ".github/skills/atlas-pdlc-ux-spec/SKILL.md",
  ]);
  await assert.rejects(access(join(workspace, ".github/agents/atlas-pdlc-ux.agent.md")));
  const resolved = await runCli(["context", "requirements-clarification", "--root", workspace], projectRoot);
  assert.equal(resolved.exitCode, 0, JSON.stringify(resolved.output));
  const invocation = (resolved.output as { requiredAgentInvocations: Array<{ agent: { path: string }; skills: Array<{ path: string }> }> }).requiredAgentInvocations[0]!;
  await access(join(workspace, invocation.agent.path));
  await Promise.all(invocation.skills.map(({ path }) => access(join(workspace, path))));
  const repeated = await runCli(["domain", "sync", "--root", workspace], projectRoot);
  assert.equal(repeated.exitCode, 0, JSON.stringify(repeated.output));
  assert.deepEqual((repeated.output as { installed: string[] }).installed, []);
  assert.equal((repeated.output as { unchanged: string[] }).unchanged.length, 3);
});

test("lists top-level Integrations and their bundled Skills", async () => {
  const result = await runCli(["integration", "list"], projectRoot);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  assert.deepEqual(result.output, {
    ok: true,
    integrations: [{
      id: "databricks",
      version: "1.0.0",
      owners: ["data-platform-leadership"],
      maintainers: ["data-platform-engineering"],
      permissions: { network: true, credentialRefs: ["DATABRICKS_CONNECTION_PROFILE"], externalWrites: false },
      skills: [],
    }],
  });
});
