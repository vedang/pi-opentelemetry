import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("installed Pi loads the disabled package offline without stdout or telemetry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-otel-load-"));
  try {
    const result = await new Promise<{ stdout: string; stderr: string }>(
      (res, rej) => {
        const child = execFile(
          resolve("node_modules/.bin/pi"),
          [
            "--no-extensions",
            "-e",
            process.cwd(),
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
            },
            timeout: 10000,
          },
          (error, stdout, stderr) =>
            error ? rej(error) : res({ stdout, stderr }),
        );
        child.stdin?.end();
      },
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toMatch(/pi-otel|error|failed/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
