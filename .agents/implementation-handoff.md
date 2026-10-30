# Implementation handoff

## Result

**Blocked at the mandatory discovery gate; not implemented or release-ready.**
The request was to execute `uf4.1`–`uf4.7`, with traces mandatory, then stop
before the separately approved `uf4.8`. No logs/metrics-only release has been
substituted. No bead has been closed without acceptance.

`pi-opentelemetryroot-uf4.1` was claimed, investigated, and marked **blocked**.
The plan/user instruction requires stopping for an owner decision when a
required public contract cannot be met. `uf4.2`–`uf4.7` remain open and blocked
by dependency order; none was claimed out of order. `uf4.8` was not executed.

## Concrete blocker and evidence

Current official gRPC signal exporter constructors do **not** isolate inherited
headers. Explicit destination, empty Metadata and explicit insecure credentials
still transmit `OTEL_EXPORTER_OTLP_HEADERS` and per-signal header values.

- Detailed versioned source evidence, lifecycle mapping, accounting limits,
  shutdown considerations, proposed harness and reproduction: `docs/contracts.md`.
- Executable local receiver proof: `docs/probes/exporter-environment.mjs`.
- Ran twice under Node 24.22.1 / pnpm 12.15.0 with official exporter 0.300.0,
  SDK 3.0.0, API 1.10.0, grpc-js 1.14.6. Actual observed metadata:

  ```json
  {"inheritedGeneralHeader":"INHERITED_SENTINEL","inheritedSignalHeader":"SIGNAL_SENTINEL"}
  ```

Both executions exited naturally with code 0 after provider/server shutdown.
The probe asserts receipt, not absence caused by a broken transport. It tests
actual gRPC metadata, not mocked constructor calls. It is deliberately **not**
a decoded-OTLP/Pi-lifecycle release acceptance test.

Current Pi is 1.4.0. `AgentSession.dispose()` is synchronous and does not emit
`session_shutdown`; the supported async `AgentSessionRuntime.dispose()` does.
Use the latter in the real-SDK lifecycle harness. A second tuning concern is
that log shutdown flushes batches sequentially: a full 512 queue, batch 128,
and one-second export timeout do not establish a 1.5-second aggregate bound.
That requires real outage/clean-process proof, not a Promise timeout.

## Owner decision needed to resume

Preferred narrow adjustment: allow official **public gRPC export delegates,
serializers and exporter base APIs** with explicit configuration, rather than
requiring the three environment-reading signal-exporter constructors. Keep all
encoding/transport/retry work official; no custom protobuf, private patching,
process.env mutation or extra worker/IPC framework. Public delegate export was
found, but a complete three-signal adapter and bounded disposal have **not**
been proven. Finish that discovery before closing `uf4.1`.

Alternative: explicitly permit disabling Pi telemetry whenever inherited header
configuration is present. This is smaller code but weakens the required
“ignore inherited settings while exporting” behavior; it was not silently
implemented.

The owner must also choose/approve a license before distribution. The repository
has no existing license; none was invented or copied from a sibling.

## Validation actually run

- Read the full plan, supplied repository instructions, current installed Pi
  docs/types/relevant source/examples, sibling scaffold, and test-audit skill.
- Installed discovery dependencies only in `/tmp/pi-otel-contracts` using pnpm
  with scripts ignored. No global install, hoisting workaround or other manager.
- Ran the local transport reproduction twice; observed inherited headers.
- Attempted `make format`, `make check`, `make test` in order: all report missing
  targets because the repository has no Makefile yet. These are **unavailable
  gates**, not passing release validation or code failures.
- `node --check docs/probes/exporter-environment.mjs`: syntax checked.
- `jj diff --check` is unsupported by installed jj; fallback `git diff --check HEAD` passed.
- Updated the plan's execution log at its requested local path. The existing
  `.gitignore` excludes `.agents/plans/`; that owner convention was preserved,
  so the plan update is local-only, not included in the discovery commit.
- Real SDK fake-provider lifecycle, decoded OTLP payloads, traces, delta intervals,
  failure/privacy/bounds suites, frozen release install, CI, README/CHANGELOG and
  tarball validation: **not implemented/not run**, blocked before their phases.

No real collector/viewer/database endpoints were contacted; receiver bound only
to an ephemeral 127.0.0.1 port. No paid calls, owner credentials/global
extensions, service/config changes, global installation, publish or push.

## Repository continuation

Discovery evidence is one conventional jj change; a fresh empty change follows
it. No branches were created/switched. Beads are flushed. Resume with the owner
contract decision, complete `uf4.1`, then claim/implement/validate/commit/close
`uf4.2` through `uf4.7` in order. Do not count this handoff as plan completion.
`uf4.8` still requires its separate approval regardless of implementation status.
