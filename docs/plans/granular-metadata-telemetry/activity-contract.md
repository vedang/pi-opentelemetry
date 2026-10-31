# V1 activity and turn contract (Pi 1.4.0)

An activity is the observed interval from `before_agent_start` to final
`agent_settled`. It is **not a human prompt identity**: steering, follow-ups,
custom triggers, post-run queues and boundary continuations can contribute.
Pre-prompt compaction has no activity owner. `agent_end` closes only a low-level
run. Pi resets `turnIndex` at every `agent_start`; each turn gets a fresh UUID
and record-only `pi.turn.index`.

## Ordering evidence

Inspected installed 1.4.0 `core/extensions/types.d.ts` (BeforeAgentStartEvent,
AgentSettledEvent, TurnStartEvent, TurnEndEvent), and `core/agent-session.js`:
`_prepareRun` compacts before emitting before-agent-start; `_emitExtensionEvent`
resets `_turnIndex` on agent-start and increments after turn-end;
`_handlePostAgentRun` and `_runBeforeSettleBoundary` can request further runs;
`_emitAgentSettled` emits the final public aborted boolean. Boundary outcome is
an observation, not a task-success verdict. Telemetry never requests continuation.

## Defined anomaly and cleanup policy

Defined before adding the V1 tests:

- One activity, one run and one turn at most, plus the existing single serial
  assistant observation and at most 1,024 tools. No completed-ID registry.
- Repeated starts close the previous owner and descendants once as incomplete
  before assigning a new UUID. No completion duration or usage is invented.
- Turn-end with a mismatched index closes the open turn incomplete without a
  duration. Terminal-only turn/settlement emits an incomplete end with
  `pi.start_missing=true`, no invented operation ID/span/duration or count.
- Run-end without an open run is ignored. A run or turn without an activity is
  explicitly scoped to the actual available owner, never the previous activity.
- Real terminals record count and elapsed seconds; incomplete cleanup records an
  incomplete count, but no duration sample. Observed final deferred/incomplete
  outcomes can still have a real measured lifecycle interval.
- Shutdown/reload/replacement closes descendants before ancestors incomplete
  once. Natural public runtime replacement usually aborts and settles first;
  that is an observed abort, not fabricated incomplete work.
- IDs disappear as soon as owners close. Records carry `pi.scope` as
  `standalone|activity|run|turn`; session start/end are standalone. Tools retain
  real nested parents (including composite pipe IDs). Unknown nested parents
  use the active turn/run/activity and retain `pi.parent.unknown=true`.
- Activity final outcome is `settled` (neutral trace status), not `success`.
  `pi.aborted` is solely the settlement boolean, omitted on interrupted cleanup;
  `pi.had_error` independently records observed assistant/tool errors, including
  errors followed by recovery. Run outcomes remain sticky across later success.
- Missing/repeated events mark sticky loss. Delivery remains best effort; local
  exactly-once closure is not an exactly-once delivery/persistence guarantee.

## Record and state budgets

All string fields remain at most 128 characters; SDK limits remain 32 attributes.
Required correlation/outcome fields precede optional metadata. Maximum current
log/span union (start plus end attributes):

| Record | Maximum attributes | Contents |
| --- | ---: | --- |
| session | 2 | session ID, standalone scope |
| activity | 9 | session/scope/activity ID, trigger kind, outcome, had-error, aborted, duration/source |
| run | 7 | session/scope/activity/run IDs, outcome, duration/source |
| turn | 9 | session/scope/activity/run/turn IDs, index, outcome, duration/source |
| assistant request | 20 | six ancestry fields, request ID, operation, provider/model, outcome/duration/source, four usage values, cost, response ID/model |
| tool | 14 | six ancestry fields, call/name/parent/unknown, outcome, lifecycle and execute durations/source |

Optional ancestors are omitted, not empty IDs. There are no operation IDs in
metrics. Activity count/duration dimensions are fixed `outcome=settled|incomplete`,
`had_error` boolean and optional `aborted` boolean (unknown omitted). Turn and run
count/duration dimensions are `outcome=success|error|aborted|incomplete`.
All duration histograms use seconds. Existing model/tool cardinality caps,
64-record admission/queue bounds, five-second batch interval, deadlines and
private exporter ownership are unchanged. Rapid turns can overload delivery and
must report sticky loss; no hidden sampling or queue increase.

Existing `pi.llm_request` schema and assistant-only delta usage remain unchanged
apart from added ancestry; replacement belongs to V2.
