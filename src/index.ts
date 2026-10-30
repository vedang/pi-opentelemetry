import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { configuration } from "./config.ts";

export default function telemetryExtension(pi: ExtensionAPI) {
  const config = configuration(process.env);
  pi.on("session_start", () => {
    if (!config.enabled && config.reason !== "off")
      process.stderr.write(`pi-otel: disabled (${config.reason})\n`);
  });
  pi.registerCommand("otel-status", {
    description: "Show local telemetry delivery status (not persistence)",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        config.enabled
          ? "pi-otel: unverified"
          : `pi-otel: disabled (${config.reason})`,
        "info",
      );
    },
  });
}
