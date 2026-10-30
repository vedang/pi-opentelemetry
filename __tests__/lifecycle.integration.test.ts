import { expect, it } from "vitest";
import { startSession } from "./fixtures/child.ts";
import { attributes, receiver } from "./fixtures/receiver.ts";

it("new/resume/fork/reload dispose old providers and never replay restored usage", async () => {
  const collector = await receiver();
  try {
    const child = await startSession(collector.endpoint, {
      FIXTURE_SCENARIO: "transitions",
      PI_OTEL_TRACES: "1",
    });
    const result = await child.stop();
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    const ids = child.info.ids;
    expect(ids).toHaveLength(5);
    expect(ids[1]).not.toBe(ids[0]);
    expect(ids[2]).toBe(ids[0]);
    expect(ids[3]).not.toBe(ids[0]);
    expect(ids[4]).toBe(ids[3]);
    const logs = collector.logs();
    expect(
      logs
        .filter((log) => log.body.stringValue === "pi.session_start")
        .map((log) => attributes(log.attributes)["session.id"]),
    ).toEqual(ids);
    expect(
      logs.filter((log) => log.body.stringValue === "pi.session_end"),
    ).toHaveLength(5);
    const requests = logs
      .filter((log) => log.body.stringValue === "pi.llm_request")
      .map((log) => attributes(log.attributes));
    expect(requests.map((request) => request["session.id"])).toEqual(
      ids.slice(0, 4),
    );
    expect(
      new Set(requests.map((request) => request["pi.request.id"])).size,
    ).toBe(4);
    expect(new Set(requests.map((request) => request["pi.run.id"])).size).toBe(
      4,
    );
    const resourceIds = new Set(
      collector.requests.flatMap(
        (request) =>
          request.resourceLogs?.map(
            (resource) =>
              attributes(resource.resource.attributes)["service.instance.id"],
          ) ?? [],
      ),
    );
    expect(resourceIds.size).toBe(5);
    const points = collector
      .metrics()
      .filter((metric) => metric.name === "pi.token.usage")
      .flatMap((metric) => metric.sum?.dataPoints ?? []);
    expect(
      points.reduce(
        (sum, point) => sum + Number(point.asDouble ?? point.asInt ?? 0),
        0,
      ),
    ).toBe(40);
    expect(
      collector.spans().filter((span) => span.name === "pi.agent_run"),
    ).toHaveLength(4);
  } finally {
    collector.close();
  }
});
