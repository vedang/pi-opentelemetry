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
  let tokens: ReturnType<Telemetry["meter"]["createCounter"]>;
  let cost: ReturnType<Telemetry["meter"]["createCounter"]>;
  const models = new Set<string>();
  const base = (): Attributes => ({
    "pi.session.id": sessionId,
    "pi.run.id": runId,
  });

  pi.on("session_start", async (_event, ctx) => {
    await telemetry?.shutdown();
    telemetry = undefined;
    request = undefined;
    runId = "";
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
    telemetry.meter.createCounter("pi.session.activations").add(1);
    telemetry.emit("pi.session.start", { "pi.session.id": sessionId });
  });
  pi.on("agent_start", () => {
    if (!telemetry) return;
    runId = randomUUID();
    request = undefined;
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
