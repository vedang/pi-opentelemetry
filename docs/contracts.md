# Minimal-release contracts — discovery blocked

Status: **not implementation-ready**. Bead `pi-opentelemetryroot-uf4.1` is blocked,
not accepted. The plan explicitly requires stopping for an owner decision when a
required supported boundary is unavailable. No release extension exists yet.

## Inspected versions and sources

Discovery ran on Node **24.22.1**, pnpm **12.15.0**. Dependencies were installed with
`pnpm add --ignore-scripts` in `/tmp/pi-otel-contracts`, not globally or into this
repository. Candidate release pins (not a claim of completed compatibility tests):

| Package | Version |
| --- | --- |
| `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` | 1.4.0 |
| `@opentelemetry/api` | 1.10.0 |
| `@opentelemetry/sdk-logs`, `sdk-metrics`, `sdk-trace`, `resources` | 3.0.0 |
| official logs/metrics/trace OTLP gRPC exporters | 0.300.0 |
| `@grpc/grpc-js` | 1.14.6 |

Pi 1.4.0 requires Node >=22.19.0; OTel 3.0.0 requires >=22.15.0; pnpm
12.15.0 declares >=18. Thus the sibling Node >=22.19.0 floor is plausible;
use Node 24.22.1 for development/CI until other versions are actually exercised.
The current OTel trace SDK is **`sdk-trace`**, not the older `sdk-trace-base`.

Installed Pi documentation was read at
`/Users/nejo/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/`
(also 1.4.0). Relevant versioned references:

- [Pi extension docs](https://unpkg.com/@earendil-works/pi-coding-agent@1.4.0/docs/extensions.md),
  [SDK docs](https://unpkg.com/@earendil-works/pi-coding-agent@1.4.0/docs/sdk.md),
  [package docs](https://unpkg.com/@earendil-works/pi-coding-agent@1.4.0/docs/packages.md),
  [custom providers](https://unpkg.com/@earendil-works/pi-coding-agent@1.4.0/docs/custom-provider.md).
- [Extension event declarations](https://unpkg.com/@earendil-works/pi-coding-agent@1.4.0/dist/core/extensions/types.d.ts),
  especially lines 637–642, 693–720, 820–882 in the installed file.
- [AgentSession source](https://unpkg.com/@earendil-works/pi-coding-agent@1.4.0/dist/core/agent-session.js),
  especially message dispatch/persistence at 750–790, extension forwarding at
  920–982, `dispose()` at 1011, and reload at 3001.
- [AgentSessionRuntime source](https://unpkg.com/@earendil-works/pi-coding-agent@1.4.0/dist/core/agent-session-runtime.js),
  `teardownCurrent()` at 102–113 and async `dispose()` at 296–303;
  [runtime API](https://unpkg.com/@earendil-works/pi-coding-agent@1.4.0/dist/core/agent-session-runtime.d.ts).
- [Assistant/usage types](https://unpkg.com/@earendil-works/pi-ai@1.4.0/dist/types.d.ts),
  `Usage` at 285–306, `StopReason` at 307, `AssistantMessage` at 368 onward.
- SDK examples `06-extensions.ts`, `12-full-control.ts`, `13-session-runtime.ts`
  in the installed Pi `examples/sdk/` were inspected.

The actual local `pi-exa` Makefile/package/Biome/Knip/TS/Vitest/loader fixture and
`pi-btw` package were inspected. Retain that scaffold, replacing Bun with pnpm.
No scaffold has been installed in this repository past the discovery gate.

## Pi mapping established by declarations/source (not yet lifecycle-tested)

| Transition | Public sequence / ownership |
| --- | --- |
| Startup | Load factory; no telemetry resources there. Bind extensions to receive `session_start`; allocate only if enabled. Read ID from `ctx.sessionManager.getSessionId()`. |
| New | Cancellable `session_before_switch`; accepted replacement aborts/settles outgoing work, awaits `session_shutdown(reason=new)`, disposes old session, creates replacement, then binds `session_start(reason=new)`. |
| Resume | Same, `resume`; restored transcript must not be scanned/accounted. New runtime instance/provider state even for a previously seen session ID. |
| Fork/clone | Cancellable `session_before_fork`; accepted replacement tears down with `fork`, then creates/binds replacement. Do not count copied assistant history. |
| Reload | Awaits old runner's `session_shutdown(reason=reload)` before loading replacement runtime and startup. Discard all old operation IDs/providers. |
| Orderly quit | `AgentSessionRuntime.dispose()` awaits `session_shutdown(reason=quit)` and disposes session. |
| Bare SDK dispose | **`AgentSession.dispose()` is synchronous and does not emit shutdown.** Do not use this as the harness's telemetry-cleanup proof. Use the public async runtime owner. |

Providers/instance ID/state must be runtime-local; shutdown idempotent. Cancelled
switch/fork does not dispose the active runtime. The table is source evidence;
new/resume/fork/reload/quit still require real SDK tests before acceptance.

`agent_start`/`agent_end` delimit low-level runs, **not user prompts or HTTP
attempts**; retries/recovery can start additional runs. `agent_settled` is final
idle and exposes `aborted`. Run time is wall time, including compaction delays.

Only live assistant `message_end` observations contribute tokens/cost. Pi forwards
extensions before persistence. Use the finalized message's `provider` and `model`
(request identity), optionally `responseModel` as distinct observed metadata;
never use the current selected model to relabel an in-flight request.
`responseId` is optional, not a mandatory deduplication key. No request ID exists
on these events; create a local observation ID. `message_start`/`message_end`
provide a measured assistant-lifecycle interval, **not guaranteed HTTP latency**.
Setup failures may end without a provider start; omit unavailable duration.
Provider hooks do not expose HTTP retry identities and may be absent for custom
providers. Neither raw hook payloads nor headers may enter telemetry.

Usage fields are `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, and
`cost.{input,output,cacheRead,cacheWrite,total}`. Map cacheWrite to cacheCreation;
reasoning is a subset of output and cacheWrite1h a subset of cacheWrite, so never
add either again. Preserve reported finite nonnegative usage on error/abort;
missing cost is unknown, not known zero. Pending is not finalized; deferred needs
an explicit incomplete outcome, not invented success. Provider-native error text,
raw stop reasons and content are forbidden.

Proposed bounded accounting: consume a supported assistant start/end pair once,
remove it on completion; suppress operations when the 1,024-entry limit is
reached and mark sticky local loss. An unmatched end must not invent success or
timing. Do not replay transcript entries, reconcile cumulative session statistics,
or use tool-result usage. Exclude compaction, branch summaries, cache warming,
separate nested/tool model calls and all spending outside these observations.
Exactly-once durable accounting is not promised. Object identity/finalization
semantics still require the real-SDK fixture before settling the implementation.

Tool start/end events expose `toolCallId`, `toolName`, optional
`parentToolCallId`; nested calls get Pi IDs `<parent>/<n>`. End exposes `isError`
and optional monotonic `durationMs` (absent if execute did not run). No explicit
aborted boolean exists on tool-end. Never infer a precise abort from error text;
use public cancellation state where available or report error/unknown honestly.
Parallel tool spans must be peers, actual nested IDs parents; parent durations
are inclusive. Never inspect arguments/results for telemetry metadata.

## OTel: feasible public SDK surfaces

Private `LoggerProvider`, `MeterProvider`, `TracerProvider`, explicit
`resourceFromAttributes`, and explicit parent contexts avoid global registration
and environment resource detectors. SDK 3.0.0 batching constructors take options
objects including `exporter`. Logs/spans have queue/batch/interval/export-timeout
limits; metrics support reader `cardinalityLimits` and exporter temporality
selection. These are declarations/source findings, not completed delta-wire or
shutdown tests. Attribute value lengths/counts must be explicitly bounded.

[Log batch source](https://unpkg.com/@opentelemetry/sdk-logs@3.0.0/dist/export/BatchLogRecordProcessorBase.mjs)
shows sequential shutdown batches. Therefore 512 queued logs / batch 128 /
1-second exports can exceed the proposed 1.5-second shutdown budget. A mere
Promise race cannot solve cleanup. Smaller per-export deadlines and/or a
separately verified public disposal strategy are necessary; do not claim the
initial tuning is already feasible under a full hung queue.

[Exporter shutdown](https://unpkg.com/@opentelemetry/otlp-exporter-base@0.300.0/dist/otlp-export-delegate.mjs)
flushes its promise queue before closing the transport.
[gRPC transport](https://unpkg.com/@opentelemetry/otlp-grpc-exporter-base@0.300.0/dist/grpc-exporter-transport.mjs)
uses RPC deadlines and `client.close()` at shutdown. Retry delays need their own
real outage/clean-process-exit proof. No process-global diagnostic registration
is needed or acceptable just to observe private signal export results.

## Blocking contract: explicit options do not isolate inherited headers

All three official gRPC signal exporter constructors call
`convertLegacyOtlpGrpcOptions(config, SIGNAL)`:

- [Log exporter](https://unpkg.com/@opentelemetry/exporter-logs-otlp-grpc@0.300.0/dist/OTLPLogExporter.mjs)
- [Trace exporter](https://unpkg.com/@opentelemetry/exporter-trace-otlp-grpc@0.300.0/dist/OTLPTraceExporter.mjs)
- [Metric exporter](https://unpkg.com/@opentelemetry/exporter-metrics-otlp-grpc@0.300.0/dist/OTLPMetricExporter.mjs)

[Conversion](https://unpkg.com/@opentelemetry/otlp-grpc-exporter-base@0.300.0/dist/configuration/convert-legacy-otlp-grpc-options.mjs)
always loads fallback environment configuration.
[Merge](https://unpkg.com/@opentelemetry/otlp-grpc-exporter-base@0.300.0/dist/configuration/otlp-grpc-configuration.mjs)
adds fallback metadata entries not present in explicit metadata.
[Environment reader](https://unpkg.com/@opentelemetry/otlp-grpc-exporter-base@0.300.0/dist/configuration/otlp-grpc-env-configuration.mjs)
merges both `OTEL_EXPORTER_OTLP_HEADERS` and per-signal `*_HEADERS`.

Explicit URL does override inherited destinations; explicit insecure credentials
avoid certificate selection. **Empty `Metadata` does not suppress headers.**
The exported constructor config has no `ignoreEnvironment` or replacement
metadata-provider option. Arbitrary inherited header names cannot be reliably
masked with a fixed explicit Metadata map. Do not alter shared Pi process.env,
subclass Metadata to fool merging, patch private exporter state or log secrets.

### Actual transport reproduction

`docs/probes/exporter-environment.mjs` is a standalone discovery probe. It uses
one temporary `127.0.0.1:0` server, real official exporter, explicit URL, empty
metadata, insecure credentials, no compression, 1-second timeout, private
resource/provider. It asserts receipt before checking metadata; it does **not**
decode OTLP payloads or claim Pi lifecycle/release coverage.

Reproduce without global install or the real collector:

```sh
repo="$PWD"
work="$(mktemp -d)"
printf '{"private":true,"type":"module"}\n' > "$work/package.json"
pnpm --dir "$work" add --ignore-scripts \
  @grpc/grpc-js@1.14.6 @opentelemetry/api@1.10.0 \
  @opentelemetry/exporter-logs-otlp-grpc@0.300.0 \
  @opentelemetry/sdk-logs@3.0.0 @opentelemetry/resources@3.0.0
cp "$repo/docs/probes/exporter-environment.mjs" "$work/probe.mjs"
node "$work/probe.mjs"
rm -rf "$work"
```

Observed with natural exit code 0, no forced exit:

```json
{"inheritedGeneralHeader":"INHERITED_SENTINEL","inheritedSignalHeader":"SIGNAL_SENTINEL"}
```

This is deliberate synthetic sentinel data, never owner credentials. It proves
the required no-inherited-headers contract fails even with explicit options.

## Smallest owner decision, then next steps

Preferred narrow plan adjustment: permit composition of the **official publicly
exported gRPC export delegate, official serializers and exporter base APIs**
with explicit configuration, instead of requiring the three signal exporter
constructors. This would keep official transport/protobuf/retry implementation,
no custom encoder, but is not the constructor-based design currently specified.
The public `createOtlpGrpcExportDelegate` export exists in 0.300.0; all three
signal adapter signatures, status callbacks and cleanup still need verification.
This is a proposal, **not a proven replacement or an implemented release**.

Even smaller code change but weaker product contract: fail closed (disabled,
safe reason) whenever inherited header configuration is present. That changes
“ignore inherited settings while exporting” into “refuse to export” and needs
explicit owner acceptance. Do not silently implement this alternative.

After the owner chooses, finish discovery with a clean-shutdown strategy and
real SDK runtime fake provider: temporary agent/work directories, in-memory
settings/session or isolated files, no user resource discovery, explicit
ModelRuntime and local registered provider, legal AssistantMessageEventStream,
async AgentSessionRuntime disposal. Test real prompt/tool/transition dispatch;
never directly invoke captured extension handlers. Decode actual wire payloads
using maintained OTLP definitions. None of that acceptance is claimed here.
A separate owner-approved license choice is also still needed before
`uf4.7` distribution. `uf4.8` remains a distinct live-export approval gate.
