# Export-loss investigation — 2026-10-31

Status: review/repair deferred under open `pi-opentelemetryroot-bbt`; no
production fix claimed. The owner explicitly approved quarantining the confirmed
flaky test and closing V1 `pi-opentelemetryroot-c79.1` without waiting for repair.
This supersedes the previous V1 acceptance block, not the recorded failures.
This investigation used only the existing offline real-Pi SDK fixture and
independent loopback OTLP receiver, not the installed CLI or live pipeline.
The original installed-CLI loss is not yet proven to have the same cause.

## Owner-approved quarantine

Only `activity spans queued runs and pre-settlement continuation, traces=1` is
marked FLAKY and dynamically skipped before fixture setup in regular runs.
The trace-off row and all other tests, including nested-tool trace coverage,
remain active. The original test body and assertions are preserved.

- `make test-flaky`: opt-in execution of this one quarantined case.
- `PI_OTEL_RUN_FLAKY=1 make test-integration`: include it in the full suite.
- Ordered post-quarantine gates: format/check PASS; unit **1/1 PASS**;
  integration **35 PASS / 1 explicitly skipped** (84.69 seconds).
- Opt-in `make test-flaky`: **1 PASS / 5 filtered out** on this invocation. This
  confirms the opt-in runs the test; it does not fix or resolve the flake.
- Initial quarantine check caught use of `it.each`'s non-context second argument;
  switched to Vitest's context-aware `it.for` before the passing ordered gates.

The owner deferred test review and export-loss repair to later. No production
code, timeout, queue, or test assertions changed in this quarantine task.

## Unchanged test evidence

Node 24.22.1, Pi 1.4.0, OTel 3.0.0 / exporters 0.300.0, grpc-js 1.14.6.
Production/test source was unchanged for the following runs:

1. User-requested `make test`, started 17:11:08 local: unit **1/1 passed**,
   integration **35/36 passed** (91.64 seconds). Failure moved from the earlier
   nested-tool trace case to
   `activity spans queued runs and pre-settlement continuation, traces=1`,
   at `__tests__/activity.integration.test.ts`'s empty-stderr assertion.
   Actual stderr was the fixed `pi-otel: degraded (telemetry loss)` warning.
2. Five independent invocations of:

   ```sh
   ./node_modules/.bin/vitest run --config vitest.config.integration.ts \
     __tests__/activity.integration.test.ts \
     __tests__/traces.integration.test.ts \
     -t 'traces=1|trace toggle=1'
   ```

   Activity trace-enabled case: **fail, fail, pass, fail, pass** (3/5 failures).
   Nested-tool trace-enabled case: **pass in all five**. Other parameterized
   cases were deliberately skipped, not counted as passing. All three failures
   were the telemetry-loss warning, not ancestry or accounting assertions.

The activity case is confirmed flaky independently of the full suite. The
previous nested-tool failure is still real, but was not reproduced in this
focused batch. These are diagnostic repeats, not retries used to claim acceptance.

## Temporary transport diagnostics

Temporary fixture-only instrumentation used grpc-js's public `GRPC_TRACE` /
`GRPC_VERBOSITY` settings with the `resolving_call` tracer. No production
implementation, deadline, queue size or assertions were changed. Immediate
stderr logging affected timing; buffering with public `setLogger` until after
shutdown reduced that perturbation. A temporary failure message also included
only decoded record names to distinguish which signal was absent.

These diagnostic runs intentionally polluted stderr, so their test exit status
is **not** a normal gate result. Actual telemetry-loss warnings were counted
separately from the added diagnostic output:

| Diagnostic batch | Attempts | Actual loss warnings |
| --- | ---: | ---: |
| Nested tools, immediate gRPC logging | 5 | 0 |
| Activity, immediate gRPC logging | 3 | 0 |
| Activity, buffered gRPC logging | 5 | 2 |
| Activity, buffered logging + decoded record names | 3 | 1 |

In the last failing activity diagnostic (`/tmp/pi-otel-buffered-records-2.log`):

- **26 logs** arrived, including final run/activity/session end records.
- All **11 metric instruments** arrived.
- **12 of 16 expected spans** arrived. The final assistant/turn/run/activity
  batch (four spans) was missing.
- Only **four** gRPC export calls were issued, all returning status **0 / OK**;
  no issued RPC exceeded its deadline. Healthy activity diagnostics issued five
  successful RPCs and delivered all 16 spans.
- Sixteen total spans are below the unchanged 64-span admission bound.

All temporary instrumentation was removed. Original test assertions and source
were restored byte-for-byte; only this note and bead evidence remain changed.
Raw diagnostic logs are temporary local evidence, not shipped runtime logging.

## Source-supported likely race

Installed dependency source inspected:

- `@opentelemetry/sdk-trace/dist/export/BatchSpanProcessorBase.mjs`:
  scheduled `_maybeStartTimer()` marks `_isExporting`, but shutdown's
  `_flushAll()` invokes `_flushOneBatch()` for the remaining buffer without
  awaiting the already in-flight scheduled batch.
- `@opentelemetry/otlp-exporter-base/dist/otlp-export-delegate.mjs`:
  `export()` checks `hasReachedLimit()` and immediately returns FAILED with
  `Concurrent export limit reached` before issuing a transport request.
  Public `forceFlush()` waits for its current promise queue.
- `src/telemetry.ts`: official exporters have `concurrencyLimit: 1`;
  `traces.shutdown()` starts alongside log/metric shutdown. The observed trace
  exporter forwards failed result codes into sticky loss. It does not serialize
  a new shutdown export behind the in-flight batch.

This explains the activity symptom closely: the test releases continuation as
scheduled exports arrive, finishes its final four spans, then immediately shuts
down. Depending on acknowledgement timing, the first trace export is still
pending and the final batch can be refused locally. Successful wire calls do
not imply all batches were admitted. The exact failed exporter callback's error
was not captured: this is strong evidence for the coordination race, **not**
proof that every historical loss shares this cause.

The short nested-tool/installed-CLI failures can occur before a five-second
scheduled export; this activity race alone does not explain them. Cold transport
or deadline hypotheses for those cases remain unproven. Do not increase deadlines
or weaken assertions on the basis of these observations.

## Next proof before a fix

Create a deterministic real-Pi boundary regression that holds acknowledgement of
the first scheduled trace batch, completes continuation and initiates normal
shutdown while that batch is known to be in flight, then releases its response
within the existing deadline. Assert exact decoded spans, empty operational
stderr and bounded natural exit. This distinguishes local concurrent-export
rejection from deadline expiry without private production hooks.

Only after that failure is independently demonstrated should a narrow public-API
serialization fix be evaluated. Preserve official private exporters, bounded
admission/deadlines, metadata-only behavior and aggregate shutdown bounds. The
original bead also requires enabled real-CLI loopback proof before acceptance;
no such new CLI run, installed-package change or live write occurred here.
