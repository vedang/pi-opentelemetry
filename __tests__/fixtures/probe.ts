import { on } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  Type,
} from "@earendil-works/pi-ai";
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type ExtensionUIContext,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import telemetryExtension from "../../src/index.ts";

const dir = await mkdtemp(join(tmpdir(), "pi-otel-session-"));
const sentinel = "FORBIDDEN_CONTENT_47f6";
const scenario = process.env.FIXTURE_SCENARIO ?? "assistant";
let toolStarted: (() => void) | undefined;
const startedTool = new Promise<void>((resolve) => {
  toolStarted = resolve;
});
const factory: CreateAgentSessionRuntimeFactory = async ({
  sessionManager,
  sessionStartEvent,
}) => {
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(dir, "models.json"),
    refreshOnCreate: false,
  });
  let call = 0;
  modelRuntime.registerProvider("fixture", {
    baseUrl: "http://127.0.0.1:1",
    apiKey: "synthetic",
    api: "fixture",
    models: [
      "first",
      "second",
      ...Array.from({ length: 40 }, (_, i) => `model${i}`),
    ].map((id) => ({
      id,
      name: id,
      reasoning: false,
      input: ["text"],
      cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
      contextWindow: 100000,
      maxTokens: 1000,
    })),
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const message: AssistantMessage = {
          role: "assistant",
          api: "fixture",
          provider: "fixture",
          model: model.id,
          content: [
            { type: "text", text: sentinel },
            { type: "thinking", thinking: sentinel },
          ],
          timestamp: Date.now(),
          stopReason: "pending",
          usage: {
            input: 3,
            output: 2,
            cacheRead: 1,
            cacheWrite: 4,
            totalTokens: 10,
            cost: {
              input: 0.1,
              output: 0.2,
              cacheRead: 0.01,
              cacheWrite: 0.04,
              total: 0.35,
            },
          },
        };
        call++;
        const toolTurn =
          ["tools", "abort", "load"].includes(scenario) && call === 1;
        if (toolTurn)
          message.content.push(
            ...(scenario === "load"
              ? Array.from({ length: 1100 }, () => "sibling")
              : ["outer", "sibling", "fails"]
            ).map((name, i) => ({
              type: "toolCall" as const,
              id:
                scenario === "load"
                  ? `call${i}`
                  : name === "outer"
                    ? "call_outer|fc_outer"
                    : name,
              name,
              arguments: { value: sentinel },
            })),
          );
        stream.push({ type: "start", partial: message });
        const reason = toolTurn ? "toolUse" : "stop";
        message.stopReason = reason;
        if (scenario === "usage" && call <= 2) {
          message.stopReason = call === 1 ? "error" : "aborted";
          message.errorMessage = sentinel;
          if (call === 2) Reflect.deleteProperty(message.usage, "cost");
          stream.push({
            type: "error",
            reason: message.stopReason,
            error: message,
          });
        } else {
          if (scenario === "usage") {
            message.usage.input = -1;
            message.usage.output = Number.NaN;
            message.usage.cacheRead = Number.POSITIVE_INFINITY;
            message.usage.cacheWrite = 0;
            message.usage.cost.total = Number.NaN;
          }
          stream.push({ type: "done", reason, message });
        }
        stream.end();
      });
      return stream;
    },
  });
  const services = await createAgentSessionServices({
    cwd: dir,
    agentDir: dir,
    modelRuntime,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        telemetryExtension,
        (pi) => {
          for (const name of ["outer", "inner", "sibling", "fails"])
            pi.registerTool({
              name,
              label: name,
              description: "Synthetic isolated fixture",
              parameters: Type.Object({ value: Type.String() }),
              async execute(_id, _args, signal, _update, ctx) {
                toolStarted?.();
                if (scenario === "abort") {
                  await new Promise<void>((resolve) => {
                    if (signal?.aborted) resolve();
                    else
                      signal?.addEventListener("abort", () => resolve(), {
                        once: true,
                      });
                  });
                  throw new Error(sentinel);
                }
                if (name === "fails") throw new Error(sentinel);
                await delay(name === "sibling" ? 70 : 20);
                if (name === "outer")
                  await ctx.executeTool("inner", { value: sentinel });
                return {
                  content: [{ type: "text", text: sentinel }],
                  details: { sentinel },
                  usage: {
                    input: 900,
                    output: 800,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 1700,
                    cost: {
                      input: 9,
                      output: 8,
                      cacheRead: 0,
                      cacheWrite: 0,
                      total: 17,
                    },
                  },
                };
              },
            });
        },
      ],
    },
  });
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      model: modelRuntime.getModel("fixture", "first"),
      // An empty allowlist disables extension tools too. Exercise only these
      // synthetic tools, never Pi's filesystem/shell tools.
      tools: ["outer", "inner", "sibling", "fails"],
    })),
    services,
    diagnostics: [],
  };
};
const runtime = await createAgentSessionRuntime(factory, {
  cwd: dir,
  agentDir: dir,
  sessionManager:
    scenario === "transitions"
      ? SessionManager.create(dir, join(dir, "sessions"))
      : SessionManager.inMemory(dir),
});
try {
  let extensionErrors = 0;
  const ui = {
    notify(message: string) {
      process.send?.({ status: message });
    },
  } as ExtensionUIContext;
  const bind = () =>
    runtime.session.bindExtensions({
      uiContext: ui,
      onError: () => {
        extensionErrors++;
      },
    });
  if (scenario !== "load-only") {
    await bind();
    await runtime.session.prompt("/otel-status");
    const prompt = runtime.session.prompt(sentinel);
    if (scenario === "abort") {
      await startedTool;
      await runtime.session.abort();
    }
    await prompt;
  }
  const firstId = runtime.session.sessionId;
  if (scenario === "assistant") {
    const second = runtime.services.modelRuntime.getModel("fixture", "second");
    if (!second) throw new Error("Missing fixture model");
    await runtime.session.setModel(second);
    await runtime.session.prompt(sentinel);
  }
  if (scenario === "cardinality") {
    for (let i = 0; i < 40; i++) {
      const model = runtime.services.modelRuntime.getModel(
        "fixture",
        `model${i}`,
      );
      if (!model) throw new Error("Missing fixture model");
      await runtime.session.setModel(model);
      await runtime.session.prompt(sentinel);
    }
  }
  if (scenario === "queue") {
    for (let i = 1; i < 80; i++) await runtime.session.prompt(sentinel);
  }
  if (scenario === "usage") {
    await runtime.session.prompt(sentinel);
    await runtime.session.prompt(sentinel);
  }
  const ids = [firstId];
  if (scenario === "transitions") {
    const original = runtime.session.sessionFile;
    if (!original) throw new Error("Missing persisted fixture session");
    await runtime.newSession();
    await bind();
    ids.push(runtime.session.sessionId);
    await runtime.session.prompt(sentinel);
    await runtime.switchSession(original);
    await bind();
    ids.push(runtime.session.sessionId);
    await runtime.session.prompt(sentinel);
    const user = runtime.session.sessionManager
      .getBranch()
      .find(
        (entry) => entry.type === "message" && entry.message.role === "user",
      );
    if (!user) throw new Error("Missing fork point");
    await runtime.fork(user.id, { position: "at" });
    await bind();
    ids.push(runtime.session.sessionId);
    await runtime.session.prompt(sentinel);
    await runtime.session.reload();
    ids.push(runtime.session.sessionId);
  }
  process.send?.({ ready: true, sessionId: firstId, ids });
  for await (const [command] of on(process, "message")) {
    if (command === "quit") break;
    if (command === "status") await runtime.session.prompt("/otel-status");
    if (command === "prompt") await runtime.session.prompt(sentinel);
    if (command === "second") {
      const model = runtime.services.modelRuntime.getModel("fixture", "second");
      if (!model) throw new Error("Missing fixture model");
      await runtime.session.setModel(model);
      await runtime.session.prompt(sentinel);
    }
    process.send?.({ action: command });
  }
  const started = performance.now();
  await runtime.dispose();
  if (extensionErrors) throw new Error("Unexpected fixture extension error");
  process.send?.({ shutdownMs: performance.now() - started });
} finally {
  await runtime.dispose();
  await rm(dir, { recursive: true, force: true });
  process.disconnect?.();
}
