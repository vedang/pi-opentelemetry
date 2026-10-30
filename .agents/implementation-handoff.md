# Implementation and acceptance handoff

Updated 2026-10-30 after owner dependency installation and real decoded-wire validation.

## Current status

- `uf4.1–uf4.6`: accepted and closed. All three signals are implemented and tested; traces are not deferred.
- `uf4.7`: implementation complete, acceptance blocked only on frozen dependency installation and isolated tarball installation/load.
- `uf4.8`: untouched explicit approval gate for real collector/viewer persistence. No live pipeline traffic has been sent.
- Package remains private / UNLICENSED. No public distribution, push, global installation, paid calls, service changes or owner configuration changes.

## Latest actual evidence

Final ordered gate run on Node **24.22.1**, pnpm **12.16.1**, Pi **1.4.0**:

1. `make format`: PASS, 25 files (formatted the new hung-RPC test).
2. `make check`: PASS, Biome + TypeScript + Knip.
3. `make test`: PASS, unit **1/1**, integration **27/27** across ten integration files, approximately 72 seconds.
4. Focused trace suite additionally passed three consecutive runs before the full gate.
5. Focused outage suite passed **5/5**, followed by the full gate above.
6. `pnpm pack --pack-destination /tmp/pi-otel-pack-validation`: PASS after final source/README changes.
7. Archive inspected with `tar -tzf`: exactly package.json, README.md and four source files; no tests, plans, credentials or settings.
8. `br lint`: PASS.

The artifact is `/tmp/pi-otel-pack-validation/pi-opentelemetry-0.1.0.tgz`.
A successful pack/content inspection is **not** isolated package installation acceptance.

## Dependency and lifecycle-script resolution

The owner ran the previously blocked operations:

```sh
pnpm add -D -E protobufjs@8.8.0
pnpm remove -D @opentelemetry/otlp-transformer
```

Manifest and lockfile changes were preserved. Direct protobufjs 8.8.0 now decodes maintained upstream OTLP v1.9.0 protobuf fixtures. The obsolete Knip transformer ignore was removed.

Both pnpm commands applied their dependency changes before reporting ignored lifecycle scripts. Inspection found `@google/genai`'s preinstall only echoes, and transitive protobufjs 7's postinstall only warns about version ranges. Neither produces required runtime artifacts. `pnpm-workspace.yaml` now explicitly declines both with `allowBuilds: false`; **no script approval or `pnpm approve-builds` is needed**. Direct protobufjs 8 is not the transitive protobufjs 7 script reported in that warning.

The active harness package-mutation block is separate from pnpm's script policy. Do not bypass it by invoking an installation wrapper, copying dependencies, importing transitive packages, or fabricating lockfiles.

## Fixes discovered by executing real acceptance suites

- Real tools were disabled by fixture `tools: []`. The fixture now explicitly permits only its four synthetic extension tools.
- Cancellation during tools can create another finalized zero-usage assistant observation. Tests independently check observation count and actual token totals. Public `ctx.signal.aborted` classifies cancellation before generic error, without reading error strings.
- Receiver receipt precedes client export acknowledgement. The recovery test polls public status for acknowledged failures/successes, retaining sticky loss; it no longer races exporter callbacks.
- Independently rounded SDK default span timestamps could invert nested endpoints by a fraction of a millisecond. Both span starts and ends now explicitly use the same `performance.timeOrigin + performance.now()` mapping.
- Added real application-level gRPC hung-receiver proof: actual logs, metrics and traces arrive but receive no replies, a subsequent Pi prompt still works, and the child naturally exits with bounded shutdown. This complements TCP refusal/hung-handshake cases rather than mistaking either for accepted OTLP requests.

## Behavior actually verified

Real public Pi SDK sessions use an offline synthetic provider, isolated HOME/agent/work directories, and maintained-protobuf loopback receivers; no captured-handler invocation substitutes for lifecycle proof.

- Assistant-only finite reported usage/cost, unknown costs, model/provider changes, errors/aborts, restored-history exclusion and independent delta collection intervals.
- Session/run/request/tool events and metrics, parallel/nested real tool IDs, inclusive-duration semantics, normalized outcomes and incomplete shutdown.
- Explicit run/request/tool span trees, correlation IDs on actual exported logs, trace-off absence and unchanged accounting.
- Metadata privacy with hostile environment/content/metadata sentinels, bounds/cardinality/admission and sticky loss/status.
- Refusal, hung handshake, accepted-but-unanswered OTLP, 1,100-tool load, new/resume/fork/reload replacement, clean natural child exits and shutdown under 1.5 seconds. No forced exit conceals resource leaks; stdout stays empty and warnings are fixed/safe.

Production uses private official SDK providers/exporters, explicit contexts and no global registration or process-environment mutation. Queue/batch/admission bounds are 64 per signal; RPC deadline is 100 ms, processor deadline 150 ms. Shutdown settles providers concurrently and explicitly closes retained public exporters. These small local best-effort limits may lose records and are documented honestly.

Inherited general or per-signal OTLP header settings (including empty) disable telemetry with a fixed diagnostic: the owner-approved fail-closed contract. Only local shared OTLP/gRPC destinations are supported. Assistant accounting excludes compaction, branch summaries and separate nested-model/tool reports; no complete-spending claim.

## Remaining owner action / continuation

The harness still forbids package mutation. The owner can run these directly, or resolve that policy before asking the agent to run them:

```sh
pnpm install --frozen-lockfile --ignore-scripts
make test-package
```

The package target installs **offline** in an isolated temporary pnpm project and loads it through that project's Pi with telemetry disabled. It does not install globally or touch the live collector. It has not been run after the dependency correction and must not be claimed as passing. Do not close `uf4.7` until both commands pass and any failures are resolved. Rerun normal ordered gates if code/configuration changes are needed.

Only after packaging acceptance, request separate explicit permission for `uf4.8`. Existing collector endpoint is localhost:4317, forwarding to the viewer at :4327; existing files live under `~/.local/share/claude-otel/`. Never independently open the live DuckDB database. ACKs alone do not prove viewer persistence. Do not make persistent environment/installation/service changes or paid calls without separate approval.

## Commits

Implementation history: `26515466` scaffold, `a574d42c` assistant logs/metrics, `be62c410` run/tools, `4bfcc400` traces, `a715cf41` bounds/privacy/replacement, `30bf3008` incomplete/timing contracts, `9175add1` package/docs/CI, `63a8143f` prior blocked handoff.

Acceptance-driven follow-up:

- `127b4e92`: direct decoder dependencies and explicit script denial.
- `e7242212`: actual fixture tools and abort classification/accounting.
- `f9842f2b`: shared monotonic wall-clock span timestamps.
- `18f80ab8`: client-acknowledged recovery assertions.
- `fc063bcb`: accepted-but-unanswered OTLP shutdown proof.

See `docs/contracts.md` for historical discovery and approved contracts, README for the supported product/configuration, and the local implementation plan for ordered slice history. Historical blocked notes are superseded by this acceptance evidence, not erased.
