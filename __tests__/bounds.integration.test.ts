import { expect, it } from "vitest";
import { startSession } from "./fixtures/child.ts";
import { attributes, receiver } from "./fixtures/receiver.ts";

it.each(["load", "cardinality"])(
  "%s overload is bounded, visible and cannot fabricate successful excess operations",
  async (scenario) => {
    const collector = await receiver();
    try {
      const child = await startSession(collector.endpoint, {
        FIXTURE_SCENARIO: scenario,
        PI_OTEL_TRACES: "1",
      });
      await child.action("status");
      const result = await child.stop();
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("pi-otel: degraded (telemetry loss)\n");
      expect(child.statuses.at(-1)).toMatch(/degraded.*loss=yes/);
      expect(result.shutdownMs).toBeLessThan(1500);
      for (const request of collector.requests) {
        const logs =
          request.resourceLogs?.flatMap((resource) =>
            resource.scopeLogs.flatMap((scope) => scope.logRecords),
          ) ?? [];
        const spans =
          request.resourceSpans?.flatMap((resource) =>
            resource.scopeSpans.flatMap((scope) => scope.spans),
          ) ?? [];
        expect(logs.length).toBeLessThanOrEqual(64);
        expect(spans.length).toBeLessThanOrEqual(64);
      }
      const metrics = collector.metrics();
      for (const metric of metrics)
        expect(
          (metric.sum ?? metric.histogram)?.dataPoints.length ?? 0,
        ).toBeLessThanOrEqual(64);
      if (scenario === "load") {
        const executions = metrics
          .filter((metric) => metric.name === "pi.tool.calls")
          .flatMap((metric) => metric.sum?.dataPoints ?? []);
        expect(
          executions.reduce(
            (sum, point) => sum + Number(point.asDouble ?? point.asInt ?? 0),
            0,
          ),
        ).toBe(1024);
      } else {
        const points = metrics
          .filter((metric) => metric.name === "pi.token.usage")
          .flatMap((metric) => metric.sum?.dataPoints ?? []);
        expect(
          points.reduce(
            (sum, point) => sum + Number(point.asDouble ?? point.asInt ?? 0),
            0,
          ),
        ).toBe(410);
        expect(
          points.some(
            (point) => attributes(point.attributes)["pi.overflow"] === true,
          ),
        ).toBe(true);
        expect(
          new Set(points.map((point) => JSON.stringify(point.attributes))).size,
        ).toBeLessThanOrEqual(36);
      }
    } finally {
      collector.close();
    }
  },
);
