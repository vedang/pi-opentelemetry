# pi-opentelemetry

Metadata-only Pi telemetry for an **existing local OTLP/gRPC collector**. Logs and
metrics require explicit Pi opt-in; traces ship in this release and require a
second opt-in. This extension does not install or configure a collector, viewer,
database, service, or global OpenTelemetry provider.

**Private / UNLICENSED.** Public distribution requires the owner's license
choice. Implementation and isolated package validation are separate from live
persistence verification. An approved installed-package smoke test confirmed
records in the existing viewer; an export ACK alone is not persistence proof.

**Minimal-release acceptance (before the V1 expansion):** formatting, TypeScript,
Knip, and all default tests passed,
including real-Pi lifecycle and decoded logs/metrics/traces, privacy, bounds,
accounting, and outage/cleanup checks. The tarball has been packed, inspected,
and successfully installed/loaded in an isolated pnpm project (owner-run
`make test-package`). The owner also confirmed successful frozen dependency
installation. Implementation and packaging acceptance are complete. Approved
live verification also confirmed all three signals in the viewer. One initial
short session lost its exports; two subsequent sessions passed. See
[the exact results and limitations](docs/live-verification.md).

The V1 activity/turn expansion has separate real-SDK and decoded-OTLP proof but
is **not yet accepted**: the final ordered gates passed format/check and unit
1/1, but integration finished 35/36 with a telemetry-loss warning in the
trace-enabled nested-tool scenario. An earlier full 36/36 pass does not fix that
intermittent failure. `pi-opentelemetryroot-c79.1` remains open pending the
separate export-loss blocker `pi-opentelemetryroot-bbt`; no deadline, queue or
non-overload assertion was relaxed. Expanded package/live persistence acceptance
also remains gated by epic `pi-opentelemetryroot-c79`. Earlier live confirmations
cover the minimal release, not this expanded schema.

## Install

With [Pi](https://pi.dev) already installed:

```sh
pi install git:github.com/vedang/pi-opentelemetry
```

This adds the package to your personal Pi settings. Start a **new Pi session**
after installation. There is no separate build or global npm installation step,
and installing the package **does not enable telemetry**.

To update or remove it later:

```sh
pi update git:github.com/vedang/pi-opentelemetry
pi remove git:github.com/vedang/pi-opentelemetry
```

Tested host: Pi **1.4.0**, Node **24.22.1**, pnpm **12.16.1** for development.
The manifest retains Pi's Node floor (>=22.19.0); other Node/Pi versions have not
been exercised. The pnpm commands below are for development, not an extra
installation step.

### Already have a local collector and viewer?

Reuse them—**do not start another copy or overwrite their configuration**. Your
collector must forward **logs, metrics and traces**, not just traces. Start the
installed extension with telemetry enabled for this invocation only:

```sh
env PI_OTEL_ENABLED=1 PI_OTEL_TRACES=1 \
  OTEL_EXPORTER_OTLP_PROTOCOL=grpc \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4317 \
  pi
```

Use your collector's actual local gRPC port if it is not 4317. The `env` form works
in Bash, Zsh and Fish without editing shell startup files. Remove
`PI_OTEL_TRACES=1` (or set it to `0`) for logs and metrics only. `PI_OTEL_ENABLED=0`
disables all Pi telemetry without changing Claude's settings or the collector.

## First-time guide: collector and viewer

You do not need to know OpenTelemetry to use this:

- **The extension** records metadata about Pi activity. It does not record your
  conversation, thinking, tool arguments or tool output.
- **A collector** is a local receiving/forwarding service—a sorting office for
  telemetry from Pi and other applications.
- **A viewer** stores the received data and gives you a browser interface.
- **Logs** are activity records; **metrics** are numeric totals and durations;
  **traces** show a run's requests and tools as a timeline.

The walkthrough below uses two programs running on **your own computer**:

```text
Pi extension → Collector → Desktop Viewer → local DuckDB file
                 :4317          :4327
                              browser :8000
```

The viewer also has a built-in OTLP receiver, so a separate collector is optional:
for the fewest moving parts, run the viewer command below and point Pi directly
at `http://127.0.0.1:4327`, skipping the collector steps. The separate collector
is useful when sharing one receiving endpoint with Claude or other applications.
Neither approach requires a cloud account.

**If you already have this pipeline running, use the previous section instead.**
These commands are for a fresh setup, run in foreground terminals so you can see
errors and stop them. They do not create login services or auto-start anything.
Only bind to loopback; this example has no authentication and is not for a LAN
or public server.

### 1. Install the two tools

The concrete install commands here target **macOS with Apple Silicon**. For
Intel Macs, Linux or Windows, use the matching binaries in the upstream
[viewer installation guide](https://github.com/CtrlSpice/otel-desktop-viewer#getting-started)
and [Collector binary guide](https://opentelemetry.io/docs/collector/install/binary/).
Keep the commands below in a POSIX-style terminal; adapt executable paths for
your platform.

Install the viewer on macOS with [Homebrew](https://brew.sh):

```sh
brew tap ctrlspice/otel-desktop-viewer
brew install --cask otel-desktop-viewer
```

Use viewer **0.6.0** or a compatible newer release with logs, metrics, traces and
DuckDB support. Version 0.6.0 cannot open pre-0.6.0 databases: use a new file,
**never delete an existing telemetry database just to follow this guide**.
See the [viewer release notes](https://github.com/CtrlSpice/otel-desktop-viewer/releases).

Download Collector Contrib **0.164.0** into a dedicated directory (no `sudo` or
PATH changes needed). This is the version used to validate the configuration
below; choose `darwin_amd64` instead of `darwin_arm64` on an Intel Mac:

```sh
mkdir -p "$HOME/.local/share/pi-otel/bin"
curl --proto '=https' --tlsv1.2 -fL \
  https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.164.0/otelcol-contrib_0.164.0_darwin_arm64.tar.gz \
  -o "$HOME/.local/share/pi-otel/collector.tar.gz"
tar -xzf "$HOME/.local/share/pi-otel/collector.tar.gz" \
  -C "$HOME/.local/share/pi-otel/bin" otelcol-contrib
```

The official [Collector releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases/)
provide matching archives and checksums. Verify the downloaded archive against
its published checksum before running the executable.

### 2. Start the viewer — terminal A

```sh
otel-desktop-viewer --host 127.0.0.1 \
  --grpc 4327 --http 4328 --browser-port 8000 \
  --db "$HOME/.local/share/pi-otel/telemetry.duckdb" \
  --db-max-size 4GB --open-browser=false
```

Leave this terminal running. Open **http://127.0.0.1:8000** in your browser.
It will be empty until data arrives. The `--db` flag saves telemetry between
viewer restarts; without it, storage is in memory. The size limit prunes older
telemetry, so this is not a permanent archive.

| Port | Purpose | Open in a browser? |
| --- | --- | --- |
| `4317` | Collector's OTLP/gRPC input; Pi sends here | No |
| `4327` | Viewer's OTLP/gRPC input; collector forwards here | No |
| `4328` | Viewer's OTLP/HTTP input; unused in this recipe | No |
| `8000` | Viewer's web interface and read-only query commands | **Yes** |

If a port is already in use, check whether your pipeline is already running.
Do not stop an existing service or launch two viewers against the same database.

### 3. Configure and start the collector — terminal B

Create `$HOME/.local/share/pi-otel/collector.yaml` in your text editor with:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 127.0.0.1:4317

processors:
  batch: {}

exporters:
  otlp_grpc/viewer:
    endpoint: 127.0.0.1:4327
    tls:
      insecure: true

service:
  telemetry:
    metrics:
      level: none
  pipelines:
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp_grpc/viewer]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp_grpc/viewer]
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp_grpc/viewer]
```

Validate it without starting another listener, then run it:

```sh
"$HOME/.local/share/pi-otel/bin/otelcol-contrib" validate \
  --config="$HOME/.local/share/pi-otel/collector.yaml"
"$HOME/.local/share/pi-otel/bin/otelcol-contrib" \
  --config="$HOME/.local/share/pi-otel/collector.yaml"
```

Leave terminal B running too. The collector forwards all three signals to the
viewer; it does not itself provide a browser interface. The `otlp_grpc` exporter
name is for Collector 0.164.0; older distributions may name this exporter `otlp`.

### 4. Start Pi with telemetry — terminal C

Install the extension as described above, then use the temporary `env ... pi`
command from [the existing-collector section](#already-have-a-local-collector-and-viewer).
Use Pi normally for a small task, allowing a request and a tool call to complete.
Normal model use can incur your usual provider charges; the extension does not
make extra model calls.

Run `/otel-status` **inside Pi**. It is initially `unverified` until exports are
acknowledged. Logs/traces normally flush every 5 seconds, metrics every 10
seconds, and the collector can add batching delay; allow about 15 seconds before
looking for a first complete set of signals. Acknowledgements still do not prove
that the viewer stored the records—check the viewer too.

In the browser, select service **`pi-coding-agent`**, choose a recent time window,
and explore Logs, Metrics and Traces. Other applications such as `claude-code`
remain separate services. Look for `pi.llm_request` / `pi.tool_result` logs,
`pi.token.usage` / `pi.cost.usage` metrics, and `pi.agent_run` traces.
Cost is a provider-reported estimate and can be absent, not necessarily zero;
spending coverage is [assistant-only](#signals-and-accounting).

With viewer 0.6.0 you can also check from another terminal:

```sh
otel-desktop-viewer services --service pi-coding-agent --since 15m
otel-desktop-viewer logs --service pi-coding-agent --since 15m
otel-desktop-viewer metrics --service pi-coding-agent --since 15m
otel-desktop-viewer traces --service pi-coding-agent --since 15m
```

These commands use the viewer at `http://localhost:8000`; add
`--endpoint http://127.0.0.1:YOUR_UI_PORT` if you changed its browser port.
Never independently open the active DuckDB file to inspect it; use the viewer.

### 5. Troubleshoot and stop safely

| Symptom | Check |
| --- | --- |
| `/otel-status` is unknown | Start a new Pi session after installation; use `pi list` to confirm the package and `pi config` to check it is enabled. |
| Status is `disabled` | Set `PI_OTEL_ENABLED=1` **before starting Pi**; use local `http://...` and protocol `grpc`. Inherited OTLP header settings, even empty ones, disable this extension; see [configuration](#configuration). |
| Status stays `unverified` | Complete some work and wait for the export intervals; check all enabled signals. This status is not a promise that data arrived. |
| Status is `degraded` | Some data may have been lost. Check both program terminals, ports and collector pipelines. Loss stays sticky for that activation even if later exports work; a new Pi session resets status, not lost records. |
| Logs/metrics arrive but no traces | Start Pi with both `PI_OTEL_ENABLED=1` and `PI_OTEL_TRACES=1`; keep the collector's traces pipeline. |
| Healthy status but empty viewer | Check the collector's destination, the viewer's service/time filters, and all three pipelines. Export ACKs are not persistence proof. |
| Browser gets a 404 or connection error | Use port **8000**, not OTLP ports 4317/4327/4328. |

Delivery is best effort. One first short live-validation session lost its exports,
while two subsequent sessions passed; see [the recorded caveat](docs/live-verification.md).
Waiting or restarting cannot recover records already lost.

When finished, exit Pi normally **first**, then press Ctrl+C in collector terminal
B, then viewer terminal A. Keep the database file if you want history next time.
To stop sending Pi telemetry next time, run `env PI_OTEL_ENABLED=0 pi`, or start Pi
without the opt-in environment variables. This does not disable Claude telemetry.

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
- `pi.activity_start`, `pi.activity_end`: observed `before_agent_start` through
  final `agent_settled`, possibly spanning multiple runs. **Not a human prompt
  ID**: custom triggers, steering, follow-ups and continuation may contribute.
  Only `messageType=user|custom` is retained as `pi.message_type`. Settlement is
  `pi.outcome=settled`, not task success; final `pi.aborted` and observed
  `pi.had_error` are independent. Interrupted cleanup is `incomplete`, with no
  invented final abort flag or duration.
- `pi.run_start`, `pi.run_end`: low-level agent runs, not user prompts. `agent_end`
  closes the run but leaves the activity open until final settlement.
- `pi.turn_start`, `pi.turn_end`: unique `pi.turn.id` plus numeric run-local
  `pi.turn.index`, reset at each run. Start logs are live, not end-time summaries.
- `pi.llm_request`: finalized live assistant lifecycle observations, not HTTP
  attempts. Provider/model come from the completed message; optional safe response
  ID/model are retained. Duration measures the observed assistant lifecycle,
  not exclusive network latency or model inference.
- `pi.tool_result`: actual `tool.call.id`, safe `tool.name`, optional
  `tool.parent_call.id`,
  normalized outcome, measured lifecycle interval, and Pi's execution duration
  when present. Blocked/pre-execution failures need not have execution duration.

`timing.source` identifies `activity_lifecycle`, `turn_lifecycle`,
`assistant_lifecycle`, `agent_lifecycle`, `tool_lifecycle`, or `pi_tool_execute`. Log `pi.duration_ms` uses the indicated
source; tool `pi.lifecycle_duration_ms` separately includes pre-execution work.
Metric duration histograms convert measured milliseconds to seconds.

| Metric | Kind / unit | Dimensions |
| --- | --- | --- |
| `pi.session.count` | counter | `start_type` |
| `pi.activity.count` | counter | `outcome`, `had_error`, optional `aborted` |
| `pi.activity.duration` | histogram / seconds | same as activity count |
| `pi.turn.count` | counter | `outcome` |
| `pi.turn.duration` | histogram / seconds | `outcome` |
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

With `PI_OTEL_TRACES=1`, hierarchy is `pi.activity` → `pi.agent_run` →
`pi.turn` → existing `pi.llm_request` / `pi.tool`. Actual nested tool IDs select
parent tools (including composite pipe IDs); unknown tool parents attach to the
active turn/run/activity and carry `pi.parent.unknown=true`. Missing ancestors
are omitted, not borrowed from completed work; pre-activity work is standalone.
`pi.scope=standalone|activity|run|turn` identifies the available live ancestry. Concurrent tools remain
peers with their real overlap. Parent tool duration is inclusive of children.
There is no session-long root, HTTP retry-span claim, compaction span,
child-process instrumentation, global provider registration or global context
manager. Explicit contexts correlate corresponding log trace/span IDs.

Trace-off preserves session/activity/run/turn/request/tool correlation attributes and the same
usage metrics, but does not invent trace/span IDs. Provider transport hooks are
not required for the supported assistant lifecycle observations.

Outcomes are success, error, aborted or incomplete. Tools and assistant
observations use public cancellation state, never error-text matching.
Cancellation can produce an additional zero-usage assistant observation; request
observation counts are not billable-request counts. A run retains an observed failure/abort even if
later work recovers. Unmatched completions are suppressed with known loss, never
turned into successful zero-duration operations. Shutdown interruptions end open
spans as incomplete, omit unavailable completion durations, and do not increment
successful completion counts. Activity/run/turn incomplete closures have an
incomplete count but no duration sample. Repeated starts close the old owner and
descendants once; unmatched turn/settlement terminals are marked incomplete with
`pi.start_missing=true` and no invented ID/span/duration/count. Activity settlement
has neutral trace status, never a successful-task claim. See the
[V1 anomaly policies and attribute budgets](docs/plans/granular-metadata-telemetry/activity-contract.md).

## Privacy, bounds, loss and status

Allowlisted data is operational metadata only: versions, random instance and
local activity/run/turn/request IDs, real session/tool IDs, safe bounded provider/model/tool
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
- One active activity, run, turn and serial assistant observation; at most **1,024** open
  tools. Overflow starts/completions are suppressed, not fabricated successes.
- First eight provider/model pairs and sixteen tool names retain metric identity;
  excess models aggregate under `pi.overflow=true`, excess tool names under
  `overflow`, with sticky loss. SDK cardinality is capped at **64** per instrument.
  Metric dimensions never include session/activity/run/turn/request/tool IDs or turn indexes.
  Rapid multi-turn work can exhaust admission and produces sticky visible loss;
  no queue/deadline increase or hidden failure sampling is applied.
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

To try the source checkout instead of installing the Git package:

```sh
pnpm install --frozen-lockfile --ignore-scripts
# pnpm-workspace.yaml explicitly declines unnecessary genai/protobufjs scripts.
env PI_OTEL_ENABLED=1 PI_OTEL_TRACES=1 \
  OTEL_EXPORTER_OTLP_PROTOCOL=grpc \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4317 \
  pi --extension ./src/index.ts
```

Use `pi -e /absolute/path/to/pi-opentelemetry` from another directory. No compiled
`dist` directory is needed. Use a trusted local collector; the opt-in sends data
to it. For isolated package validation, `make test-package` packs, inspects,
installs offline into a temporary pnpm project and loads with telemetry disabled.
A host embedding Pi must await `AgentSessionRuntime.dispose()` (or its orderly
shutdown equivalent); bare synchronous `AgentSession.dispose()` does not emit
`session_shutdown` and cannot flush telemetry.

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
