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
  const statuses: string[] = [];
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  const exit = new Promise<{ code: number | null; signal: string | null }>(
    (res, rej) => {
      child.once("error", rej);
      child.once("close", (code, signal) => res({ code, signal }));
    },
  );
  const ready = new Promise<{ sessionId: string; ids: string[] }>(
    (res, rej) => {
      child.on(
        "message",
        (message: {
          ready?: boolean;
          sessionId: string;
          ids: string[];
          status?: string;
          shutdownMs?: number;
        }) => {
          if (message.status) statuses.push(message.status);
          if (message.ready) res(message);
          if (message.shutdownMs !== undefined) shutdownMs = message.shutdownMs;
        },
      );
      exit.then(
        () => rej(new Error(`Fixture exited before ready: ${stderr}`)),
        rej,
      );
    },
  );
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    child.kill("SIGKILL");
  }, 32000);
  try {
    const info = await ready;
    return {
      info,
      statuses,
      async action(command: string) {
        await new Promise<void>((resolve, reject) => {
          const listener = (message: { action?: string }) => {
            if (message.action !== command) return;
            child.off("message", listener);
            resolve();
          };
          child.on("message", listener);
          exit.then(() => {
            child.off("message", listener);
            reject(new Error(`Fixture exited before action: ${stderr}`));
          }, reject);
          child.send(command);
        });
      },
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
