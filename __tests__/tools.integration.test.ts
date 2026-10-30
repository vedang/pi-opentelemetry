import { expect, it } from "vitest";
import { startSession } from "./fixtures/child.ts";
import { attributes, receiver } from "./fixtures/receiver.ts";

it.each(["tools", "abort"])(
  "records real %s tool executions without adding inclusive tool usage",
  async (scenario) => {
    const collector = await receiver();
    try {
      const child = await startSession(collector.endpoint, {
        FIXTURE_SCENARIO: scenario,
      });
      const result = await child.stop();
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.shutdownMs).toBeLessThan(1500);
      const logs = collector.logs();
      const tools = logs
        .filter((log) => log.body.stringValue === "pi.tool_result")
        .map((log) => attributes(log.attributes));
      expect(tools).toHaveLength(scenario === "tools" ? 4 : 3);
      expect(new Set(tools.map((tool) => tool["tool.call.id"])).size).toBe(
        tools.length,
      );
      if (scenario === "tools") {
        expect(
          tools.find((tool) => tool["tool.name"] === "fails")?.["pi.outcome"],
        ).toBe("error");
        expect(
          tools.find((tool) => tool["tool.name"] === "inner")?.[
            "tool.parent_call.id"
          ],
        ).toBe("outer");
        expect(
          tools
            .filter((tool) => tool["tool.name"] !== "fails")
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
      const run = logs.filter((log) => log.body.stringValue === "pi.run_end");
      expect(run).toHaveLength(1);
      expect(
        Number(attributes(run[0].attributes)["pi.duration_ms"]),
      ).toBeGreaterThan(0);
      const requests = logs.filter(
        (log) => log.body.stringValue === "pi.llm_request",
      );
      // Pi finalizes an additional zero-usage aborted assistant observation
      // after cancellation during tools; observations are not paid requests.
      expect(requests).toHaveLength(2);
      expect(
        requests.map((request) => attributes(request.attributes)["pi.outcome"]),
      ).toEqual(
        scenario === "tools" ? ["success", "success"] : ["success", "aborted"],
      );
      const points = collector
        .metrics()
        .filter((metric) => metric.name === "pi.token.usage")
        .flatMap((metric) => metric.sum?.dataPoints ?? []);
      expect(
        points.reduce(
          (sum, point) => sum + Number(point.asDouble ?? point.asInt ?? 0),
          0,
        ),
      ).toBe(scenario === "tools" ? 20 : 10);
      const executions = collector
        .metrics()
        .filter((metric) => metric.name === "pi.tool.calls")
        .flatMap((metric) => metric.sum?.dataPoints ?? []);
      expect(
        executions.reduce(
          (sum, point) => sum + Number(point.asDouble ?? point.asInt ?? 0),
          0,
        ),
      ).toBe(tools.length);
    } finally {
      collector.close();
    }
  },
);
