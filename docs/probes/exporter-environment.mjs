// Discovery reproduction, NOT a release acceptance suite or an OTLP payload decoder.
// Run in a temporary pnpm project as documented in ../contracts.md.
// No credentials, Pi session, external receiver, or global configuration is used.
import assert from "node:assert/strict";
import {
  credentials,
  Metadata,
  Server,
  ServerCredentials,
} from "@grpc/grpc-js";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";

const server = new Server();
let received;
server.addService(
  {
    export: {
      path: "/opentelemetry.proto.collector.logs.v1.LogsService/Export",
      requestStream: false,
      responseStream: false,
      requestSerialize: (value) => value,
      requestDeserialize: (value) => value,
      responseSerialize: (value) => value,
      responseDeserialize: (value) => value,
    },
  },
  {
    export(call, done) {
      received = call.metadata.getMap();
      // Empty protobuf response is a valid ExportLogsServiceResponse.
      done(null, Buffer.alloc(0));
    },
  },
);
const port = await new Promise((resolve, reject) => {
  server.bindAsync(
    "127.0.0.1:0",
    ServerCredentials.createInsecure(),
    (error, boundPort) => (error ? reject(error) : resolve(boundPort)),
  );
});
// Changes are confined to this standalone discovery subprocess.
process.env.OTEL_EXPORTER_OTLP_HEADERS =
  "x-discovery-secret=INHERITED_SENTINEL";
process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS =
  "x-signal-secret=SIGNAL_SENTINEL";
const exporter = new OTLPLogExporter({
  url: `http://127.0.0.1:${port}`,
  metadata: new Metadata(),
  credentials: credentials.createInsecure(),
  compression: "none",
  timeoutMillis: 1000,
  concurrencyLimit: 1,
});
const provider = new LoggerProvider({
  resource: resourceFromAttributes({ "service.name": "discovery-only" }),
  processors: [new SimpleLogRecordProcessor({ exporter })],
});
try {
  provider.getLogger("discovery").emit({ body: "metadata-only local discovery" });
  await provider.forceFlush();
  // SimpleLogRecordProcessor.forceFlush does not wait for synchronous-resource
  // exports in SDK 3.0.0; wait at the actual exporter boundary before inspecting.
  await exporter.forceFlush();
  assert.ok(received, "Receiver must actually observe a request");
  assert.equal(received["x-discovery-secret"], "INHERITED_SENTINEL");
  assert.equal(received["x-signal-secret"], "SIGNAL_SENTINEL");
  console.log(
    JSON.stringify({
      inheritedGeneralHeader: received["x-discovery-secret"],
      inheritedSignalHeader: received["x-signal-secret"],
    }),
  );
} finally {
  await provider.shutdown();
  await new Promise((resolve) => server.tryShutdown(resolve));
}
