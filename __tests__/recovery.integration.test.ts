import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { startSession } from "./fixtures/child.ts";
import { receiver } from "./fixtures/receiver.ts";

it("reports per-signal acknowledgements but keeps known export loss sticky after recovery", async () => {
  const collector = await receiver("fail");
  let child: Awaited<ReturnType<typeof startSession>> | undefined;
  try {
    child = await startSession(collector.endpoint, { PI_OTEL_TRACES: "1" });
    let deadline = Date.now() + 8000;
    while (
      (!collector.requests.some((request) => request.resourceLogs) ||
        !collector.requests.some((request) => request.resourceSpans)) &&
      Date.now() < deadline
    )
      await delay(25);
    expect(collector.requests.some((request) => request.resourceLogs)).toBe(
      true,
    );
    await child.action("status");
    expect(child.statuses.at(-1)).toMatch(
      /degraded.*logs=failed.*traces=failed.*loss=yes/,
    );
    collector.setMode("ok");
    await child.action("prompt");
    deadline = Date.now() + 12000;
    while (
      (collector.requests.filter((request) => request.resourceLogs).length <
        2 ||
        collector.requests.filter((request) => request.resourceSpans).length <
          2 ||
        !collector.requests.some((request) => request.resourceMetrics)) &&
      Date.now() < deadline
    )
      await delay(25);
    await child.action("status");
    expect(child.statuses.at(-1)).toBe(
      "pi-otel: degraded; logs=ok, metrics=ok, traces=ok; loss=yes",
    );
  } finally {
    try {
      if (child) {
        const result = await child.stop();
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("pi-otel: degraded (telemetry loss)\n");
        expect(result.shutdownMs).toBeLessThan(1500);
      }
    } finally {
      collector.close();
    }
  }
});
