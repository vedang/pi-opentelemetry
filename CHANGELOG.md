# Changelog

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
