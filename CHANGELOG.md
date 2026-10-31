# Changelog

## Unreleased — granular telemetry V1

- Bounded activity → run → turn correlation through final settlement, with live
  activity/turn start/end logs, unique record-only IDs and run-local turn indexes.
- Activity settlement is neutral, not task success; aborted and observed-error
  flags are independent. Incomplete cleanup never invents completion durations.
- Explicit standalone scope, trace-off correlation and idempotent owner cleanup;
  existing assistant-only usage and queue/cardinality limits are unchanged.
- Real-Pi multi-run/continuation, steering, custom-trigger, abort, active reload,
  rapid-turn admission, privacy and decoded ancestry proof. Expanded package/live
  verification remains separately gated; intermittent export loss is not fixed.
- Owner-approved quarantine of the flaky trace-enabled multi-run activity test;
  regular runs explicitly skip it, and `make test-flaky` retains opt-in coverage.
  V1 implementation acceptance does not claim the deferred export-loss repair.

## 0.1.0 — local minimum release candidate

- Explicit Pi opt-in and local-only OTLP/gRPC destination validation; fail closed
  when inherited general/per-signal OTLP headers are present, including empty.
- Private official OpenTelemetry log/metric/trace providers, bounded batching,
  explicit resource/credential/destination settings and delta metrics.
- Session/run/assistant/tool metadata, assistant-only usage/cost, concurrent and
  nested tool correlation, and independently opt-in request/run/tool traces.
- Read-only status, sticky known loss, bounded state/cardinality, safe diagnostics
  and orderly shutdown/replacement cleanup.
- Offline real-Pi/decoded-OTLP tests, isolated package verification and minimal CI.

Private and UNLICENSED pending the owner's public-distribution license decision.
Live collector/viewer/database persistence verification is not part of this
implementation candidate and remains separately approval-gated.
