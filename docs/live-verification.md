# Installed-package live verification

Verified **2026-10-31**, with owner approval to launch a sub-session and test the
Git-installed package against the existing collector/viewer. No paid model calls,
permanent settings changes, package installation, or service restarts were made
by the agent.

## Scope and setup

- Installed by owner: `pi install git:github.com/vedang/pi-opentelemetry`.
- Installed checkout: `f710707031e78609ce45e4fb596553e8bca5bf29`.
- All four installed source files matched the development checkout's SHA-256
  hashes before testing. The installed checkout was not edited.
- Pi **1.4.0**, otel-desktop-viewer **0.6.0**, Collector Contrib **0.164.0**.
- Real Pi CLI sub-processes, launched through interactive-shell dispatch, used
  isolated HOME/agent/cwd, offline mode and an in-memory session. Explicit `-e`
  loaded the installed package directory and a disposable synthetic provider;
  unrelated personal/project extensions were disabled. This verifies the actual
  installed artifact, not every extension in the owner's usual profile.
- Per-process flags enabled `PI_OTEL_ENABLED=1`, `PI_OTEL_TRACES=1`, shared endpoint
  `http://127.0.0.1:4317`, protocol `grpc`. Installation alone leaves telemetry off.
- Existing pipeline was reused unchanged: collector gRPC **4317** → viewer gRPC
  **4327** → the viewer-owned DuckDB file. Read-only queries went through the
  running viewer at **http://localhost:8000**, not OTLP HTTP port 4328. The active
  database was never independently opened.

Before the probe, the viewer contained no Pi records. Existing `claude-code`
records numbered **20 logs / 14 metric datapoints / 0 spans**; those counts were
unchanged afterwards.

## Independent expectations

One synthetic prompt produced one run with two finalized assistant observations,
two parallel top-level tools, and one nested tool. Each assistant observation
reported input=3, output=2, cacheRead=1, cacheWrite=4, estimated cost=0.35. Expected
assistant-only totals: **20 tokens**, cost **0.70**. These are deliberately
synthetic reported values, **not actual model charges**. Much larger tool-reported
usage must not inflate these assistant-only totals.

Expected persisted records per successful session:

| Signal | Expected and observed |
| --- | --- |
| Logs | **9**: session start/end, run start/end, two requests, three tool results |
| Spans | **6**: one run root, two request children, three tools including the nested child |
| Metrics | **14 datapoints** across all **7** documented instruments |
| Correlation | All **7** trace-linked logs match an actual stored `(trace_id, span_id)` pair |
| Usage | input=6, output=4, cacheRead=2, cacheCreation=8; total=20; synthetic cost=0.70 |
| Temporality | All sums/histograms have received aggregation temporality **1 (DELTA)** |
| Timing | Zero child/parent timestamp inversions; nested tool attaches to outer tool |
| Privacy spot-check | Zero stored attribute/body matches for synthetic content, fake credential or temporary working-directory markers |

The privacy spot-check complements the broader automated privacy suite; it is
not a claim to have exhaustively inspected every possible sensitive input.

## Attempts and results

1. Session `1c00cdf1-65d2-41b4-8240-cb797644ca70`: process exited **0**, but stderr
   contained the fixed `pi-otel: degraded (telemetry loss)` diagnostic. **No Pi
   records persisted from this attempt. This attempt failed.** Its cause is not
   established; do not label it a proven timeout or collector defect. The very
   tight 100 ms RPC / 150 ms processor deadlines are a possible contributor,
   not a diagnosis.
2. Session `1c00cdf1-65d2-41b4-8240-cb797644ca71`: exited **0**, empty stderr, all
   expected records and values persisted. A disposable diagnostic extension
   additionally imported official exporter modules. Its attempted callback
   observer produced no diagnostic output; no result-code evidence is claimed.
   Because those extra imports could affect timing, this is not the sole proof.
3. Session `1c00cdf1-65d2-41b4-8240-cb797644ca72`: reran **without** the diagnostic
   extension or any production changes. Exited **0**, empty stderr, and all
   expected records, values and correlations persisted. This is the primary
   confirmation.

Final confirmation identifiers:

- Service: `pi-coding-agent` / version `1.4.0`.
- Instance: `7a73ba0a-ad4f-4376-a895-9283b201e36c`.
- Viewer resource reference: `51528697-ccd6-1e14-7cfc-43c72046c685`.
- Trace: `0abf4b55cc5325851ff465b20bf5cdb0`.

After all attempts, Pi totals were **18 logs / 12 spans / 28 metric datapoints**:
exactly two complete persisted sessions, not three. Data from the failed attempt
was not silently recovered or counted as delivered.

## Recheck through the existing viewer

These are read-only queries; retained records can eventually be pruned by the
configured store size limit:

```sh
otel-desktop-viewer trace 0abf4b55cc5325851ff465b20bf5cdb0 --json
otel-desktop-viewer query "
SELECT m.name, m.metric_type, m.aggregation_temporality,
       d.value_type, d.int_value, d.double_value, d.count, d.sum
FROM metrics m
JOIN metric_datapoints d ON d.metric_id = m.id
WHERE m.resource_id = '51528697-ccd6-1e14-7cfc-43c72046c685'::UUID
ORDER BY m.name" --json
```

Successful viewer queries prove the records reached its persisted store, beyond
an exporter ACK. They do not prove fsync/crash durability or exactly-once
transport. The first failed attempt remains a known observation tracked in
`pi-opentelemetryroot-bbt`; best-effort delivery and sticky loss remain product
limitations.
