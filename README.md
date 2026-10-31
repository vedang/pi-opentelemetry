# pi-opentelemetry

Metadata-only Pi telemetry for an **existing local OTLP/gRPC collector**. Logs and
metrics require explicit Pi opt-in; traces ship in this release and require a
second opt-in. This extension does not install or configure a collector, viewer,
database, service, or global OpenTelemetry provider.

**Private / UNLICENSED.** Public distribution requires the owner's license
choice. Implementation and isolated package validation are separate from live
persistence verification. An approved installed-package smoke test confirmed
records in the existing viewer; an export ACK alone is not persistence proof.

**Current acceptance:** formatting, TypeScript, Knip, and all default tests pass,
including real-Pi lifecycle and decoded logs/metrics/traces, privacy, bounds,
accounting, and outage/cleanup checks. The tarball has been packed, inspected,
and successfully installed/loaded in an isolated pnpm project (owner-run
`make test-package`). The owner also confirmed successful frozen dependency
installation. Implementation and packaging acceptance are complete. Approved
live verification also confirmed all three signals in the viewer. One initial
short session lost its exports; two subsequent sessions passed. See
[the exact results and limitations](docs/live-verification.md).

## Try locally

Tested host: Pi **1.4.0**, Node **24.22.1**, pnpm **12.16.1**. The manifest retains
Pi's Node floor (>=22.19.0); other Node/Pi versions have not been exercised.

```sh
pnpm install --frozen-lockfile --ignore-scripts
# pnpm-workspace.yaml explicitly declines unnecessary genai/protobufjs scripts.
# Temporary activation only; do not run against a live pipeline without approval.
env PI_OTEL_ENABLED=1 PI_OTEL_TRACES=1 \
  OTEL_EXPORTER_OTLP_PROTOCOL=grpc \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
  pi --extension ./src/index.ts
```

Pi can load the package directory with `pi -e /absolute/path/to/pi-opentelemetry`.
It does not need a compiled `dist` directory. For isolated local tarball checking,
run `make test-package`; it packs, inspects, installs **offline** in a temporary
pnpm project, and invokes that project's installed Pi with isolated HOME/agent
settings and telemetry disabled. No global installation or publication is done.

Do not add the package to personal settings until that persistent installation is
approved. A host embedding Pi must await `AgentSessionRuntime.dispose()` (or its
orderly shutdown equivalent); bare synchronous `AgentSession.dispose()` does not
emit `session_shutdown` and cannot flush telemetry.

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `PI_OTEL_ENABLED` | off | `1`/`true` enable, case-insensitive; unset/empty/`0`/`false` disable. Other values disable safely. |
| `PI_OTEL_TRACES` | off | Same boolean syntax. Master opt-in is still required. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://127.0.0.1:4317` | Shared destination for all active signals. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` | Any explicit value other than `grpc` disables Pi telemetry. |

Only `http://localhost`, `http://127.0.0.1`, and `http://[::1]` authorities are
allowed, optionally with a valid port and a root slash. No credentials, non-root
path, query, fragment, alternate numeric host spellings, TLS or remote host is
accepted. Rejected strings are never echoed. Arbitrary names are never resolved
as a validation technique. Loopback is not an authentication/security boundary:
only use a collector you trust. Omitting a port uses the URL's HTTP default port;
use explicit `:4317` for the usual local collector.

**Inherited headers fail closed:** presence of `OTEL_EXPORTER_OTLP_HEADERS` or
`OTEL_EXPORTER_OTLP_{LOGS,METRICS,TRACES}_HEADERS`, even an empty value, disables
this extension with a fixed diagnostic. The official gRPC signal constructors
merge inherited headers; refusing them is the approved isolation policy. Unset
those settings for a Pi invocation if telemetry is desired; this extension never
mutates the shared process environment.

Per-signal destinations/protocols, inherited credentials/certificate paths,
resource/service overrides, exporter selectors, sampler settings, and
content-capture flags are not extension settings. Explicit insecure gRPC
credentials, shared destination, private resource, sampler, limits and
processors take precedence. `PI_TELEMETRY` and Claude flags do not enable Pi.
There is **no content-capture switch**. No providers/sockets/timers are created
by the factory or when disabled; activation occurs at `session_start` only.

To disable Pi without changing Claude, unset `PI_OTEL_ENABLED` (or set it to
`0`) for the next Pi invocation, or omit this extension. Shared collector settings
and Claude switches can remain unchanged. Configuration is read on activation;
`/otel-status` is read-only, not a reconfiguration/flush command.

## Signals and accounting

Resource: `service.name=pi-coding-agent`, actual Pi `service.version`, random
per-activation `service.instance.id`. Instrumentation scope is
`pi-opentelemetry` / `0.1.0`. Real session IDs are record attributes, never metric
labels or resource identity.

Log body and event name:

- `pi.session_start`, `pi.session_end`: runtime activations, including resumed,
  forked and reloaded sessions, **not unique historical sessions**.
- `pi.run_start`, `pi.run_end`: low-level agent runs, not user prompts. Retries or
  automatic continuation may create more than one run per prompt.
- `pi.llm_request`: finalized live assistant lifecycle observations, not HTTP
  attempts. Provider/model come from the completed message; optional safe response
  ID/model are retained. Duration measures the observed assistant lifecycle,
  not exclusive network latency or model inference.
- `pi.tool_result`: actual `tool.call.id`, safe `tool.name`, optional
  `tool.parent_call.id`,
  normalized outcome, measured lifecycle interval, and Pi's execution duration
  when present. Blocked/pre-execution failures need not have execution duration.

`timing.source` identifies `assistant_lifecycle`, `agent_lifecycle`,
`tool_lifecycle`, or `pi_tool_execute`. Log `pi.duration_ms` uses the indicated
source; tool `pi.lifecycle_duration_ms` separately includes pre-execution work.
Metric duration histograms convert measured milliseconds to seconds.

| Metric | Kind / unit | Dimensions |
| --- | --- | --- |
| `pi.session.count` | counter | `start_type` |
| `pi.run.count` | counter | `outcome` |
| `pi.run.duration` | histogram / seconds | `outcome` |
| `pi.token.usage` | counter / tokens | `provider`, `model`, `type`, `source=assistant` |
| `pi.cost.usage` | counter / USD | `provider`, `model`, `source=assistant` |
| `pi.tool.calls` | counter | `tool.name`, `outcome` |
| `pi.tool.duration` | histogram / seconds | `tool.name`, `outcome` |

All counters and histograms export **delta temporality**. Sum delta datapoints,
not successive cumulative snapshots. Log usage is the same observation as metric
usage: **do not add both** as separate spending.

Accounting is **only live finalized assistant messages observed by this extension**,
not complete Pi spending. Excluded: restored transcript history, compaction,
branch summaries, separate nested-model/tool usage reports, cache warming, and
calls outside this assistant lifecycle. Inclusive tool usage is never added.
No persisted-history scan, baseline reconciliation or comprehensive accounting
is attempted. A genuinely independent assistant lifecycle observation is its own
contribution; there is no response-ID history registry.

Token types are input, output, cacheRead and cacheCreation (Pi's cacheWrite).
Reasoning is already part of output; cacheWrite1h is already part of cacheWrite.
Reported finite nonnegative usage on errors/aborts is retained; missing/invalid
values are omitted. Missing cost is **unknown**, not known zero. Costs are
Pi-reported estimates, not invoices. Pending responses are not finalized;
deferred observations are incomplete. Runs cover wall time, potentially including
uninstrumented compaction and overlapping tools; this is not human active time.

## Traces and outcomes

With `PI_OTEL_TRACES=1`, `pi.agent_run` is a root; `pi.llm_request` and `pi.tool`
spans are children. Actual nested tool IDs select the parent; unknown parents
attach to the run and carry `pi.parent.unknown=true`. Concurrent tools remain
peers with their real overlap. Parent tool duration is inclusive of children.
There is no session-long root, HTTP retry-span claim, compaction span,
child-process instrumentation, global provider registration or global context
manager. Explicit contexts correlate corresponding log trace/span IDs.

Trace-off preserves session/run/request/tool correlation attributes and the same
usage metrics, but does not invent trace/span IDs. Provider transport hooks are
not required for the supported assistant lifecycle observations.

Outcomes are success, error, aborted or incomplete. Tools and assistant
observations use public cancellation state, never error-text matching.
Cancellation can produce an additional zero-usage assistant observation; request
observation counts are not billable-request counts. A run retains an observed failure/abort even if
later work recovers. Unmatched completions are suppressed with known loss, never
turned into successful zero-duration operations. Shutdown interruptions end open
spans as incomplete, omit unavailable completion durations, and do not increment
successful completion counts.

## Privacy, bounds, loss and status

Allowlisted data is operational metadata only: versions, random instance and
local run/request IDs, real session/tool IDs, safe bounded provider/model/tool
names, normalized outcomes, finite numeric usage/cost and measured durations.
No prompts, text/thinking, tool arguments/results, raw errors/stacks, HTTP
bodies/headers, credentials, user identity, hostnames, paths, cwd or repository
metadata are selected. Invalid metadata identifiers normalize to `other` (unsafe
response IDs are omitted). Attribute strings are limited to 128 characters, with
32 attributes per log/span and no span events/links. A local collector still sees
operational identifiers and can correlate activity; this is not anonymity.

Limits per activation:

- Official log/span queues and batches: **64** each; admission counts include
  in-flight records and cap each signal at 64 pending observations. Excess is
  suppressed with sticky known loss, not placed into a second queue.
- One active run and one serial assistant observation; at most **1,024** open
  tools. Overflow starts/completions are suppressed, not fabricated successes.
- First eight provider/model pairs and sixteen tool names retain metric identity;
  excess models aggregate under `pi.overflow=true`, excess tool names under
  `overflow`, with sticky loss. SDK cardinality is capped at **64** per instrument.
  Metric dimensions never include session/run/request/tool IDs.
- Logs/spans flush every 5 seconds or on full batches; metrics every 10 seconds.
  RPC deadline **100 ms**, processor/reader deadline **150 ms**: deliberately
  tighter than network-oriented defaults for a local best-effort collector.
- Shutdown awaits providers concurrently, then explicitly closes retained public
  exporters even if a provider rejects. The target is aggregate **<=1.5 seconds**
  with scheduler slack; no `process.exit`, detached cleanup or Promise-race-only
  disposal hides timers/sockets. Abrupt host termination can still lose data.

`/otel-status` reports disabled, unverified, healthy or degraded, with each active
signal's last export result. Healthy requires ACKs from every active signal;
ACKs are not durable persistence. Any export failure, suppressed observation or
state/cardinality overflow makes loss **sticky until the next activation**.
Later successful ACKs update per-signal results but do not erase possible lost
data. A fixed safe stderr warning is emitted at most once per degraded activation;
disabled invalid settings get a fixed diagnostic. Nothing is written to stdout.
No export failure is recursively logged into telemetry.

Delivery is in-memory/best effort, not crash-proof or exactly-once. Outage, rapid
exit, overflow and very tight local deadlines can lose records. New/resume/fork/
reload shut down old resources and create fresh state/instance IDs; historical
messages do not replay into accounting.

## Development and verification

```sh
make format
make check
make test
make test-package
```

The default gate contains distinct nonempty unit/integration suites. Integration
uses real public Pi sessions, an offline synthetic provider, isolated agent/work
folders, temporary loopback receivers and upstream OTLP protobuf definitions.
Natural child exit is asserted; timeout cleanup is a failure, not proof of clean
shutdown. No owner credentials, global extensions, paid calls or live pipeline
are used. CI uses the same Node/pnpm pins and Make gates.

Live verification is a **separate approval gate**: inspect the existing collector
read-only, baseline the running viewer's query interface, run one approved
identified session with all three signals, then confirm only that interval's
records and matching log/span IDs persisted. Never independently open the active
DuckDB file. Paid calls and persistent configuration/install changes each require
separate permission. No live verification or public publication is automated.
