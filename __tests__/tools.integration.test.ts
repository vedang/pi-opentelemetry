import { expect, it } from "vitest";
import { startSession } from "./fixtures/child.ts";
import { attributes, receiver } from "./fixtures/receiver.ts";

it.each(["tools", "abort"])(
  "records real %s tool executions without adding inclusive tool usage",
  async (scenario) => {
    const collector = await receiver();
    const child = await startSession(collector.endpoint, {
      FIXTURE_SCENARIO: scenario,
    });
    try {
      const result = await child.stop();
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("FORBIDDEN_CONTENT_47f6");
      expect(result.shutdownMs).toBeLessThan(1500);
      const logs = collector.logs();
      const tools = logs
        .filter((log) => log.body.stringValue === "pi.tool.end")
        .map((log) => attributes(log.attributes));
      expect(tools).toHaveLength(scenario === "tools" ? 4 : 3);
      expect(new Set(tools.map((tool) => tool["pi.tool.id"])).size).toBe(
        tools.length,
      );
      if (scenario === "tools") {
        expect(
          tools.find((tool) => tool["pi.tool.name"] === "fails")?.[
            "pi.outcome"
          ],
        ).toBe("error");
        expect(
          tools.find((tool) => tool["pi.tool.name"] === "inner")?.[
            "pi.tool.parent_id"
          ],
        ).toBe("outer");
        expect(
          tools
            .filter((tool) => tool["pi.tool.name"] !== "fails")
            .every(
              (tool) =>
                tool["pi.outcome"] === "success" &&
                Number(tool["pi.duration_ms"]) > 0,
            ),
        ).toBe(true);
      } else {
        expect(tools.every((tool) => tool["pi.outcome"] === "aborted")).toBe(
          true,
        );
      }
      const run = logs.filter((log) => log.body.stringValue === "pi.agent.end");
      expect(run).toHaveLength(1);
      expect(
        Number(attributes(run[0].attributes)["pi.duration_ms"]),
      ).toBeGreaterThan(0);
      const requestCount = logs.filter(
        (log) => log.body.stringValue === "pi.assistant.request",
      ).length;
      expect(requestCount).toBe(scenario === "tools" ? 2 : 1);
      const points = collector
        .metrics()
        .filter((metric) => metric.name === "pi.assistant.tokens")
        .flatMap((metric) => metric.sum?.dataPoints ?? []);
      expect(
        points.reduce(
          (sum, point) => sum + Number(point.asDouble ?? point.asInt ?? 0),
          0,
        ),
      ).toBe(requestCount * 10);
      const executions = collector
        .metrics()
        .filter((metric) => metric.name === "pi.tool.executions")
        .flatMap((metric) => metric.sum?.dataPoints ?? []);
      expect(
        executions.reduce(
          (sum, point) => sum + Number(point.asDouble ?? point.asInt ?? 0),
          0,
        ),
      ).toBe(tools.length);
      expect(JSON.stringify(collector.requests)).not.toContain(
        "FORBIDDEN_CONTENT_47f6",
      );
    } finally {
      collector.close();
    }
  },
);
