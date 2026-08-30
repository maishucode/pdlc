import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { PdlcError } from "./errors.ts";
import { ProjectPaths } from "./project-paths.ts";

export interface LockHandle {
  readonly name: string;
  readonly path: string;
  readonly token: string;
  release(): Promise<void>;
}

function safeLockName(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new PdlcError("INVALID_ARGUMENT", `Unsafe lock name: ${name}`);
  }
  return name;
}

export async function acquireLock(workspaceRoot: string, name: string): Promise<LockHandle> {
  const safeName = safeLockName(name);
  const paths = new ProjectPaths(workspaceRoot);
  const lockDirectory = paths.locksRoot;
  const lockPath = paths.lock(safeName);
  const token = randomUUID();
  await mkdir(lockDirectory, { recursive: true });

  let file;
  try {
    file = await open(lockPath, "wx", 0o600);
    await file.writeFile(`${JSON.stringify({ token, pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new PdlcError("LOCK_HELD", `Lock is already held: ${safeName}`);
    }
    throw error;
  } finally {
    await file?.close();
  }

  let released = false;
  return {
    name: safeName,
    path: lockPath,
    token,
    async release(): Promise<void> {
      if (released) return;
      let stored: { token?: string };
      try {
        stored = JSON.parse(await readFile(lockPath, "utf8")) as { token?: string };
      } catch (error) {
        throw new PdlcError("LOCK_OWNERSHIP_LOST", `Cannot verify lock ownership: ${safeName}`, error);
      }
      if (stored.token !== token) {
        throw new PdlcError("LOCK_OWNERSHIP_LOST", `Lock ownership changed: ${safeName}`);
      }
      await unlink(lockPath);
      released = true;
    },
  };
}

export async function withLock<T>(
  workspaceRoot: string,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  const handle = await acquireLock(workspaceRoot, name);
  try {
    return await operation();
  } finally {
    await handle.release();
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
