import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSession } from "./session.ts";

export default function telemetryExtension(pi: ExtensionAPI) {
  registerSession(pi);
}
