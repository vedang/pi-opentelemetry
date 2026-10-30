import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export async function loadPackage(packageRoot: string, executable: string) {
  const dir = await mkdtemp(join(tmpdir(), "pi-otel-load-"));
  try {
    return await new Promise<{ stdout: string; stderr: string }>((res, rej) => {
      const child = execFile(
        executable,
        [
          "--no-extensions",
          "-e",
          packageRoot,
          "--offline",
          "--no-session",
          "--mode",
          "rpc",
        ],
        {
          cwd: dir,
          env: {
            PATH: process.env.PATH,
            HOME: dir,
            PI_CODING_AGENT_DIR: dir,
            PI_OFFLINE: "1",
            CLAUDE_CODE_ENABLE_TELEMETRY: "1",
            PI_OTEL_ENABLED: "0",
          },
          timeout: 10000,
        },
        (error, stdout, stderr) =>
          error ? rej(error) : res({ stdout, stderr }),
      );
      child.stdin?.end();
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const installed = process.argv[2];
  if (!installed) throw new Error("Isolated package project required");
  const result = await loadPackage(
    join(installed, "node_modules/pi-opentelemetry"),
    join(installed, "node_modules/.bin/pi"),
  );
  if (result.stdout || result.stderr)
    throw new Error("Packed Pi load emitted unexpected output");
}
