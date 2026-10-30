# pi-opentelemetry

Private, metadata-only Pi 1.4.0 instrumentation for a local OTLP/gRPC collector.
Implementation is in progress; no live persistence verification has been performed.

Assistant accounting covers **only live finalized assistant messages observed by this
extension**. It is not complete Pi spending: compaction, branch summaries, separate
nested-model/tool usage, cache warming, historical transcripts and external calls
are excluded. Reported finite nonnegative usage on failed/aborted responses is
retained; missing cost is unknown, not zero. Cache creation maps cacheWrite; output
already includes reasoning. Do not sum log usage and metric usage as separate spend.

Development uses Node 24.22.1 and pnpm **12.16.1**; the package stays private and
UNLICENSED until the owner decides a public-distribution license.
