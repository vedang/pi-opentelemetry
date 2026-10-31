import { expect, it } from "vitest";
import { startSession } from "./fixtures/child.ts";
import { attributes, receiver } from "./fixtures/receiver.ts";

it.for(["1", "0"])(
  "activity spans queued runs and pre-settlement continuation, traces=%s",
  async (traces, ctx) => {
    // FLAKY: pi-opentelemetryroot-bbt — scheduled trace export can overlap
    // shutdown. Owner deferred repair; keep assertions intact for opt-in runs.
    if (traces === "1" && process.env.PI_OTEL_RUN_FLAKY !== "1")
      ctx.skip("FLAKY: pi-opentelemetryroot-bbt; run make test-flaky");
    const collector = await receiver();
    let child: Awaited<ReturnType<typeof startSession>> | undefined;
    let released = false;
    try {
      child = await startSession(collector.endpoint, {
        FIXTURE_SCENARIO: "activity",
        PI_OTEL_TRACES: traces,
      });
      // The real fixture is blocked inside agent_before_settle, after two low-level
      // runs. Scheduled export proves starts are live, not reconstructed at end.
      await expect
        .poll(
          () =>
            collector
              .logs()
              .filter((log) => log.body.stringValue === "pi.run_end").length,
          { timeout: 8000 },
        )
        .toBe(2);
      const live = collector.logs();
      expect(
        live.filter((log) => log.body.stringValue === "pi.activity_start"),
      ).toHaveLength(1);
      expect(
        live.filter((log) => log.body.stringValue === "pi.activity_end"),
      ).toHaveLength(0);
      expect(
        live.filter((log) => log.body.stringValue === "pi.turn_start"),
      ).toHaveLength(3);
      released = true;
      await child.action("release");
      const active = child;
      child = undefined;
      const result = await active.stop();
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("");
      const logs = collector.logs();
      const records = (name: string) =>
        logs
          .filter((log) => log.body.stringValue === name)
          .map((log) => attributes(log.attributes));
      const activities = records("pi.activity_end");
      expect(activities).toHaveLength(1);
      expect(activities[0]).toMatchObject({
        "pi.outcome": "settled",
        "pi.aborted": false,
        "pi.had_error": true,
        "pi.message_type": "user",
      });
      const runs = records("pi.run_end");
      expect(runs).toHaveLength(3);
      expect(new Set(runs.map((record) => record["pi.activity.id"]))).toEqual(
        new Set([activities[0]["pi.activity.id"]]),
      );
      expect(new Set(runs.map((record) => record["pi.run.id"])).size).toBe(3);
      const turns = records("pi.turn_end");
      expect(turns.map((record) => record["pi.turn.index"])).toEqual([
        "0",
        "1",
        "0",
        "0",
      ]);
      expect(new Set(turns.map((record) => record["pi.turn.id"])).size).toBe(4);
      expect(
        records("pi.turn_start").map((record) => record["pi.turn.id"]),
      ).toEqual(turns.map((record) => record["pi.turn.id"]));
      for (const record of [
        ...records("pi.llm_request"),
        ...records("pi.tool_result"),
      ]) {
        const turn = turns.find(
          (turn) => turn["pi.turn.id"] === record["pi.turn.id"],
        );
        expect(turn).toBeDefined();
        expect(record["pi.run.id"]).toBe(turn?.["pi.run.id"]);
        expect(record["pi.activity.id"]).toBe(activities[0]["pi.activity.id"]);
      }
      expect(records("pi.session_end")[0]).toEqual({
        "session.id": runs[0]["session.id"],
        "pi.scope": "standalone",
      });
      const spans = collector.spans();
      if (traces === "0") {
        expect(spans).toHaveLength(0);
        expect(logs.every((log) => !log.traceId && !log.spanId)).toBe(true);
      } else {
        const activity = spans.find((span) => span.name === "pi.activity");
        expect(activity).toBeDefined();
        expect(activity?.status?.code ?? "STATUS_CODE_UNSET").toBe(
          "STATUS_CODE_UNSET",
        );
        for (const run of spans.filter((span) => span.name === "pi.agent_run"))
          expect(run.parentSpanId).toBe(activity?.spanId);
        for (const turn of spans.filter((span) => span.name === "pi.turn"))
          expect(turn.parentSpanId).toBe(
            spans.find(
              (span) =>
                span.name === "pi.agent_run" &&
                attributes(span.attributes)["pi.run.id"] ===
                  attributes(turn.attributes)["pi.run.id"],
            )?.spanId,
          );
      }
      for (const [name, count] of [
        ["pi.activity.count", 1],
        ["pi.run.count", 3],
        ["pi.turn.count", 4],
        ["pi.token.usage", 40],
      ] as const) {
        const points = collector
          .metrics()
          .filter((metric) => metric.name === name)
          .flatMap((metric) => metric.sum?.dataPoints ?? []);
        expect(
          points.reduce(
            (sum, point) => sum + Number(point.asDouble ?? point.asInt ?? 0),
            0,
          ),
        ).toBe(count);
      }
      for (const [name, count] of [
        ["pi.activity.duration", 1],
        ["pi.turn.duration", 4],
      ] as const) {
        const metrics = collector
          .metrics()
          .filter((metric) => metric.name === name);
        expect(metrics.every((metric) => metric.unit === "s")).toBe(true);
        expect(
          metrics
            .flatMap((metric) => metric.histogram?.dataPoints ?? [])
            .reduce((sum, point) => sum + Number(point.count), 0),
        ).toBe(count);
      }
      for (const metric of collector.metrics())
        for (const point of (metric.sum ?? metric.histogram)?.dataPoints ??
          []) {
          expect(
            Object.keys(attributes(point.attributes)).some(
              (key) => key.endsWith(".id") || key === "pi.turn.index",
            ),
          ).toBe(false);
        }
    } finally {
      try {
        if (child) {
          if (!released) await child.action("release");
          await child.stop();
        }
      } finally {
        collector.close();
      }
    }
  },
);

it.each(["custom", "steering", "abort", "reload-active"])(
  "real %s lifecycle has no stale ancestry or duplicate closure",
  async (scenario) => {
    const collector = await receiver();
    try {
      const child = await startSession(collector.endpoint, {
        FIXTURE_SCENARIO: scenario,
        PI_OTEL_TRACES: "1",
      });
      const result = await child.stop();
      expect(result.stderr).toBe(
        scenario === "reload-active"
          ? "pi-otel: degraded (telemetry loss)\n".repeat(2)
          : "",
      );
      const logs = collector.logs();
      const records = (name: string) =>
        logs
          .filter((log) => log.body.stringValue === name)
          .map((log) => attributes(log.attributes));
      const ends = records("pi.activity_end");
      const started = records("pi.activity_start");
      expect(started).toHaveLength(1);
      expect(ends.filter((record) => record["pi.activity.id"])).toHaveLength(1);
      expect(started[0]["pi.message_type"]).toBe(
        scenario === "custom" ? "custom" : "user",
      );
      expect(ends[0]["pi.activity.id"]).toBe(started[0]["pi.activity.id"]);
      if (scenario === "reload-active") {
        expect(ends[0]["pi.outcome"]).toBe("incomplete");
        expect(ends[0]).not.toHaveProperty("pi.duration_ms");
        expect(ends[0]).not.toHaveProperty("pi.aborted");
        for (const name of ["pi.turn_end", "pi.run_end", "pi.tool_result"]) {
          const incomplete = records(name).filter(
            (record) =>
              record["pi.activity.id"] && record["pi.outcome"] === "incomplete",
          );
          expect(incomplete.length).toBeGreaterThan(0);
          expect(
            incomplete.every((record) => !("pi.duration_ms" in record)),
          ).toBe(true);
        }
        const missing = ends.find((record) => record["pi.start_missing"]);
        expect(missing).toMatchObject({
          "pi.scope": "standalone",
          "pi.aborted": true,
          "pi.outcome": "incomplete",
        });
        expect(missing).not.toHaveProperty("pi.activity.id");
        const missingTurn = records("pi.turn_end").find(
          (record) => record["pi.start_missing"],
        );
        expect(missingTurn).toMatchObject({
          "pi.scope": "standalone",
          "pi.outcome": "incomplete",
        });
        expect(missingTurn).not.toHaveProperty("pi.turn.id");
        expect(missingTurn).not.toHaveProperty("pi.duration_ms");
        for (const name of [
          "pi.activity.count",
          "pi.run.count",
          "pi.turn.count",
        ]) {
          const points = collector
            .metrics()
            .filter((metric) => metric.name === name)
            .flatMap((metric) => metric.sum?.dataPoints ?? [])
            .filter(
              (point) => attributes(point.attributes).outcome === "incomplete",
            );
          expect(
            points.reduce(
              (sum, point) => sum + Number(point.asDouble ?? point.asInt ?? 0),
              0,
            ),
          ).toBe(1);
        }
        expect(
          collector
            .metrics()
            .filter((metric) => metric.name === "pi.activity.duration"),
        ).toHaveLength(0);
        // Cancellation can produce a new standalone turn after reload. Only
        // its actual paired terminal may contribute a measured duration.
        const measuredTurns = records("pi.turn_end").filter(
          (record) => "pi.duration_ms" in record,
        );
        expect(
          measuredTurns.every((record) => !("pi.activity.id" in record)),
        ).toBe(true);
        expect(
          collector
            .metrics()
            .filter((metric) => metric.name === "pi.turn.duration")
            .flatMap((metric) => metric.histogram?.dataPoints ?? [])
            .reduce((sum, point) => sum + Number(point.count), 0),
        ).toBe(measuredTurns.length);
      } else {
        expect(ends).toHaveLength(1);
        expect(ends[0]).toMatchObject({
          "pi.outcome": "settled",
          "pi.aborted": scenario === "abort",
        });
        if (scenario === "steering")
          expect(records("pi.turn_end").length).toBeGreaterThanOrEqual(3);
      }
      for (const name of ["pi.activity_end", "pi.run_end", "pi.turn_end"]) {
        const id =
          name === "pi.activity_end"
            ? "pi.activity.id"
            : name === "pi.run_end"
              ? "pi.run.id"
              : "pi.turn.id";
        const ids = records(name)
          .map((record) => record[id])
          .filter(Boolean);
        expect(new Set(ids).size).toBe(ids.length);
      }
      expect(JSON.stringify(collector.requests)).not.toContain(
        "FORBIDDEN_CONTENT_47f6",
      );
    } finally {
      collector.close();
    }
  },
);
