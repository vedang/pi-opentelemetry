export type Config =
  | {
      enabled: false;
      reason: "off" | "invalid configuration" | "inherited headers";
    }
  | { enabled: true; endpoint: string; traces: boolean };

function boolean(value: string | undefined): boolean | undefined {
  if (value === undefined || /^(|0|false)$/i.test(value)) return false;
  if (/^(1|true)$/i.test(value)) return true;
  return undefined;
}

/** No environment values appear in diagnostics. Never resolve arbitrary hostnames. */
export function configuration(env: NodeJS.ProcessEnv): Config {
  const enabled = boolean(env.PI_OTEL_ENABLED);
  if (enabled === false) return { enabled: false, reason: "off" };
  const traces = boolean(env.PI_OTEL_TRACES);
  if (enabled === undefined || traces === undefined)
    return { enabled: false, reason: "invalid configuration" };
  if (
    [
      "OTEL_EXPORTER_OTLP_HEADERS",
      ...["LOGS", "METRICS", "TRACES"].map(
        (signal) => `OTEL_EXPORTER_OTLP_${signal}_HEADERS`,
      ),
    ].some((key) => env[key] !== undefined)
  )
    return { enabled: false, reason: "inherited headers" };
  try {
    const raw = env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:4317";
    const url = new URL(raw);
    // Validate the raw authority too: URL normalization must not admit aliases,
    // empty ports, dot segments, backslashes, percent escapes or credentials.
    if (
      !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?\/?$/.test(raw) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.port !== "" && Number(url.port) < 1) ||
      (env.OTEL_EXPORTER_OTLP_PROTOCOL ?? "grpc") !== "grpc"
    )
      throw new Error();
    return { enabled: true, endpoint: url.origin, traces };
  } catch {
    return { enabled: false, reason: "invalid configuration" };
  }
}
