import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function startSession(
  endpoint: string,
  extra: NodeJS.ProcessEnv = {},
) {
  const child = fork(
    fileURLToPath(new URL("./probe.ts", import.meta.url)),
    [],
    {
      execArgv: [],
      silent: true,
      env: {
        PATH: process.env.PATH,
        HOME: "/nonexistent",
        PI_OFFLINE: "1",
        PI_OTEL_ENABLED: "1",
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
        ...extra,
      },
    },
  );
  let stdout = "";
  let stderr = "";
  let shutdownMs: number | undefined;
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  const exit = new Promise<{ code: number | null; signal: string | null }>(
    (res, rej) => {
      child.once("error", rej);
      child.once("exit", (code, signal) => res({ code, signal }));
    },
  );
  const ready = new Promise<{ sessionId: string }>((res, rej) => {
    child.on(
      "message",
      (message: {
        ready?: boolean;
        sessionId: string;
        shutdownMs?: number;
      }) => {
        if (message.ready) res(message);
        if (message.shutdownMs !== undefined) shutdownMs = message.shutdownMs;
      },
    );
    exit.then(
      () => rej(new Error(`Fixture exited before ready: ${stderr}`)),
      rej,
    );
  });
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    child.kill("SIGKILL");
  }, 32000);
  try {
    const info = await ready;
    return {
      info,
      async stop() {
        if (child.connected) child.send("quit");
        const result = await exit;
        clearTimeout(timer);
        if (killed || result.code !== 0 || result.signal)
          throw new Error(
            `Unclean fixture exit: ${JSON.stringify(result)} ${stderr}`,
          );
        return { stdout, stderr, shutdownMs };
      },
    };
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}
