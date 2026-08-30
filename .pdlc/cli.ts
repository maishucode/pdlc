import { readFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PdlcError } from "./core/errors.ts";
import { FlowEngine } from "./core/flow-engine.ts";
import { ProjectPaths } from "./core/project-paths.ts";
import { migrateLegacyStorage } from "./core/storage-migration.ts";
import { applyStageContext, disciplineList, disciplineSync, guidance, integrationList, stageContext } from "./commands/context.ts";
import type { RunnerOptions } from "./commands/types.ts";
import { validateHarness } from "./commands/validate.ts";

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = resolve(MODULE_DIRECTORY, "..");

interface ParsedArguments { command?: string; subcommand?: string; options: RunnerOptions }

function parseArguments(args: string[], currentDirectory: string): ParsedArguments {
  const positional: string[] = [];
  const options: RunnerOptions = { root: currentDirectory };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") positional.push("help");
    else if (argument === "--check") options.check = true;
    else if (["--root", "--record", "--actor", "--receipt", "--outcome", "--input"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new PdlcError("INVALID_ARGUMENT", `Missing value for ${argument}`);
      if (argument === "--root") options.root = resolve(currentDirectory, value);
      else if (argument === "--record") options.record = value;
      else if (argument === "--actor") options.actor = value;
      else if (argument === "--receipt") options.receipt = value;
      else if (argument === "--outcome") options.outcome = value;
      else options.input = value;
      index += 1;
    } else if (argument.startsWith("--")) throw new PdlcError("INVALID_ARGUMENT", `Unknown option: ${argument}`);
    else positional.push(argument);
  }
  if (positional.length > 2) throw new PdlcError("INVALID_ARGUMENT", `Too many positional arguments: ${positional.slice(2).join(" ")}`);
  return { command: positional[0], subcommand: positional[1], options };
}

async function initialize(options: RunnerOptions): Promise<unknown> {
  if (!options.input) throw new PdlcError("INVALID_ARGUMENT", "Init requires --input <draft-record.json>");
  if (!options.actor?.trim()) throw new PdlcError("INVALID_ARGUMENT", "Init requires --actor <identity>");
  const inboxRoot = new ProjectPaths(options.root).inboxRoot;
  const inputPath = isAbsolute(options.input) ? resolve(options.input) : resolve(options.root, options.input);
  const inputFromInbox = relative(inboxRoot, inputPath);
  if (inputFromInbox === "" || inputFromInbox === ".." || inputFromInbox.startsWith(`..${sep}`) || isAbsolute(inputFromInbox) || !inputPath.endsWith(".json")) {
    throw new PdlcError("INVALID_ARGUMENT", "Init input must be a JSON file under pdlc/.state/inbox/");
  }
  let raw: unknown;
  try { raw = JSON.parse(await readFile(inputPath, "utf8")) as unknown; }
  catch (error) { throw new PdlcError("VALIDATION_FAILED", "Initial Delivery Record draft cannot be read", error instanceof Error ? error.message : String(error)); }
  const initialized = await (await FlowEngine.load(HARNESS_ROOT, options.root)).initialize(raw, options.actor);
  let inputConsumed = true;
  try { await unlink(inputPath); } catch { inputConsumed = false; }
  return {
    ok: true,
    recordId: initialized.record.id,
    deliveryFlow: initialized.record.deliveryFlow,
    status: initialized.record.status,
    stage: initialized.event.stage,
    revision: initialized.record.revision,
    current: true,
    auditEvent: { eventId: initialized.event.eventId, eventType: initialized.event.eventType, actor: initialized.event.actor, timestamp: initialized.event.timestamp, recordHash: initialized.event.recordHash },
    inputConsumed,
  };
}

export async function runCli(args: string[], currentDirectory = process.cwd()): Promise<{ exitCode: number; output: unknown }> {
  try {
    const parsed = parseArguments(args, currentDirectory);
    if (!parsed.command || parsed.command === "help") return { exitCode: 0, output: { name: "Lean PDLC Runner v2", commands: ["init --input <draft-record.json> --actor <identity>", "status", "audit summary", "migrate storage", "validate", "action <id> --input <input.json> --actor <identity>", "artifacts bind --input <binding.json> --actor <identity> (compatibility alias)", "context <stage>", "context-apply <stage>", "readiness build --check --actor <identity>", "readiness build --actor <identity>", "checkpoint <id> --actor <identity>", "guidance <stage>", "discipline list", "discipline sync", "integration list"] } };
    if (parsed.command === "init") return { exitCode: 0, output: await initialize(parsed.options) };
    if (parsed.command === "status") return { exitCode: 0, output: await (await FlowEngine.load(HARNESS_ROOT, parsed.options.root)).status(parsed.options) };
    if (parsed.command === "audit" && parsed.subcommand === "summary") return { exitCode: 0, output: await (await FlowEngine.load(HARNESS_ROOT, parsed.options.root)).auditSummary(parsed.options) };
    if (parsed.command === "audit") throw new PdlcError("INVALID_ARGUMENT", "Audit command must be summary");
    if (parsed.command === "migrate" && parsed.subcommand === "storage") return { exitCode: 0, output: { ok: true, ...await migrateLegacyStorage(parsed.options.root) } };
    if (parsed.command === "migrate") throw new PdlcError("INVALID_ARGUMENT", "Migrate command must be storage");
    if (parsed.command === "validate") return { exitCode: 0, output: await validateHarness(HARNESS_ROOT, parsed.options) };
    if (parsed.command === "action" && parsed.subcommand) return { exitCode: 0, output: await (await FlowEngine.load(HARNESS_ROOT, parsed.options.root)).action(parsed.options, parsed.subcommand) };
    if (parsed.command === "action") throw new PdlcError("INVALID_ARGUMENT", "Action id is required");
    if (parsed.command === "artifacts" && parsed.subcommand === "bind") return { exitCode: 0, output: await (await FlowEngine.load(HARNESS_ROOT, parsed.options.root)).action(parsed.options, "artifacts-bind") };
    if (parsed.command === "artifacts") throw new PdlcError("INVALID_ARGUMENT", "Artifacts command must be bind");
    if (parsed.command === "context") return { exitCode: 0, output: await stageContext(HARNESS_ROOT, parsed.options, parsed.subcommand) };
    if (parsed.command === "context-apply") return { exitCode: 0, output: await applyStageContext(HARNESS_ROOT, parsed.options, parsed.subcommand) };
    if (parsed.command === "readiness" && parsed.subcommand === "build") return { exitCode: 0, output: await (await FlowEngine.load(HARNESS_ROOT, parsed.options.root)).action(parsed.options, "build-readiness") };
    if (parsed.command === "readiness") throw new PdlcError("INVALID_ARGUMENT", "Readiness target must be 'build'");
    if (parsed.command === "guidance") return { exitCode: 0, output: await guidance(HARNESS_ROOT, parsed.subcommand) };
    if (parsed.command === "discipline" && parsed.subcommand === "list") return { exitCode: 0, output: await disciplineList(HARNESS_ROOT) };
    if (parsed.command === "discipline" && parsed.subcommand === "sync") return { exitCode: 0, output: await disciplineSync(HARNESS_ROOT, parsed.options) };
    if (parsed.command === "discipline") throw new PdlcError("INVALID_ARGUMENT", "Discipline command must be list or sync");
    if (parsed.command === "integration" && parsed.subcommand === "list") return { exitCode: 0, output: await integrationList(HARNESS_ROOT) };
    if (parsed.command === "integration") throw new PdlcError("INVALID_ARGUMENT", "Integration command must be list");
    if (parsed.command === "checkpoint" && parsed.subcommand) return { exitCode: 0, output: await (await FlowEngine.load(HARNESS_ROOT, parsed.options.root)).checkpoint(parsed.options, parsed.subcommand) };
    if (parsed.command === "checkpoint") throw new PdlcError("INVALID_ARGUMENT", "Checkpoint id is required");
    throw new PdlcError("INVALID_ARGUMENT", `Unknown command: ${parsed.command}`);
  } catch (error) {
    if (error instanceof PdlcError) return { exitCode: 2, output: { ok: false, error: { code: error.code, message: error.message, details: error.details } } };
    return { exitCode: 1, output: { ok: false, error: { code: "UNEXPECTED_ERROR", message: error instanceof Error ? error.message : String(error) } } };
  }
}

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2));
  (result.exitCode === 0 ? process.stdout : process.stderr).write(`${JSON.stringify(result.output, null, 2)}\n`);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
