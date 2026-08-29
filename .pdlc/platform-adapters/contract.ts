export type PlatformId = "codex" | "github-copilot";

export type PlatformCapability =
  | "shared-skill"
  | "repository-instructions"
  | "custom-agent"
  | "prompt-file"
  | "cloud-environment-setup"
  | "command-approval";

export interface PortableHarnessSource {
  repositoryInstructionsPath: string;
  skillPath: string;
  runnerPath: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
  sourceHash: string;
}

export interface AdapterValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface AdapterValidationResult {
  ok: boolean;
  issues: AdapterValidationIssue[];
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly capabilities: ReadonlySet<PlatformCapability>;
  render(shared: PortableHarnessSource): Promise<GeneratedFile[]>;
  validate(workspace: string): Promise<AdapterValidationResult>;
}
