---
shaping: true
---

# Pi 1.4.0 event-contract investigation

## Context and goal

Owner requested richer operational measurements and lifecycle coverage, explicitly
excluding conversation/thinking/tool-argument/tool-output capture. This is a
planning investigation, not authorization to implement or change the live pipeline.
Determine what an ordinary installed extension can observe without private hooks.

## Sources inspected

Installed `@earendil-works/pi-coding-agent`, `pi-agent-core`, and `pi-ai` **1.4.0**;
project peer/development dependencies pin this version. Documentation was read
from the installed global package; declarations and dispatch code were inspected
in this checkout's dependency tree. Upstream links below are navigation links,
not immutable version pins; implementation must use the installed 1.4.0 contracts.

| Source | Relevant contract |
|---|---|
| [Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), lifecycle/composition/provider-stream sections | Event ordering, notifications vs transformations, conditional transport hooks |
| [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), session/subscription sections | SDK subscription differs from extension event API; settlement vs low-level run |
| [Compaction](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md) | Manual/threshold/overflow reasons, recovery ordering, terminal failure event |
| [Messages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/message-types.md) | Usage subsets, message metadata, unsafe content/diagnostics fields |
| [Virtual models](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/virtual-models.md) | Selected model differs from dispatched model; direct calls differ from agent calls |
| `dist/core/extensions/types.d.ts:551–928,1187–1227` | Exact events and public `pi.on()` overloads; `ExtensionContext` has no session subscription |
| `dist/core/sdk.js:196–284` | Provider callback forwarding; transport hooks do not carry a request ID |
| `pi-agent-core/dist/agent-loop.js:264–339` | Context/auth/stream setup precede assistant `message_start`; setup errors can synthesize message start/end without a stream start |
| `dist/core/agent-session.js:684–790,898–930,1417–1530` | Final settlement, extension run/turn dispatch, turn index reset per run, pre-prompt compaction before `before_agent_start` |
| `dist/core/agent-session.js:2240–2350,2535–2640,3070–3120` | Compaction terminals including cancellation; retry notifications are SDK-only |
| `examples/extensions/debug-provider.ts`, `custom-compaction.ts`; `examples/sdk/06-extensions.ts`, `13-session-runtime.ts` | Public integration examples, custom summaries, replacement/disposal |
| Existing `docs/contracts.md`, `src/session.ts`, `src/telemetry.ts` | Current privacy/accounting/transport contract and limits |

## Questions and findings

| Question | Finding |
|---|---|
| Can we group work beyond one `agent_start`? | Yes: `before_agent_start` to `agent_settled` covers an observed activity with repeated low-level runs. It does not prove one human prompt: steering/follow-ups/custom continuations can contribute. Pre-prompt compaction happens before this start boundary. |
| Can we identify turns? | Yes: `turn_start`/`turn_end`; index resets on each low-level run. Use `(activity, run, turn ID)` plus numeric index, never index alone. |
| Can `message_start` measure full request latency? | No. It is emitted from stream `start`, possibly after setup/response acquisition; for setup errors it can be synthesized at completion. Existing assistant-lifecycle duration omits earlier work. |
| What is the safe pre-call boundary? | `context` marks observed model-call preparation; duration through finalized assistant `message_end` includes subsequent transforms, routing/auth/provider work and streaming. Call it observed model-call latency, not HTTP/server latency. `turn_start` is broader. Verify failure paths without message events before implementation. |
| Can we measure TTFT? | Only observed time to first normalized output. `message_update.assistantMessageEvent.type` distinguishes text/thinking/tool-call updates. There is no universal token-arrival event. Empty block starts are not tokens; raw `provider_stream_event.data` is unknown, provider-specific and sensitive. |
| Can we observe HTTP response status? | Conditionally: `after_provider_response.status` is numeric. No public attempt/request ID ties it to the other provider hooks. Availability and multiplicity depend on provider/transport. Do not count hook invocations as HTTP attempts. |
| Can we capture actual effort/model and finer usage? | Final assistant messages expose dispatched provider/model/api, thinkingLevel, providerThinkingLevel, responseModel, durationMs. `reasoning` is a subset of output; `cacheWrite1h` is a subset of cacheWrite. Missing values are unknown. |
| Can we time compaction? | Yes: `session_before_compact` to `session_compact` or `session_compact_failed`. Terminals can exist without a start (e.g. manual preparation fails); preserve the terminal, omit fabricated duration. Recovery can occur between low-level runs, not inside a run. |
| Can we measure approval waits? | `ui_prompt_start/end` expose kind but no prompt ID. Titles can contain content and must be discarded. Pair only unambiguous matching intervals; concurrent same-kind waits cannot be reliably assigned. |
| Are retries first-class extension events? | No: `auto_retry_start/end`, `compaction_start/end`, `queue_update` exist on SDK subscriptions but not `ExtensionAPI.on`. Do not cast strings, access private runner/session internals, or scrape error messages. |
| Is there a generic hook/plugin execution lifecycle? | No. `resources_discover` is a resource-path contribution hook, not a resource-load completion or extension execution timer. Public APIs allow tool and registered-MCP inventory counts, not complete plugin execution timing. |
| Can observing MCP changes have side effects? | Yes. Registering `mcp_servers_change` marks an extension as responsible for connecting registered servers. A telemetry extension must not register this event. Reading `pi.getMcpServers()` is different from claiming connections. |
| Can every before-event be paired? | No. Before switch/fork/tree hooks are cancellable, and not all have public failure/cancel terminals. Log requests/observations without inventing completion or elapsed success. |

## Acceptance and remaining implementation spikes

Investigation establishes the public event map and its limits. Before implementing
provider phase correlation, prove 1.4.0 behavior with the real Pi SDK, isolated
synthetic provider and actual hook callbacks, including missing/duplicate hooks,
setup errors, cancellation, direct nested model work, and virtual model routing.
Provider callbacks lack IDs: when association is ambiguous, omit attribution and
report partial coverage rather than attaching to whichever request is current.

No claim of measured other-extension overhead, network retry count, universal
TTFT, complete spending, or content-free task naming is justified by these APIs.
