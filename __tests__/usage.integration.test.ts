import { expect, it } from "vitest";
import { startSession } from "./fixtures/child.ts";
import { attributes, receiver } from "./fixtures/receiver.ts";

it("retains reported unsuccessful usage, omits unknown cost and rejects malformed numeric amounts", async () => {
  const collector = await receiver();
  try {
    const child = await startSession(collector.endpoint, {
      FIXTURE_SCENARIO: "usage",
      PI_OTEL_TRACES: "1",
    });
    const result = await child.stop();
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    const requests = collector
      .logs()
      .filter((log) => log.body.stringValue === "pi.llm_request")
      .map((log) => attributes(log.attributes));
    expect(requests.map((record) => record["pi.outcome"])).toEqual([
      "error",
      "aborted",
      "success",
    ]);
    expect(requests[0]["pi.estimated_cost"]).toBeCloseTo(0.35);
    expect(requests[1]).not.toHaveProperty("pi.estimated_cost");
    expect(requests[2]).not.toHaveProperty("pi.usage.input");
    expect(requests[2]).not.toHaveProperty("pi.usage.output");
    expect(requests[2]).not.toHaveProperty("pi.usage.cacheRead");
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
    const costs = collector
      .metrics()
      .filter((metric) => metric.name === "pi.cost.usage")
      .flatMap((metric) => metric.sum?.dataPoints ?? []);
    expect(
      costs.reduce(
        (sum, point) => sum + Number(point.asDouble ?? point.asInt ?? 0),
        0,
      ),
    ).toBeCloseTo(0.35);
    expect(JSON.stringify(collector.requests)).not.toContain(
      "FORBIDDEN_CONTENT_47f6",
    );
  } finally {
    collector.close();
  }
});
