import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
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
        stream.push({ type: "start", partial: message });
        message.stopReason = "stop";
        stream.push({ type: "done", reason: "stop", message });
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
      extensionFactories: [telemetryExtension],
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
  await runtime.session.prompt(sentinel);
  const firstId = runtime.session.sessionId;
  const second = runtime.services.modelRuntime.getModel("fixture", "second");
  if (!second) throw new Error("Missing fixture model");
  await runtime.session.setModel(second);
  await runtime.session.prompt(sentinel);
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
