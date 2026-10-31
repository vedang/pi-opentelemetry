import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  MessageEndEvent,
} from "@earendil-works/pi-coding-agent";
import { type Attributes, ROOT_CONTEXT, type Span } from "@opentelemetry/api";
import { configuration } from "./config.ts";
import { label, Telemetry } from "./telemetry.ts";

function valid(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// Pi providers can use composite IDs (call_id|response_item_id), and nested
// executions append /n. Keep the existing bounds without widening other labels.
function toolId(value: string): string {
  return /^[a-zA-Z0-9_.:/|-]{1,128}$/.test(value) ? value : "other";
}

export function registerSession(pi: ExtensionAPI) {
  let telemetry: Telemetry | undefined;
  let disabled = "off";
  let sessionId = "";
  let runId = "";
  let request: { id: string; start: number; span?: Span } | undefined;
  let run: { start: number; outcome: string; span?: Span } | undefined;
  const tools = new Map<
    string,
    { start: number; name: string; parent?: string; span?: Span }
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
    "session.id": sessionId,
    "pi.run.id": runId,
  });

  const incomplete = () => {
    if (run?.outcome === "success") run.outcome = "incomplete";
    telemetry?.lost();
  };

  const interrupt = () => {
    if (!telemetry) return;
    if (request) {
      const attrs = {
        ...base(),
        "pi.request.id": request.id,
        "pi.outcome": "incomplete",
      };
      telemetry.emit("pi.llm_request", attrs, request.span);
      telemetry.finish(request.span, attrs, "incomplete");
      request = undefined;
      incomplete();
    }
    for (const [id, tool] of tools) {
      const attrs = {
        ...base(),
        "tool.call.id": id,
        "tool.name": tool.name,
        "pi.outcome": "incomplete",
      };
      telemetry.emit("pi.tool_result", attrs, tool.span);
      telemetry.finish(tool.span, attrs, "incomplete");
    }
    if (tools.size) incomplete();
    tools.clear();
  };

  const dispose = async () => {
    if (!telemetry) return;
    interrupt();
    if (run) {
      const attrs = { ...base(), "pi.outcome": "incomplete" };
      telemetry.emit("pi.run_end", attrs, run.span);
      telemetry.finish(run.span, attrs, "incomplete");
      run = undefined;
    }
    telemetry.emit("pi.session_end", { "session.id": sessionId });
    await telemetry.shutdown();
    telemetry = undefined;
    request = undefined;
  };

  pi.on("session_start", async (_event, ctx) => {
    await dispose();
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
    tokens = telemetry.meter.createCounter("pi.token.usage", {
      unit: "{token}",
    });
    cost = telemetry.meter.createCounter("pi.cost.usage", {
      unit: "USD",
    });
    runs = telemetry.meter.createCounter("pi.run.count");
    runDuration = telemetry.meter.createHistogram("pi.run.duration", {
      unit: "s",
    });
    toolCount = telemetry.meter.createCounter("pi.tool.calls");
    toolDuration = telemetry.meter.createHistogram("pi.tool.duration", {
      unit: "s",
    });
    telemetry.meter
      .createCounter("pi.session.count")
      .add(1, { start_type: _event.reason }, ROOT_CONTEXT);
    telemetry.emit("pi.session_start", { "session.id": sessionId });
  });
  pi.on("agent_start", () => {
    if (!telemetry) return;
    interrupt();
    if (run) {
      telemetry.finish(run.span, { "pi.outcome": "incomplete" }, "incomplete");
      telemetry.lost();
    }
    runId = randomUUID();
    run = {
      start: performance.now(),
      outcome: "success",
      span: telemetry.start("pi.agent_run", base()),
    };
    telemetry.emit("pi.run_start", base(), run.span);
  });
  pi.on("agent_end", (_event, ctx) => {
    if (!telemetry || !run) return;
    interrupt();
    const outcome = ctx.signal?.aborted ? "aborted" : run.outcome;
    const elapsed = performance.now() - run.start;
    const dimensions = { outcome };
    runs.add(1, dimensions, ROOT_CONTEXT);
    runDuration.record(elapsed / 1000, dimensions, ROOT_CONTEXT);
    const attrs = {
      ...base(),
      "pi.outcome": outcome,
      "pi.duration_ms": elapsed,
      "timing.source": "agent_lifecycle",
    };
    telemetry.emit("pi.run_end", attrs, run.span);
    telemetry.finish(run.span, attrs, outcome);
    run = undefined;
  });
  pi.on("tool_execution_start", (event) => {
    if (!telemetry) return;
    if (
      tools.size >= 1024 ||
      toolId(event.toolCallId) !== event.toolCallId ||
      tools.has(event.toolCallId)
    ) {
      incomplete();
      return;
    }
    const parent = event.parentToolCallId
      ? tools.get(event.parentToolCallId)?.span
      : undefined;
    const attrs: Attributes = {
      ...base(),
      "tool.call.id": event.toolCallId,
      "tool.name": label(event.toolName),
    };
    if (event.parentToolCallId) {
      attrs["tool.parent_call.id"] = toolId(event.parentToolCallId);
      if (!tools.has(event.parentToolCallId)) attrs["pi.parent.unknown"] = true;
    }
    tools.set(event.toolCallId, {
      start: performance.now(),
      name: label(event.toolName),
      parent: event.parentToolCallId
        ? toolId(event.parentToolCallId)
        : undefined,
      span: telemetry.start("pi.tool", attrs, parent ?? run?.span),
    });
  });
  pi.on("tool_execution_end", (event, ctx) => {
    if (!telemetry) return;
    const tool = tools.get(event.toolCallId);
    if (!tool) {
      incomplete();
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
      "tool.name": toolNames.has(tool.name) ? tool.name : "overflow",
      outcome,
    };
    if (!toolNames.has(tool.name)) telemetry.lost();
    toolCount.add(1, dimensions, ROOT_CONTEXT);
    const attrs: Attributes = {
      ...base(),
      "tool.call.id": toolId(event.toolCallId),
      "tool.name": tool.name,
      "pi.outcome": outcome,
      "pi.lifecycle_duration_ms": performance.now() - tool.start,
      "timing.source": "tool_lifecycle",
    };
    if (tool.parent) attrs["tool.parent_call.id"] = tool.parent;
    if (valid(event.durationMs)) {
      attrs["pi.duration_ms"] = event.durationMs;
      attrs["timing.source"] = "pi_tool_execute";
      toolDuration.record(event.durationMs / 1000, dimensions, ROOT_CONTEXT);
    }
    telemetry.emit("pi.tool_result", attrs, tool.span);
    telemetry.finish(tool.span, attrs, outcome);
  });
  pi.on("message_start", (event) => {
    if (!telemetry || event.message.role !== "assistant") return;
    if (request) {
      telemetry.finish(
        request.span,
        { "pi.outcome": "incomplete" },
        "incomplete",
      );
      incomplete();
    }
    const id = randomUUID();
    request = {
      id,
      start: performance.now(),
      span: telemetry.start(
        "pi.llm_request",
        { ...base(), "pi.request.id": id, "gen_ai.operation.name": "chat" },
        run?.span,
      ),
    };
  });
  pi.on("message_end", (event: MessageEndEvent, ctx) => {
    if (!telemetry || event.message.role !== "assistant") return;
    const observation = request;
    request = undefined;
    if (!observation) {
      incomplete();
      return;
    }
    const message = event.message;
    if (message.stopReason === "pending") {
      telemetry.finish(
        observation.span,
        { "pi.outcome": "incomplete" },
        "incomplete",
      );
      incomplete();
      return;
    }
    // Pi can finalize cancellation as an error message. Classify from the
    // public operation signal, never from potentially sensitive error text.
    const outcome =
      message.stopReason === "aborted" || ctx.signal?.aborted
        ? "aborted"
        : message.stopReason === "error"
          ? "error"
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
      "timing.source": "assistant_lifecycle",
    };
    // Eight distinct model/provider pairs keep four token types plus outcomes below 64 series.
    const key = `${provider}\0${model}`;
    if (models.size < 8) models.add(key);
    const dimensions: Attributes = models.has(key)
      ? { provider, model, source: "assistant" }
      : { "pi.overflow": true, source: "assistant" };
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
        tokens.add(value, { ...dimensions, type }, ROOT_CONTEXT);
      }
    }
    const reportedCost = message.usage?.cost?.total;
    if (valid(reportedCost)) {
      attrs["pi.estimated_cost"] = reportedCost;
      cost.add(reportedCost, dimensions, ROOT_CONTEXT);
    }
    if (message.responseId && label(message.responseId) === message.responseId)
      attrs["gen_ai.response.id"] = message.responseId;
    if (message.responseModel)
      attrs["gen_ai.response.model"] = label(message.responseModel);
    telemetry.emit("pi.llm_request", attrs, observation.span);
    telemetry.finish(observation.span, attrs, outcome);
  });
  pi.on("session_shutdown", dispose);
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
