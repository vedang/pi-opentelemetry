import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Server,
  ServerCredentials,
  type ServerUnaryCall,
  type sendUnaryData,
} from "@grpc/grpc-js";
import protobuf from "protobufjs";

interface KeyValue {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string;
    doubleValue?: number;
    boolValue?: boolean;
  };
}
interface WireLog {
  eventName: string;
  body: { stringValue: string };
  attributes: KeyValue[];
  traceId?: string;
  spanId?: string;
}
interface WirePoint {
  attributes: KeyValue[];
  asDouble?: number;
  asInt?: string;
  count?: string;
  sum?: number;
}
interface WireMetric {
  name: string;
  sum?: { aggregationTemporality: string; dataPoints: WirePoint[] };
  histogram?: { aggregationTemporality: string; dataPoints: WirePoint[] };
}
interface WireSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: KeyValue[];
  status?: { code?: string };
}
interface Request {
  resourceLogs?: {
    resource: { attributes: KeyValue[] };
    scopeLogs: { logRecords: WireLog[] }[];
  }[];
  resourceMetrics?: {
    resource: { attributes: KeyValue[] };
    scopeMetrics: { metrics: WireMetric[] }[];
  }[];
  resourceSpans?: {
    resource: { attributes: KeyValue[] };
    scopeSpans: { spans: WireSpan[] }[];
  }[];
}

export function attributes(values: KeyValue[] = []) {
  return Object.fromEntries(
    values.map(({ key, value }) => [
      key,
      value.stringValue ??
        value.intValue ??
        value.doubleValue ??
        value.boolValue,
    ]),
  );
}

/** Vendored upstream v1.9.0 definitions, decoded by maintained protobufjs (not our encoder). */
export async function receiver(mode: "ok" | "hung" | "fail" = "ok") {
  const root = new protobuf.Root();
  const base = fileURLToPath(new URL("./proto/", import.meta.url));
  root.resolvePath = (_origin, target) => resolve(base, target);
  root.loadSync(
    ["logs", "metrics", "trace"].map(
      (signal) =>
        `opentelemetry/proto/collector/${signal}/v1/${signal}_service.proto`,
    ),
  );
  const server = new Server();
  const requests: Request[] = [];
  for (const [signal, name] of [
    ["logs", "Logs"],
    ["metrics", "Metrics"],
    ["trace", "Trace"],
  ]) {
    const type = root.lookupType(
      `opentelemetry.proto.collector.${signal}.v1.Export${name}ServiceRequest`,
    );
    server.addService(
      {
        export: {
          path: `/opentelemetry.proto.collector.${signal}.v1.${name}Service/Export`,
          requestStream: false,
          responseStream: false,
          requestSerialize: (buffer: Buffer) => buffer,
          requestDeserialize: (buffer: Buffer) =>
            type.toObject(type.decode(buffer), {
              longs: String,
              bytes: String,
              enums: String,
            }) as Request,
          responseSerialize: () => Buffer.alloc(0),
          responseDeserialize: (buffer: Buffer) => buffer,
        },
      },
      {
        export(
          call: ServerUnaryCall<Request, object>,
          callback: sendUnaryData<object>,
        ) {
          requests.push(call.request);
          if (mode === "ok") callback(null, {});
          if (mode === "fail")
            callback({ code: 3, details: "FORBIDDEN_CONTENT_47f6" });
        },
      },
    );
  }
  const port = await new Promise<number>((res, rej) =>
    server.bindAsync(
      "127.0.0.1:0",
      ServerCredentials.createInsecure(),
      (error, port) => (error ? rej(error) : res(port)),
    ),
  );
  return {
    endpoint: `http://127.0.0.1:${port}`,
    requests,
    logs: () =>
      requests.flatMap(
        (request) =>
          request.resourceLogs?.flatMap((resource) =>
            resource.scopeLogs.flatMap((scope) => scope.logRecords),
          ) ?? [],
      ),
    metrics: () =>
      requests.flatMap(
        (request) =>
          request.resourceMetrics?.flatMap((resource) =>
            resource.scopeMetrics.flatMap((scope) => scope.metrics),
          ) ?? [],
      ),
    spans: () =>
      requests.flatMap(
        (request) =>
          request.resourceSpans?.flatMap((resource) =>
            resource.scopeSpans.flatMap((scope) => scope.spans),
          ) ?? [],
      ),
    setMode(value: "ok" | "hung" | "fail") {
      mode = value;
    },
    close: () => server.forceShutdown(),
  };
}
