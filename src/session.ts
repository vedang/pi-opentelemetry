import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  MessageEndEvent,
} from "@earendil-works/pi-coding-agent";
import type { Attributes } from "@opentelemetry/api";
import { configuration } from "./config.ts";
import { label, Telemetry } from "./telemetry.ts";

function valid(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function registerSession(pi: ExtensionAPI) {
  let telemetry: Telemetry | undefined;
  let disabled = "off";
  let sessionId = "";
  let runId = "";
  let request: { id: string; start: number } | undefined;
  let run: { start: number; outcome: string } | undefined;
  const tools = new Map<
    string,
    { start: number; name: string; parent?: string }
  >();
  const toolNames = new Set<string>();
  let runs: ReturnType<Telemetry["meter"]["createCounter"]>;
  let runDuration: ReturnType<Telemetry["meter"]["createHistogram"]>;
  let toolCount: ReturnType<Telemetry["meter"]["createCounter"]>;
  let toolDuration: ReturnType<Telemetry["meter"]["createHistogram"]>;
  let tokens: ReturnType<Telemetry["meter"]["createCounter"]>;
  let cost: ReturnType<Telemetry["meter"]["createCounter"]>;
  const models = new Set<string>();
  const base = (): Attributes => ({
    "pi.session.id": sessionId,
    "pi.run.id": runId,
  });

  const interrupt = () => {
    if (!telemetry) return;
    if (request) {
      telemetry.emit("pi.assistant.request", {
        ...base(),
        "pi.request.id": request.id,
        "pi.outcome": "incomplete",
      });
      request = undefined;
      telemetry.lost();
    }
    for (const [id, tool] of tools)
      telemetry.emit("pi.tool.end", {
        ...base(),
        "pi.tool.id": id,
        "pi.tool.name": tool.name,
        "pi.outcome": "incomplete",
      });
    if (tools.size) telemetry.lost();
    tools.clear();
  };

  pi.on("session_start", async (_event, ctx) => {
    await telemetry?.shutdown();
    telemetry = undefined;
    request = undefined;
    runId = "";
    run = undefined;
    tools.clear();
    toolNames.clear();
    models.clear();
    const config = configuration(process.env);
    if (!config.enabled) {
      disabled = config.reason;
      if (disabled !== "off")
        process.stderr.write(`pi-otel: disabled (${disabled})\n`);
      return;
    }
    sessionId = label(ctx.sessionManager.getSessionId());
    telemetry = new Telemetry(config);
    tokens = telemetry.meter.createCounter("pi.assistant.tokens", {
      unit: "{token}",
    });
    cost = telemetry.meter.createCounter("pi.assistant.estimated_cost", {
      unit: "USD",
    });
    runs = telemetry.meter.createCounter("pi.agent.runs");
    runDuration = telemetry.meter.createHistogram("pi.agent.duration", {
      unit: "ms",
    });
    toolCount = telemetry.meter.createCounter("pi.tool.executions");
    toolDuration = telemetry.meter.createHistogram("pi.tool.duration", {
      unit: "ms",
    });
    telemetry.meter.createCounter("pi.session.activations").add(1);
    telemetry.emit("pi.session.start", { "pi.session.id": sessionId });
  });
  pi.on("agent_start", () => {
    if (!telemetry) return;
    interrupt();
    if (run) telemetry.lost();
    runId = randomUUID();
    run = { start: performance.now(), outcome: "success" };
    telemetry.emit("pi.agent.start", base());
  });
  pi.on("agent_end", (_event, ctx) => {
    if (!telemetry || !run) return;
    interrupt();
    const outcome = ctx.signal?.aborted ? "aborted" : run.outcome;
    const elapsed = performance.now() - run.start;
    const dimensions = { "pi.outcome": outcome };
    runs.add(1, dimensions);
    runDuration.record(elapsed, dimensions);
    telemetry.emit("pi.agent.end", {
      ...base(),
      ...dimensions,
      "pi.duration_ms": elapsed,
    });
    run = undefined;
  });
  pi.on("tool_execution_start", (event) => {
    if (!telemetry) return;
    if (
      tools.size >= 1024 ||
      label(event.toolCallId) !== event.toolCallId ||
      tools.has(event.toolCallId)
    ) {
      telemetry.lost();
      return;
    }
    tools.set(event.toolCallId, {
      start: performance.now(),
      name: label(event.toolName),
      parent: event.parentToolCallId
        ? label(event.parentToolCallId)
        : undefined,
    });
  });
  pi.on("tool_execution_end", (event, ctx) => {
    if (!telemetry) return;
    const tool = tools.get(event.toolCallId);
    if (!tool) {
      telemetry.lost();
      return;
    }
    tools.delete(event.toolCallId);
    const outcome = ctx.signal?.aborted
      ? "aborted"
      : event.isError
        ? "error"
        : "success";
    if (run && outcome !== "success") run.outcome = outcome;
    if (toolNames.size < 16) toolNames.add(tool.name);
    const dimensions: Attributes = {
      "pi.tool.name": toolNames.has(tool.name) ? tool.name : "overflow",
      "pi.outcome": outcome,
    };
    if (!toolNames.has(tool.name)) telemetry.lost();
    toolCount.add(1, dimensions);
    const attrs: Attributes = {
      ...base(),
      "pi.tool.id": label(event.toolCallId),
      "pi.tool.name": tool.name,
      "pi.outcome": outcome,
      "pi.lifecycle_duration_ms": performance.now() - tool.start,
    };
    if (tool.parent) attrs["pi.tool.parent_id"] = tool.parent;
    if (valid(event.durationMs)) {
      attrs["pi.duration_ms"] = event.durationMs;
      toolDuration.record(event.durationMs, dimensions);
    }
    telemetry.emit("pi.tool.end", attrs);
  });
  pi.on("message_start", (event) => {
    if (!telemetry || event.message.role !== "assistant") return;
    if (request) telemetry.lost();
    request = { id: randomUUID(), start: performance.now() };
  });
  pi.on("message_end", (event: MessageEndEvent) => {
    if (!telemetry || event.message.role !== "assistant") return;
    const observation = request;
    request = undefined;
    if (!observation) {
      telemetry.lost();
      return;
    }
    const message = event.message;
    if (message.stopReason === "pending") return;
    const outcome =
      message.stopReason === "error"
        ? "error"
        : message.stopReason === "aborted"
          ? "aborted"
          : message.stopReason === "deferred"
            ? "incomplete"
            : "success";
    if (run && outcome !== "success") run.outcome = outcome;
    const provider = label(message.provider);
    const model = label(message.model);
    const attrs: Attributes = {
      ...base(),
      "pi.request.id": observation.id,
      "gen_ai.provider.name": provider,
      "gen_ai.request.model": model,
      "pi.outcome": outcome,
      "pi.duration_ms": performance.now() - observation.start,
    };
    // Eight distinct model/provider pairs keep four token types plus outcomes below 64 series.
    const key = `${provider}\0${model}`;
    if (models.size < 8) models.add(key);
    const dimensions: Attributes = models.has(key)
      ? { "gen_ai.provider.name": provider, "gen_ai.request.model": model }
      : { "pi.overflow": true };
    if (!models.has(key)) telemetry.lost();
    for (const [field, type] of [
      ["input", "input"],
      ["output", "output"],
      ["cacheRead", "cacheRead"],
      ["cacheWrite", "cacheCreation"],
    ] as const) {
      const value = message.usage?.[field];
      if (valid(value)) {
        attrs[`pi.usage.${type}`] = value;
        tokens.add(value, { ...dimensions, "pi.token.type": type });
      }
    }
    const reportedCost = message.usage?.cost?.total;
    if (valid(reportedCost)) {
      attrs["pi.estimated_cost"] = reportedCost;
      cost.add(reportedCost, dimensions);
    }
    telemetry.emit("pi.assistant.request", attrs);
  });
  pi.on("session_shutdown", async () => {
    if (!telemetry) return;
    interrupt();
    if (run) {
      telemetry.emit("pi.agent.end", { ...base(), "pi.outcome": "incomplete" });
      run = undefined;
    }
    telemetry.emit("pi.session.end", { "pi.session.id": sessionId });
    await telemetry.shutdown();
    telemetry = undefined;
    request = undefined;
  });
  pi.registerCommand("otel-status", {
    description: "Show local telemetry delivery status (not persistence)",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        telemetry?.status() ?? `pi-otel: disabled (${disabled})`,
        "info",
      );
    },
  });
}
