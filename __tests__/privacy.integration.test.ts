import { expect, it } from "vitest";
import { startSession } from "./fixtures/child.ts";
import { attributes, receiver } from "./fixtures/receiver.ts";

it("isolates destinations/resources/credentials and excludes content in all three signals", async () => {
  const collector = await receiver();
  const trap = await receiver();
  const hostile: NodeJS.ProcessEnv = {
    PI_OTEL_TRACES: "1",
    FIXTURE_SCENARIO: "tools",
    OTEL_SERVICE_NAME: "FORBIDDEN_CONTENT_47f6",
    OTEL_RESOURCE_ATTRIBUTES: "secret=FORBIDDEN_CONTENT_47f6",
    OTEL_TRACES_SAMPLER: "always_off",
    OTEL_LOGS_EXPORTER: "console",
    OTEL_LOG_LEVEL: "ALL",
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "true",
    OTEL_LOG_USER_PROMPTS: "1",
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  };
  for (const signal of ["LOGS", "METRICS", "TRACES"]) {
    hostile[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`] = trap.endpoint;
    hostile[`OTEL_EXPORTER_OTLP_${signal}_PROTOCOL`] = "http/protobuf";
    hostile[`OTEL_EXPORTER_OTLP_${signal}_CERTIFICATE`] =
      "/FORBIDDEN_CONTENT_47f6";
    hostile[`OTEL_EXPORTER_OTLP_${signal}_CLIENT_KEY`] =
      "/FORBIDDEN_CONTENT_47f6";
    hostile[`OTEL_EXPORTER_OTLP_${signal}_CLIENT_CERTIFICATE`] =
      "/FORBIDDEN_CONTENT_47f6";
  }
  try {
    const child = await startSession(collector.endpoint, hostile);
    const result = await child.stop();
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(collector.logs().length).toBeGreaterThan(0);
    expect(collector.metrics().length).toBeGreaterThan(0);
    expect(collector.spans().length).toBeGreaterThan(0);
    expect(trap.requests).toHaveLength(0);
    expect(JSON.stringify(collector.requests)).not.toContain(
      "FORBIDDEN_CONTENT_47f6",
    );
    for (const request of collector.requests) {
      for (const resource of [
        ...(request.resourceLogs ?? []),
        ...(request.resourceMetrics ?? []),
        ...(request.resourceSpans ?? []),
      ])
        expect(attributes(resource.resource.attributes)["service.name"]).toBe(
          "pi-coding-agent",
        );
    }
  } finally {
    collector.close();
    trap.close();
  }
});

it.each([
  "disabled",
  "load-only",
  "invalid",
  "headers",
  "LOGS_headers",
  "METRICS_headers",
  "TRACES_headers",
])("%s cannot construct an exporter or send data", async (setting) => {
  const collector = await receiver();
  const env: NodeJS.ProcessEnv = {
    PI_OTEL_TRACES: "1",
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  };
  if (setting === "disabled") env.PI_OTEL_ENABLED = "0";
  if (setting === "load-only") env.FIXTURE_SCENARIO = "load-only";
  if (setting === "invalid")
    env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "http://FORBIDDEN_CONTENT_47f6@localhost:4317";
  if (setting.endsWith("headers"))
    env[
      `OTEL_EXPORTER_OTLP_${setting === "headers" ? "" : `${setting.split("_")[0]}_`}HEADERS`
    ] = "";
  try {
    const child = await startSession(collector.endpoint, env);
    const result = await child.stop();
    expect(collector.requests).toHaveLength(0);
    expect(result.stdout).toBe("");
    if (setting === "load-only") expect(child.statuses).toHaveLength(0);
    else expect(child.statuses[0]).toMatch(/^pi-otel: disabled/);
    expect(result.stderr).toBe(
      setting === "disabled" || setting === "load-only"
        ? ""
        : setting === "invalid"
          ? "pi-otel: disabled (invalid configuration)\n"
          : "pi-otel: disabled (inherited headers)\n",
    );
    expect(result.shutdownMs).toBeLessThan(1500);
  } finally {
    collector.close();
  }
});
