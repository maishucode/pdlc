import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "../..");
const pluginRoot = join(projectRoot, "examples/copilot-plugins/lean-pdlc-ux");

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}

function splitFrontmatter(source: string): { frontmatter: string; body: string } {
  const normalized = source.replace(/\r\n?/g, "\n");
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  assert(match, "expected Markdown frontmatter");
  return { frontmatter: match[1], body: match[2] };
}

function frontmatterValues(frontmatter: string, field: string): string[] {
  return frontmatter.split("\n").flatMap((line) => {
    const match = line.match(new RegExp(`^${field}:\\s*(.+?)\\s*$`));
    return match ? [match[1]] : [];
  });
}

function assertSingleFrontmatterValue(frontmatter: string, field: string, expected: string): void {
  const values = frontmatterValues(frontmatter, field);
  assert.deepEqual(values, [expected], `expected exactly one valid ${field} field`);
}

function assertSingleNonEmptyFrontmatterValue(frontmatter: string, field: string): void {
  const values = frontmatterValues(frontmatter, field);
  assert.equal(values.length, 1, `expected exactly one ${field} field`);
  assert.notEqual(values[0].trim(), "", `${field} must not be empty`);
}

test("ships one minimal Agent Plugins 1.0 UX Copilot plugin", async () => {
  const expectedFiles = [
    "README.md",
    "com.github.copilot/agents/lean-pdlc-ux.agent.md",
    "plugin.json",
    "skills/ux-review/SKILL.md",
    "skills/ux-spec/SKILL.md",
  ];
  const files = (await listFiles(pluginRoot))
    .map((path) => relative(pluginRoot, path))
    .sort();

  assert.deepEqual(files, expectedFiles);
  assert.equal(files.filter((path) => path.endsWith(".agent.md")).length, 1);
  assert.equal(files.filter((path) => path.endsWith("/SKILL.md")).length, 2);
  assert.equal(
    files.some((path) => /(?:^|\/)(?:hooks?|mcp|scripts?)(?:\/|\.|$)/i.test(path)),
    false,
    "the example must not ship hook, MCP, or script files",
  );
});

test("declares a portable Agent Plugins 1.0 manifest without runtime components", async () => {
  const manifest = JSON.parse(await readFile(join(pluginRoot, "plugin.json"), "utf8")) as Record<string, unknown>;

  assert.deepEqual(Object.keys(manifest).sort(), [
    "$schema",
    "author",
    "description",
    "keywords",
    "license",
    "name",
    "version",
  ]);
  assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(manifest.name, "lean-pdlc-ux");
  assert.equal(manifest.description, "Read-only UX specification and review guidance for Lean PDLC in VS Code.");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.license, "MIT");
  assert.deepEqual(manifest.keywords, ["pdlc", "ux", "github-copilot", "vscode"]);
  assert.deepEqual(manifest.author, { name: "Lean PDLC Contributors" });
  assert.equal(typeof manifest.author, "object", "author must be an object");
  assert.notEqual((manifest.author as { name?: unknown }).name, "", "author.name must not be empty");
  assert.equal(typeof (manifest.author as { name?: unknown }).name, "string", "author.name must be a string");
  for (const runtimeComponent of ["agents", "skills", "hooks", "commands", "mcpServers"]) {
    assert.equal(
      Object.hasOwn(manifest, runtimeComponent),
      false,
      `manifest must not use the ${runtimeComponent} runtime component field`,
    );
  }
  assert.equal(Object.hasOwn(manifest, "extensions"), false, "the example does not add optional extensions");
});

test("keeps the VS Code UX agent read-only and outside PDLC control boundaries", async () => {
  const source = await readFile(join(pluginRoot, "com.github.copilot/agents/lean-pdlc-ux.agent.md"), "utf8");
  const { frontmatter, body } = splitFrontmatter(source);

  assertSingleFrontmatterValue(frontmatter, "name", "Lean PDLC UX");
  assertSingleNonEmptyFrontmatterValue(frontmatter, "description");
  assertSingleFrontmatterValue(frontmatter, "target", "vscode");
  assertSingleFrontmatterValue(frontmatter, "user-invocable", "true");
  assertSingleFrontmatterValue(frontmatter, "disable-model-invocation", "true");
  assertSingleFrontmatterValue(frontmatter, "tools", "[read, search]");
  assert.doesNotMatch(frontmatter, /\bedit\b/i);
  assert.match(body, /(?:must not|do not|cannot) approve requirements/i);
  assert.match(body, /(?:must not|do not|cannot) bypass Build Readiness/i);
  assert.match(body, /(?:must not|do not|cannot) alter (?:the )?workflow/i);
  assert.match(body, /(?:must not|do not|cannot) alter (?:the )?state/i);
  assert.match(body, /(?:must not|do not|cannot) (?:write|modify) workspace files/i);
});

test("keeps UX skills portable, conventionally named, and focused on usable output", async () => {
  const skillSources = await Promise.all(["ux-spec", "ux-review"].map(async (skill) => {
    const source = await readFile(join(pluginRoot, "skills", skill, "SKILL.md"), "utf8");
    return { skill, ...splitFrontmatter(source), source };
  }));

  for (const { skill, frontmatter } of skillSources) {
    assertSingleFrontmatterValue(frontmatter, "name", skill);
    assertSingleNonEmptyFrontmatterValue(frontmatter, "description");
    assert.doesNotMatch(
      frontmatter,
      /^(?:allowed-tools|tools|mcp(?:-servers?)?|mcpServers|commands?|command):/mi,
      "skills must not declare tool, MCP, or command permissions",
    );
  }

  const uxSpec = skillSources.find(({ skill }) => skill === "ux-spec")?.source ?? "";
  assert.match(uxSpec, /^## Required output$/mi);
  assert.match(uxSpec, /^## State coverage$/mi);
  for (const requiredState of [
    "normal",
    "loading",
    "empty",
    "error",
    "validation",
    "destructive",
    "responsive",
    "accessibility",
  ]) {
    assert.match(
      uxSpec,
      new RegExp(`^- \\*\\*${requiredState}:\\*\\*`, "mi"),
      `ux-spec must cover ${requiredState} state as an explicit deliverable`,
    );
  }

  const uxReview = skillSources.find(({ skill }) => skill === "ux-review")?.source ?? "";
  assert.match(uxReview, /^## Required output$/mi);
  for (const requiredOutput of [
    "Severity",
    "Evidence",
    "Recommendation",
    "Linked requirement or acceptance criterion",
  ]) {
    assert.match(
      uxReview,
      new RegExp(`^- \\*\\*${requiredOutput}:\\*\\*`, "mi"),
      `ux-review must require ${requiredOutput}`,
    );
  }
  assert.match(uxReview, /^## Constraints$/mi);
  assert.match(uxReview, /every conclusion.*evidence/i, "ux-review conclusions must be evidence-backed");
});

test("documents local VS Code and CLI use without runtime integrations", async () => {
  const readme = await readFile(join(pluginRoot, "README.md"), "utf8");
  const rootReadme = await readFile(join(projectRoot, "README.md"), "utf8");

  assert.match(readme, /chat\.pluginLocations/);
  assert.match(readme, /chat\.plugins\.enabled/);
  assert.match(readme, /does not install a plugin from a local directory/i);
  assert.doesNotMatch(readme, /copilot plugin install \/absolute\/path/i);
  assert.match(readme, /copilot plugin install OWNER\/REPO:examples\/copilot-plugins\/lean-pdlc-ux --config-dir \/tmp\/lean-pdlc-copilot-config/i);
  assert.match(readme, /copilot plugin list --config-dir \/tmp\/lean-pdlc-copilot-config/i);
  assert.match(readme, /copilot plugin uninstall lean-pdlc-ux --config-dir \/tmp\/lean-pdlc-copilot-config/i);
  assert.match(readme, /not published as a Copilot plugin source/i);
  assert.match(readme, /no hooks/i);
  assert.match(readme, /no MCP/i);
  assert.match(rootReadme, /examples\/copilot-plugins\/lean-pdlc-ux\/README\.md/);
});
