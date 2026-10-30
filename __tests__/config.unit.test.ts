import { expect, it } from "vitest";
import { configuration } from "../src/config.ts";

it("requires Pi opt-in and rejects unsafe destinations without reflecting secrets", () => {
  expect(configuration({ CLAUDE_CODE_ENABLE_TELEMETRY: "1" })).toEqual({
    enabled: false,
    reason: "off",
  });
  for (const endpoint of [
    "http://remote.invalid:4317",
    "https://localhost:4317",
    "http://secret@localhost",
    "http://localhost/x",
    "http://localhost?secret",
    "http://localhost#secret",
    "http://127.1",
    "http://localhost:",
    "http://localhost:0",
    "http://localhost/../",
    "http://localhost:65536",
  ]) {
    expect(
      configuration({
        PI_OTEL_ENABLED: "1",
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      }),
    ).toEqual({ enabled: false, reason: "invalid configuration" });
  }
  for (const signal of ["", "LOGS_", "METRICS_", "TRACES_"]) {
    expect(
      configuration({
        PI_OTEL_ENABLED: "true",
        [`OTEL_EXPORTER_OTLP_${signal}HEADERS`]: "",
      }),
    ).toEqual({ enabled: false, reason: "inherited headers" });
  }
  for (const endpoint of [
    "http://localhost:4317",
    "http://127.0.0.1:4317/",
    "http://[::1]:4317",
  ]) {
    expect(
      configuration({
        PI_OTEL_ENABLED: "TRUE",
        PI_OTEL_TRACES: "1",
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      }),
    ).toMatchObject({ enabled: true, traces: true });
  }
  for (const env of [
    { PI_OTEL_ENABLED: "yes" },
    { PI_OTEL_ENABLED: "1", PI_OTEL_TRACES: "yes" },
    { PI_OTEL_ENABLED: "1", OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf" },
  ])
    expect(configuration(env).enabled).toBe(false);
});
