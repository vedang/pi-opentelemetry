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
    models: ["first", "second"].map((id) => ({
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
        const toolTurn = ["tools", "abort"].includes(scenario) && call === 1;
        if (toolTurn)
          message.content.push(
            ...["outer", "sibling", "fails"].map((name) => ({
              type: "toolCall" as const,
              id: name,
              name,
              arguments: { value: sentinel },
            })),
          );
        stream.push({ type: "start", partial: message });
        const reason = toolTurn ? "toolUse" : "stop";
        message.stopReason = reason;
        stream.push({ type: "done", reason, message });
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
      tools: [],
    })),
    services,
    diagnostics: [],
  };
};
const runtime = await createAgentSessionRuntime(factory, {
  cwd: dir,
  agentDir: dir,
  sessionManager: SessionManager.inMemory(dir),
});
try {
  await runtime.session.bindExtensions({});
  const prompt = runtime.session.prompt(sentinel);
  if (scenario === "abort") {
    await startedTool;
    await runtime.session.abort();
  }
  await prompt;
  const firstId = runtime.session.sessionId;
  if (scenario === "assistant") {
    const second = runtime.services.modelRuntime.getModel("fixture", "second");
    if (!second) throw new Error("Missing fixture model");
    await runtime.session.setModel(second);
    await runtime.session.prompt(sentinel);
  }
  process.send?.({ ready: true, sessionId: firstId });
  await new Promise<void>((resolve) =>
    process.once("message", () => resolve()),
  );
  const started = performance.now();
  await runtime.dispose();
  process.send?.({ shutdownMs: performance.now() - started });
} finally {
  await runtime.dispose();
  await rm(dir, { recursive: true, force: true });
  process.disconnect?.();
}
