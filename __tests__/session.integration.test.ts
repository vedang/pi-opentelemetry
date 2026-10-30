import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { startSession } from "./fixtures/child.ts";
import { attributes, receiver } from "./fixtures/receiver.ts";

it("exports live assistant usage once across two delta intervals with observed model attribution", async () => {
  const collector = await receiver();
  const child = await startSession(collector.endpoint);
  try {
    const deadline = Date.now() + 23000;
    while (
      collector.requests.filter((request) => request.resourceMetrics).length <
        2 &&
      Date.now() < deadline
    )
      await delay(25);
    expect(
      collector.requests.filter((request) => request.resourceMetrics).length,
    ).toBeGreaterThanOrEqual(2);
    await child.action("status");
    expect(child.statuses[0]).toMatch(/unverified/);
    expect(child.statuses.at(-1)).toMatch(
      /healthy; logs=ok, metrics=ok; loss=no/,
    );
  } finally {
    const result = await child.stop();
    collector.close();
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.shutdownMs).toBeLessThan(1500);
  }
  const logs = collector.logs();
  expect(logs.every((log) => log.eventName === log.body.stringValue)).toBe(
    true,
  );
  const requests = logs
    .filter((log) => log.body.stringValue === "pi.llm_request")
    .map((log) => attributes(log.attributes));
  expect(requests).toHaveLength(2);
  expect(requests.map((record) => record["gen_ai.request.model"])).toEqual([
    "first",
    "second",
  ]);
  expect(new Set(requests.map((record) => record["pi.request.id"])).size).toBe(
    2,
  );
  expect(
    requests.every(
      (record) =>
        record["session.id"] === child.info.sessionId &&
        Number(record["pi.duration_ms"]) >= 0 &&
        record["pi.outcome"] === "success",
    ),
  ).toBe(true);
  const tokenMetrics = collector
    .metrics()
    .filter((metric) => metric.name === "pi.token.usage");
  expect(
    tokenMetrics.every(
      (metric) =>
        metric.sum?.aggregationTemporality === "AGGREGATION_TEMPORALITY_DELTA",
    ),
  ).toBe(true);
  const points = tokenMetrics.flatMap((metric) => metric.sum?.dataPoints ?? []);
  for (const model of ["first", "second"]) {
    const totals = Object.fromEntries(
      ["input", "output", "cacheRead", "cacheCreation"].map((type) => [
        type,
        points
          .filter((point) => {
            const attrs = attributes(point.attributes);
            return attrs.model === model && attrs.type === type;
          })
          .reduce(
            (sum, point) => sum + Number(point.asDouble ?? point.asInt ?? 0),
            0,
          ),
      ]),
    );
    expect(totals).toEqual({
      input: 3,
      output: 2,
      cacheRead: 1,
      cacheCreation: 4,
    });
  }
  const costs = collector
    .metrics()
    .filter((metric) => metric.name === "pi.cost.usage")
    .flatMap((metric) => metric.sum?.dataPoints ?? []);
  expect(
    costs.reduce(
      (sum, point) => sum + Number(point.asDouble ?? point.asInt ?? 0),
      0,
    ),
  ).toBeCloseTo(0.7);
  expect(JSON.stringify(collector.requests)).not.toContain(
    "FORBIDDEN_CONTENT_47f6",
  );
});
