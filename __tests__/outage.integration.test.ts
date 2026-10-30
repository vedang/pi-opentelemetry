import { createServer, type Socket } from "node:net";
import { expect, it } from "vitest";
import { startSession } from "./fixtures/child.ts";
import { receiver } from "./fixtures/receiver.ts";

it("bounds real OTLP calls accepted by a receiver that never replies", async () => {
  const collector = await receiver("hung");
  let child: Awaited<ReturnType<typeof startSession>> | undefined;
  try {
    child = await startSession(collector.endpoint, { PI_OTEL_TRACES: "1" });
    await expect
      .poll(
        () => ({
          logs: collector.requests.some((request) => request.resourceLogs),
          metrics: collector.requests.some(
            (request) => request.resourceMetrics,
          ),
          traces: collector.requests.some((request) => request.resourceSpans),
        }),
        { timeout: 12000 },
      )
      .toEqual({ logs: true, metrics: true, traces: true });
    await child.action("prompt");
  } finally {
    try {
      if (child) {
        const result = await child.stop();
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("pi-otel: degraded (telemetry loss)\n");
        expect(result.shutdownMs).toBeLessThan(1500);
      }
    } finally {
      // Receiver sockets are not part of the child's resource-leak measurement.
      collector.close();
    }
  }
});

it.each([
  { mode: "refused", scenario: "assistant" },
  { mode: "hung", scenario: "assistant" },
  { mode: "hung", scenario: "load" },
  { mode: "hung", scenario: "transitions" },
])(
  "$mode transport with $scenario neither blocks Pi work nor prevents natural child exit",
  async ({ mode, scenario }) => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.resume(); // Consume requests without replying; do not retain unread FINs in the receiver.
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing temporary listener");
    if (mode === "refused")
      await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      const child = await startSession(`http://127.0.0.1:${address.port}`, {
        PI_OTEL_TRACES: "1",
        FIXTURE_SCENARIO: scenario,
      });
      // The ready barrier follows actual Pi prompts/tools/replacements; handlers never await exports.
      const result = await child.stop();
      expect(result.stdout).toBe("");
      expect(result.shutdownMs).toBeLessThan(1500);
      expect(result.stderr).toBe(
        "pi-otel: degraded (telemetry loss)\n".repeat(
          scenario === "transitions" ? 5 : 1,
        ),
      );
    } finally {
      for (const socket of sockets) socket.destroy();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
