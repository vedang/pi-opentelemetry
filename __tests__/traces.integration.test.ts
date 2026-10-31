import { expect, it } from "vitest";
import { startSession } from "./fixtures/child.ts";
import { attributes, receiver } from "./fixtures/receiver.ts";

it.each(["1", "0"])(
  "trace toggle=%s preserves accounting and explicit log/run/request/tool correlation",
  async (traces) => {
    const collector = await receiver();
    try {
      const child = await startSession(collector.endpoint, {
        FIXTURE_SCENARIO: "tools",
        PI_OTEL_TRACES: traces,
      });
      const result = await child.stop();
      expect(result.stdout).toBe("");
      expect(result.shutdownMs).toBeLessThan(1500);
      expect(result.stderr).toBe("");
      const logs = collector
        .logs()
        .filter((log) =>
          ["pi.llm_request", "pi.tool_result", "pi.run_end"].includes(
            log.body.stringValue,
          ),
        );
      expect(logs).toHaveLength(7);
      expect(
        new Set(logs.map((log) => attributes(log.attributes)["pi.run.id"]))
          .size,
      ).toBe(1);
      const spans = collector.spans();
      if (traces === "0") {
        expect(spans).toHaveLength(0);
        expect(logs.every((log) => !log.traceId && !log.spanId)).toBe(true);
        expect(
          logs
            .filter((log) => log.body.stringValue === "pi.llm_request")
            .every((log) => attributes(log.attributes)["pi.request.id"]),
        ).toBe(true);
      } else {
        expect(spans).toHaveLength(7);
        const root = spans.find((span) => span.name === "pi.agent_run");
        expect(root).toBeDefined();
        if (!root) throw new Error("Missing run span");
        expect(root.parentSpanId ?? "").toBe("");
        expect(new Set(spans.map((span) => span.traceId)).size).toBe(1);
        const outer = spans.find(
          (span) =>
            attributes(span.attributes)["tool.call.id"] ===
            "call_outer|fc_outer",
        );
        const nested = spans.find(
          (span) => attributes(span.attributes)["tool.name"] === "inner",
        );
        const sibling = spans.find(
          (span) => attributes(span.attributes)["tool.call.id"] === "sibling",
        );
        expect(nested?.parentSpanId).toBe(outer?.spanId);
        expect(
          spans
            .filter((span) => span !== root && span !== nested)
            .every((span) => span.parentSpanId === root.spanId),
        ).toBe(true);
        if (!outer || !sibling || !nested)
          throw new Error("Missing tool spans");
        expect(BigInt(outer.startTimeUnixNano)).toBeLessThan(
          BigInt(sibling.endTimeUnixNano),
        );
        expect(BigInt(sibling.startTimeUnixNano)).toBeLessThan(
          BigInt(outer.endTimeUnixNano),
        );
        expect(BigInt(nested.startTimeUnixNano)).toBeGreaterThanOrEqual(
          BigInt(outer.startTimeUnixNano),
        );
        expect(BigInt(nested.endTimeUnixNano)).toBeLessThanOrEqual(
          BigInt(outer.endTimeUnixNano),
        );
        expect(
          spans.every(
            (span) =>
              BigInt(span.startTimeUnixNano) <= BigInt(span.endTimeUnixNano),
          ),
        ).toBe(true);
        expect(
          spans.find(
            (span) => attributes(span.attributes)["tool.call.id"] === "fails",
          )?.status?.code,
        ).toBe("STATUS_CODE_ERROR");
        for (const log of logs) {
          const span = spans.find((span) => span.spanId === log.spanId);
          expect(span?.traceId).toBe(log.traceId);
          expect(span).toBeDefined();
        }
      }
      const points = collector
        .metrics()
        .filter((metric) => metric.name === "pi.token.usage")
        .flatMap((metric) => metric.sum?.dataPoints ?? []);
      expect(
        points.reduce(
          (sum, point) => sum + Number(point.asDouble ?? point.asInt ?? 0),
          0,
        ),
      ).toBe(20);
    } finally {
      collector.close();
    }
  },
);
