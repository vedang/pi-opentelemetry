import { randomUUID } from "node:crypto";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { credentials, Metadata } from "@grpc/grpc-js";
import {
  type Attributes,
  ROOT_CONTEXT,
  type Span,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
} from "@opentelemetry/sdk-logs";
import {
  AggregationTemporality,
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  type SpanExporter,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import type { Config } from "./config.ts";

const batching = {
  maxQueueSize: 64,
  maxExportBatchSize: 64,
  scheduledDelayMillis: 5000,
  exportTimeoutMillis: 150,
};
export function label(value: string): string {
  return /^[a-zA-Z0-9_.:/-]{1,128}$/.test(value) ? value : "other";
}

/** One private owner per active Pi session. No global providers or diagnostics. */
export class Telemetry {
  readonly instance = randomUUID();
  private readonly exporters: { shutdown(): Promise<void> }[];
  private readonly traces?: TracerProvider;
  private readonly tracer?: ReturnType<TracerProvider["getTracer"]>;
  private pendingSpans = 0;
  private readonly logs;
  private readonly metrics;
  private readonly logger;
  readonly meter;
  private closing?: Promise<void>;
  private pendingLogs = 0;
  private loss = false;
  private warned = false;
  private readonly results: Record<string, "unverified" | "ok" | "failed"> = {
    logs: "unverified",
    metrics: "unverified",
  };

  constructor(config: Extract<Config, { enabled: true }>) {
    const options = {
      url: config.endpoint,
      credentials: credentials.createInsecure(),
      metadata: new Metadata(),
      compression: "none" as NonNullable<
        ConstructorParameters<typeof OTLPLogExporter>[0]
      >["compression"],
      timeoutMillis: 100,
      concurrencyLimit: 1,
    };
    const resource = resourceFromAttributes({
      "service.name": "pi-coding-agent",
      "service.version": label(VERSION),
      "service.instance.id": this.instance,
    });
    const logExporter = new OTLPLogExporter(options);
    const metricExporter = new OTLPMetricExporter({
      ...options,
      temporalityPreference: AggregationTemporality.DELTA,
    });
    this.exporters = [logExporter, metricExporter];
    const observedLogs: LogRecordExporter = {
      export: (records, callback) =>
        logExporter.export(records, (result) => {
          this.pendingLogs -= records.length;
          this.result("logs", result.code);
          callback({ code: result.code });
        }),
      forceFlush: () => logExporter.forceFlush(),
      shutdown: () => logExporter.shutdown(),
    };
    const observedMetrics: PushMetricExporter = {
      export: (data, callback) =>
        metricExporter.export(data, (result) => {
          this.result("metrics", result.code);
          callback({ code: result.code });
        }),
      selectAggregationTemporality: () => AggregationTemporality.DELTA,
      forceFlush: () => metricExporter.forceFlush(),
      shutdown: () => metricExporter.shutdown(),
    };
    this.logs = new LoggerProvider({
      resource,
      logRecordLimits: {
        attributeCountLimit: 32,
        attributeValueLengthLimit: 128,
      },
      processors: [
        new BatchLogRecordProcessor({ ...batching, exporter: observedLogs }),
      ],
    });
    this.metrics = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: observedMetrics,
          exportIntervalMillis: 10000,
          exportTimeoutMillis: 150,
          cardinalityLimits: { default: 64 },
        }),
      ],
    });
    if (config.traces) {
      this.results.traces = "unverified";
      const exporter = new OTLPTraceExporter(options);
      this.exporters.push(exporter);
      const observed: SpanExporter = {
        export: (spans, callback) =>
          exporter.export(spans, (result) => {
            this.pendingSpans -= spans.length;
            this.result("traces", result.code);
            callback({ code: result.code });
          }),
        shutdown: () => exporter.shutdown(),
      };
      const batch = new BatchSpanProcessor({ ...batching, exporter: observed });
      this.traces = new TracerProvider({
        resource,
        sampler: new AlwaysOnSampler(),
        spanLimits: {
          attributeCountLimit: 32,
          attributeValueLengthLimit: 128,
          eventCountLimit: 0,
          linkCountLimit: 0,
        },
        spanProcessors: [
          {
            onStart: () => {},
            onEnd: (span) => {
              if (this.pendingSpans >= 64) {
                this.lost();
                return;
              }
              this.pendingSpans++;
              batch.onEnd(span);
            },
            forceFlush: () => batch.forceFlush(),
            shutdown: () => batch.shutdown(),
          },
        ],
      });
      this.tracer = this.traces.getTracer("pi-opentelemetry", "0.1.0");
    }
    this.logger = this.logs.getLogger("pi-opentelemetry", "0.1.0");
    this.meter = this.metrics.getMeter("pi-opentelemetry", "0.1.0");
  }

  private result(signal: string, code: number) {
    this.results[signal] = code === 0 ? "ok" : "failed";
    if (code !== 0) this.lost();
  }

  lost() {
    this.loss = true;
    if (!this.warned) {
      this.warned = true;
      process.stderr.write("pi-otel: degraded (telemetry loss)\n");
    }
  }

  status() {
    const values = Object.values(this.results);
    const state =
      this.loss || values.includes("failed")
        ? "degraded"
        : values.every((value) => value === "ok")
          ? "healthy"
          : "unverified";
    return `pi-otel: ${state}; ${Object.entries(this.results)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ")}; loss=${this.loss ? "yes" : "no"}`;
  }

  start(name: string, attributes: Attributes, parent?: Span): Span | undefined {
    return this.tracer?.startSpan(
      name,
      // Use one process-wide wall/monotonic clock mapping. SDK-default spans
      // each anchor to rounded Date.now(), which can invert nested endpoints.
      { attributes, startTime: performance.timeOrigin + performance.now() },
      parent ? trace.setSpan(ROOT_CONTEXT, parent) : ROOT_CONTEXT,
    );
  }

  finish(span: Span | undefined, attributes: Attributes, outcome: string) {
    span?.setAttributes(attributes);
    span?.setStatus({
      code:
        outcome === "settled"
          ? SpanStatusCode.UNSET
          : outcome === "success"
            ? SpanStatusCode.OK
            : SpanStatusCode.ERROR,
    });
    span?.end(performance.timeOrigin + performance.now());
  }

  emit(name: string, attributes: Attributes, span?: Span) {
    if (this.closing) return;
    // Admission count includes in-flight records; prevents SDK drops without a second queue.
    if (this.pendingLogs >= 64) {
      this.lost();
      return;
    }
    this.pendingLogs++;
    this.logger.emit({
      body: name,
      eventName: name,
      attributes,
      context: span ? trace.setSpan(ROOT_CONTEXT, span) : ROOT_CONTEXT,
    });
  }

  shutdown(): Promise<void> {
    this.closing ??= (async () => {
      await Promise.allSettled([
        this.logs.shutdown(),
        this.metrics.shutdown(),
        ...(this.traces ? [this.traces.shutdown()] : []),
      ]);
      // A rejected provider shutdown can skip closing its exporter.
      await Promise.allSettled(
        this.exporters.map((exporter) => exporter.shutdown()),
      );
    })();
    return this.closing;
  }
}
