---
shaping: true
status: proposed
---

# Granular metadata-only operational and lifecycle telemetry

## Source and scope

> Right. lets improve the first two. Pi has granular details in event lifecycle. Refer to the documentation of pi-coding-agent, and make a plan to capture these events properly.

“The first two” means better operational measurements and broader lifecycle
coverage, not conversation capture. This plan proposes the next release; no
production implementation, package update, service change or new live probe is
part of this planning task. Grounding: [Pi 1.4.0 event investigation](spike-pi-events.md).

## Requirements

| ID | Requirement | Status |
|---|---|---|
| R0 | Explain observed latency and work structure without reading conversation content. | Core goal |
| R1 | Distinguish activity, low-level run, turn, model observation, tool execution and settlement; correlate them with opaque IDs. | Must-have |
| R2 | Measure preparation-to-completion and first-output latency with exact source labels and explicit missing/ambiguous coverage. | Must-have |
| R3 | Explain compaction, UI waits, model/thinking changes and runtime/resource observations through safe metadata. | Must-have |
| R4 | Keep existing assistant-only token/cost totals correct; never double-count usage subsets or infer unknown costs. | Must-have |
| R5 | Remain notification-only: never change prompts, headers, payloads, tool outcomes, continuation, resource paths or MCP ownership. | Must-have |
| R6 | Preserve opt-in, local private exporters, bounded work/cardinality/queues, trace-off operation, sticky loss and natural cleanup. | Must-have |
| R7 | Prove semantics at real Pi lifecycle and decoded OTLP boundaries, then separately verify the installed package in the viewer. | Must-have |
| R8 | Capture conversation/thinking text, arguments/results, session names, raw errors, raw provider events, credentials or paths. | Out |

## Selected approach: explicit lifecycle records, not a raw event dump

| Part | Mechanism |
|---|---|
| A1 | A bounded activity/run/turn state machine selects parents and writes opaque correlation IDs. |
| A2 | A model-observation owner timestamps context preparation, assistant streaming milestones, final metadata and conditional provider phases. |
| A3 | A lifecycle owner records compaction intervals, UI waits and selected configuration changes. |
| A4 | Session activation emits safe capability/inventory snapshots and explicit replacement reasons. |
| A5 | One allowlisted encoder and private Telemetry owner enforce field, metric and emission budgets. |

A1–A5 address R0–R7 under the source-contract limitations below; R8 stays excluded.
No global tracing/context hooks, private Pi instrumentation or generic event bus
framework. Keep the working product intact at each implementation slice.

## Correlation and trace structure

```text
pi.activity                          before_agent_start → agent_settled
├── pi.agent_run                     agent_start → agent_end
│   ├── pi.turn                      turn_start → turn_end
│   │   ├── pi.model_call            context → finalized assistant message_end
│   │   └── pi.tool                  execution_start → execution_end
│   │       └── pi.tool              nested calls preserve actual parent IDs
│   └── pi.turn …
├── pi.compaction                    can occur between runs
└── pi.agent_run …                   automatic continuation/recovery
```

- `pi.activity.id`: random per observed activity, **not a prompt ID**. Start at
  `before_agent_start`, retaining `messageType=user|custom` only. Close at final
  `agent_settled`, not `agent_end`. Preserve individual run outcomes and report
  activity `had_error` separately from final abort/settlement; settlement alone
  does not prove task success.
- `pi.run.id`: one per low-level run. `pi.turn.id`: one per turn, with run-local
  numeric index. `pi.request.id`: one per logical model-call observation, not a
  provider network-attempt ID. Carry applicable IDs on all related records.
- `session.id` and random activation resource identity retain existing semantics.
  Tool/response identifiers retain their current bounded validation contracts.
- Input is an observation, not an accepted-prompt counter. `input` may be handled,
  transformed or queued by other extensions; record source/streamingBehavior only
  and do not invent FIFO attribution. Steering/follow-up messages do not justify
  separate activity roots or a claim of one activity per human submission.
- Pre-prompt compaction can precede `before_agent_start`: give it a separate root,
  session correlation and its own ID, not a fabricated activity parent. Manual
  idle tools/compaction likewise have explicit standalone scope.
- No active parent at an event: create a documented standalone observation or
  omit that parent; never reuse the previous completed activity/run/turn IDs.
  A repeated `context` before a terminal interrupts the prior observation as
  incomplete, rather than overwriting it. At turn/run end, close missing model
  terminals as incomplete without invented usage. Unsupported provider callbacks
  do not by themselves imply a lost assistant observation.
- Parent activity/run spans will not appear until completion. Start/end logs make
  live activity visible before spans finish. Trace-off keeps IDs and metadata.
- Shutdown/reload/replacement finalizes open operations as incomplete once;
  mismatched terminals do not fabricate zero-duration successful spans.

## Event-to-signal specification

Names are proposed release schema; finalize them before each slice's tests.

| Pi event(s) | Selected metadata | Proposed output and meaning |
|---|---|---|
| `session_start`, `session_shutdown` | Fixed reason enum, mode, safe Pi/extension versions | Enrich `pi.session_start/end`; counts describe runtime activations, not unique historical sessions. |
| `input` | Source, streamingBehavior when present | `pi.input_received` log only; never prompt text/images or accepted-work claims. |
| `before_agent_start`, `agent_settled` | Trigger type, aborted, observed run/turn counts, had_error | `pi.activity_start/end`, activity span and duration/count. Duration starts at observed preparation hook, not raw input arrival. |
| `agent_start/end` | Outcomes and elapsed time | Retain run logs/count/duration with activity correlation. Never inspect `messages` to infer retry causes. |
| `turn_start/end` | Index, normalized boundary outcome, observed counts | `pi.turn_start/end`, turn span and duration/count. `continue` is only this handler's observed boundary proposal, not a guaranteed final continuation. |
| `context` | Timestamp only; do not traverse messages | Begin logical `pi.model_call` observation; includes later transforms/auth/routing/transport/streaming, not exclusive HTTP time. |
| Assistant `message_start/update/end` | Event discriminants, final allowlisted metadata and numeric usage | Complete `pi.model_call_end` summary; observed streaming duration, SDK-reported `durationMs` when present, stop reason, physical provider/model/api, response IDs/model, effective thinking level. No content blocks retained. |
| `before_provider_headers`, `before_provider_request`, `after_provider_response` | Timestamps, presence/counts, numeric response status only | Enrich current model summary only when association is unambiguous. Never read/export header values or payload. Label hook intervals as observed phases, not HTTP attempt durations. No separate attempt counter. |
| `session_before_compact`, `session_compact`, `session_compact_failed` | Reason, willRetry, fromExtension, aborted; validated tokensBefore | `pi.compaction_start/end`, span, count/duration by reason/outcome. Terminal-only failures get an end log without invented duration; never emit errorMessage, summary, branch entries or details. |
| `ui_prompt_start/end` | Kind only | `pi.ui_wait_start/end`, interval span and duration by kind. Drop title. Pair only when unambiguous; overlapping same-kind prompts lose precise pairing, not become invented waits. Waits may overlap tool/model spans; not an additive phase. |
| `model_select`, `thinking_level_select` | Safe selected provider/model, source enum, old/new level enum | `pi.model_selected`, `pi.thinking_level_selected` logs. Selected model is not necessarily the physical model used. Snapshot selection at activity start as configuration context. |
| `resources_discover` | Startup/reload reason, bounded counts via public tool/MCP getters | `pi.resources_observed`; means snapshot at this handler, not completed discovery or plugin loading. Never return paths or export names/descriptions/server configs. |
| `session_before_switch/fork/tree`, `session_tree` | Operation kind, summary requested/present booleans | Request/observed-completion logs; successful new/resume/fork/reload confirmed through shutdown/start reasons. No completion duration for cancellable requests without a terminal. No session names, files or summaries. |
| `tool_execution_start/end` | Existing IDs, parent IDs, safe tool name, outcome, durations; execution-observed boolean | Retain `pi.tool_result` and span/count/duration. Missing duration means execution unobserved, not a known permission denial; generic public events do not prove why it did not run. |
| `tool_execution_update` | No content | Optionally a saturating in-memory update count on final tool summary; no per-update export. Not needed for the first release slices. |

### First-output timing and request semantics

Use `context` as baseline, with a monotonic timestamp. Track the first normalized
nonempty `text_delta` or `thinking_delta`, or first `toolcall_start`, as
`first_output_latency`; record its fixed kind. Independently track first nonempty
`text_delta` as `first_text_latency`. A tool-call start means structured output
began, not a measured token. Never count empty text/thinking block starts or the
stream `start` event as first output. Only examine event type and delta length;
never retain or serialize delta/partial/message content. Missing milestones are
omitted, not zero. This is **not universal provider TTFT**.

Normalized output counts can be summarized once at completion if useful; do not
log each delta or attach raw `provider_stream_event.data`. Do not register the raw
stream observer merely to count it. Stream-only duration remains a distinct
`assistant_lifecycle` measurement; SDK `durationMs` has its own source label.

Provider callbacks have no correlation IDs or universal multiplicity contract.
The implementation spike must establish safe association in agent-owned calls.
If it cannot, ship preparation/normalized-output timing first and omit correlated
provider-phase fields; do not guess. Unmatched/ambiguous callbacks get bounded
coverage counters, not sensitive records. Additional callbacks cannot silently
replace the first status and claim one transport attempt.

Replace the misleading current `pi.llm_request` schema with `pi.model_call` span
and `pi.model_call_end` log once the new owner is in place; document the semantic
change and remove the obsolete path. No duplicate emissions or compatibility
aliases. Historical records remain historical and are not rewritten.

### Accounting and metric design

Keep `pi.token.usage` and `pi.cost.usage` assistant-only and delta. Final assistant
`message_end` remains the sole usage accounting owner; other events do not add
usage again. Missing/invalid values remain omitted, not zero.

Add reasoning and 1h cache-write **breakdowns on completion logs first**, explicitly
subsets of output/cacheCreation; do not add new additive token categories. Only
report a residual non-1h cache-write amount when both fields are valid and the
subset is within the total; do not claim the residual is a five-minute bucket
without a provider contract. Add estimated cost components as log breakdowns
only when supplied and valid; total remains the existing authoritative estimate.
Compaction usage remains excluded in this release, even though its completion
entry may contain usage: latency coverage is not expanded billing coverage.

New instruments: activity/turn/model-call/compaction counts and duration
histograms, first-output/first-text latency histograms, UI-wait duration, and a
small fixed-label coverage counter. Units seconds; enum-only outcome/reason/kind,
bounded provider/model where needed. No session/activity/run/turn/request/tool-call
IDs or response status codes as metric labels. No per-event metric inventory.
Every histogram documents inclusiveness and overlap; dashboards must not sum
nested spans or UI waits into total elapsed time.

## Public-API limits and exclusions

- `auto_retry_start/end` and `queue_update` are SDK subscriber events, **not**
  extension `pi.on()` events. No `as any`, private AgentSession access, wrapping
  global SDK functions, error-text matching, or counting consecutive runs as
  retries. Document repeated runs and compaction `willRetry` as observations.
  Exact retry/backoff attribution needs a separate upstream public-API proposal.
- No generic plugin-loaded or per-extension-handler execution hook exists in
  this extension API. Emit limited inventory counts, not invented plugin timings.
  Defer actual extension execution timing until Pi exposes a safe public event.
- Never register `mcp_servers_change` for telemetry: doing so claims MCP connector
  responsibility. Inventory means registered servers only, not connected/healthy.
- `cache_warming_decision` is actionable and lacks a matching usage/completion
  lifecycle here. Do not interfere with it or claim warm-request accounting.
- No task titles inferred from prompt text; no session.name capture, prompt
  hashing, task classification or history scan. Opaque IDs give grouping, not task
  meaning. Direct nested model work remains outside the current accounting owner.
- Observer order means mutable metadata/boundary proposals reflect what this
  handler saw, not necessarily the final value after all extensions. Never clone
  whole events and try to redact them afterwards.

## Implementation ownership and bounds

Keep `src/index.ts` as registration entry and `src/telemetry.ts` as the sole
exporter/provider owner. Extract the now-growing `src/session.ts` by coherent
state ownership: activity/run/turn correlation, model-call observations and
auxiliary lifecycle intervals. One owner calls usage instruments. Use explicit
parent contexts, not a global context manager. No speculative plugin framework.

Preserve 32-attribute/128-character payload limits and queue/in-flight ceilings;
produce an attribute-budget table before adding fields (omit optional breakdowns
before required IDs/outcomes). Retain existing model/tool cardinality caps and
1024 open-tool bound. Bound activity/run/turn/model state to supported active
operations, compaction to one observed pending operation, UI wait tracking to a
small fixed maximum (proposed 16) with ambiguity handling. Saturate update counts.

Do not export every message/provider/tool update. Start/end logs add volume:
load-test a rapid multi-turn run against the current queue of 64 and 5s flush.
Require explicit bounded admission policy and visible loss under overload; do
not silently sample away failures or increase queues/timeouts without measured
justification. The initial short-session export-loss issue (`bbt`) remains separate;
this plan does not diagnose or quietly change its deadlines.

## Incremental delivery and proof

Each slice is its own jj change and must preserve existing metadata privacy and
trace-off behavior. Add the next layer only after the preceding slice works end
to end in the decoded loopback receiver.

| Slice | Deliverable visible in viewer | Acceptance proof |
|---|---|---|
| V1 — Activity and turns | Group runs/turns through final settlement; start logs identify live work | Real SDK: two turns, additional low-level run, extension continuation, custom trigger, steering/follow-up, abort and replacement. Assert parents, IDs, run-local index and exactly-once closure; no one-prompt claim. |
| V2 — Honest model timings | Preparation-to-completion, first-output/text, final physical model/effort and usage breakdowns | Real synthetic provider through SDK: controlled pre-stream delay, thinking/text/tool-only output, empty blocks, setup error, missing milestones, routed model and abort. Verify interval ordering/nonzero intended delays; one usage contribution. Prove provider hook association separately before enabling those fields. |
| V3 — Compaction and waits | Previously unexplained intervals become named operations | Real manual/threshold/overflow compaction, success/error/cancel/terminal-only cases; before/inside/between activities. Nested UI waits, unmatched events and ambiguous concurrent same-kind waits; no false durations or summary/title leakage. |
| V4 — Configuration/runtime observations | Model/thinking changes, replacement reasons, input/resource snapshots, navigation observations | Real reload/new/resume/fork and cancelled before-hooks; prove telemetry changes no outcomes/continuations/resources or MCP ownership. Inventory fields are counts, not claims of load/connection time. |
| V5 — Acceptance and operator guide | Explain dashboard semantics with read-only example queries | Full privacy/bounds/outage/trace-off suite; packed installed artifact; approved installed-package live smoke confirms stored records and correlations. Update README, contracts, changelog and limitations together. |

Use existing real-Pi fixture/receiver tests, extending their scenarios instead
of testing private helpers or mocking the handler contract. The current fixture
emits immediate synthetic start/done and does not invoke transport callbacks:
it cannot prove first-output or provider-phase semantics without extension.
Provider-hook proof should use a synthetic provider that actually calls the
public options callbacks; use a real built-in provider against an isolated local
HTTP server for any provider-specific transport/multiplicity claim. No paid calls.

Every slice needs the test-audit authoring gate: identify the observable contract,
credible failure, gap in existing coverage and absence of test-only production
seams. Privacy sentinels go in every newly reachable sensitive field: prompts,
partial deltas, raw event data, headers, payload, UI title, summary, raw errors,
MCP config and paths. Assert no sentinel in any decoded signal. Stress queue
admission, ambiguous callbacks, shutdown interruption, cardinality and trace-off.

Run `make format`, `make check`, `make test` in order; package validation at V5.
No service restarts or independent access to the active DuckDB file. Live writes
beyond normal session telemetry require fresh approval; export ACK is not storage
proof. Planning completion does not mean any slice has been implemented.

## Planning validation

Only this plan, its investigation note and issue bookkeeping changed. `make format`
and `make check` passed. `make test` passed the unit test and 26/27 integration
cases; the tools case emitted the fixed telemetry-loss diagnostic and failed
its empty-stderr assertion. Immediate focused rerun passed both tools cases.
This is an unresolved intermittent observation, recorded on existing issue
`pi-opentelemetryroot-bbt`, not a clean full-suite pass or a diagnosis. No code,
test, transport deadline, installation or service changes were made.

## Proposed next action

Approve this scope, then begin V1. Treat unsupported HTTP-attempt/retry and
other-extension execution timings as explicit gaps, not blockers for the public
lifecycle improvements. Lock V2 schema and correlation coverage after its focused
spike; do not widen scope into content capture or comprehensive billing.
