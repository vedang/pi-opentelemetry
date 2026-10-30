# Implementation handoff — 2026-10-30

## Result and acceptance status

All feasible minimum-release implementation is present, **including runtime-opt-in
traces**. This is **not release-ready / not live-verified**: decoded-wire acceptance
and isolated package installation remain blocked by the active harness's package
mutation restriction. Do not interpret authored tests or source commits as passing
acceptance. Parent requested this final feasible-work handoff rather than waiting
indefinitely for an owner policy response.

- uf4.1: previously closed discovery.
- **uf4.2: accepted and closed**, real Make gates passed.
- **uf4.3: BLOCKED**, not closed, missing direct test decoder installation.
- uf4.4–uf4.7: implementation present, **open/unaccepted**, with commit/evidence notes.
- uf4.8: untouched; separately requires approval for real persistence verification.

The owner's package.json/pnpm-lock.yaml scaffold was preserved and incorporated.
Actual manifest and executable pin are **pnpm@12.16.1**, not 12.6.1 or historical
12.15.0. Development is Node **24.22.1**, Pi **1.4.0**; other advertised-compatible
Node versions were not exercised. Package remains **private / UNLICENSED** until
the owner chooses a public-distribution license. License is not this blocker.

## Commits (jj changes; no branches/push/publication)

| Commit | Change | Result |
| --- | --- | --- |
| `26515466` | nzqtnmnn | `feat: scaffold disabled-safe local telemetry package`; owner manifest/lock included; uf4.2 accepted |
| `a574d42c` | oklsxxqx | `feat: export private assistant session logs and delta metrics` |
| `be62c410` | wmwnxzpw | `feat: record run and nested tool lifecycles` |
| `4bfcc400` | lyqtxqst | `feat: add opt-in private traces with explicit log correlation` |
| `a715cf41` | uknxvmyy | `fix: enforce telemetry bounds privacy and replacement cleanup` |
| `30bf3008` | qnmnosqw | `fix: mark incomplete observations and document timing provenance` |
| `9175add1` | ppvvurtr | `docs: prepare private package validation and minimal CI` |

Later commits correct initial snapshots to the final plan's signal names/units and
canonical correlation attributes. Do not treat earlier intermediate code as the
release contract. Final handoff is a subsequent docs-only commit; a fresh jj change
is left afterward. Beads were flushed with `br sync --flush-only`.

## Exact implementation

- `src/index.ts`: source-entry Pi package; registers handlers/status only. No
  providers, timers or sockets in the factory. Actual allocation at session_start.
- `src/config.ts`: explicit master/trace booleans, grpc-only shared insecure
  loopback URL validation without resolving arbitrary hosts or echoing rejected
  values. Claude flags/PI_TELEMETRY do not opt in. Any general/per-signal OTLP
  header setting, **including empty**, disables safely (owner-approved fail-closed
  policy). Shared process.env is never mutated.
- `src/telemetry.ts`: private official log/metric/trace SDK providers/exporters;
  explicit URL, credentials, Metadata, compression, resource and trace sampler;
  no global provider/context/diagnostic registration. Resource service.name is
  pi-coding-agent, actual Pi service.version, random service.instance.id. Scope
  pi-opentelemetry/0.1.0. Public callbacks record per-signal results; collector error
  objects are not passed onward to processors or printed by extension diagnostics.
- `src/session.ts`: real Pi session ID; fresh local run/request IDs; serial live
  assistant start/end accounting (not object identity or response-ID history);
  observed message provider/model, optional safe response ID/model; finite
  nonnegative input/output/cacheRead/cacheCreation and estimated-cost amounts.
  Missing cost is unknown. Error/abort usage retained; no transcript scanning,
  compaction/summary/tool-inclusive spending or comprehensive accounting.
- Log body **and eventName**: pi.session_start, pi.session_end, pi.run_start,
  pi.run_end, pi.llm_request, pi.tool_result. Correlation: session.id, pi.run.id,
  pi.request.id, tool.call.id, tool.parent_call.id, tool.name. timing.source is
  assistant_lifecycle / agent_lifecycle / tool_lifecycle / pi_tool_execute;
  pi.duration_ms is measured, and pi.lifecycle_duration_ms separately describes
  the tool lifecycle interval. No raw content/error inspection.
- Delta metrics: pi.session.count(start_type), pi.run.count(outcome),
  pi.run.duration(outcome; seconds), pi.token.usage(provider/model/type,
  source=assistant), pi.cost.usage(provider/model, source=assistant; USD),
  pi.tool.calls(tool.name/outcome), pi.tool.duration(tool.name/outcome; seconds).
  No per-operation/session IDs in metric dimensions.
- Opt-in traces: pi.agent_run root, pi.llm_request and pi.tool children;
  nested tools use actual parent IDs, unknown parents attach to run with an honest
  marker. Explicit log contexts correlate span IDs. Trace-off retains local IDs
  and accounting. No session root, retries, child-process or compaction spans.
- Error/aborted/incomplete outcomes are normalized without raw text. Interrupted
  or suppressed observations mark a previously successful run incomplete, rather
  than fabricating success. Unmatched completions are suppressed with known loss.
  Tool timing uses public event durationMs when available, not inferred zeros.
- One active run/assistant, at most1024 open tools. First8 model/provider pairs
  and16 tool names retain metric identity; excess aggregates under overflow with
  sticky known loss. SDK cardinality64; string128/attribute32 limits, no span
  events/links. Official queue=batch64; admission64 includes in-flight records,
  with no second queue. Logs/spans5s; metrics10s; RPC100ms/processors150ms.
- Shutdown is idempotent, allSettled providers concurrently then explicit retained
  public exporters shutdown even on provider rejection. No process.exit,
  Promise-race-only cleanup, forced success, or detached resource disposal.
  New/resume/fork/reload dispose old resources and reset local state/instance IDs.
- /otel-status is read-only: disabled/unverified/healthy/degraded, each active
  signal's last result, sticky known loss until replacement. ACK != persistence.
  At most one fixed degradation warning per activation, stderr only. No stdout.

## Actual validation performed

### Accepted uf4.2 boundary

`make format && make check && make test` passed in order, with real config unit
coverage and an installed-Pi offline isolated package loader. Strict TS supports
.ts source imports via allowImportingTsExtensions (noEmit check; no build added).

### Final current tree

Executed Make gates in order again:

- `make format`: **PASS**,25 files, no final fixes.
- `make check`: **BLOCKED/FAIL**, TypeScript cannot resolve protobufjs in the
  test receiver, plus two derived implicit parameter types because that module is
  absent. No production-source TypeScript errors were reported. A separate Knip
  run reports **only unlisted protobufjs**; unused test type exports were removed.
- `make test`: unit **1/1 PASS**; integration **5 passing tests in2 suites**, with
  **8 other suites import-blocked** by missing protobufjs. No skipped-suite or
  passWithNoTests workaround. These blocked suites are NOT acceptance evidence.
- Passing integration: installed-Pi loader; refused TCP; hung handshake; hung
  transport during1100 parallel tool-call load; hung transport during five
  startup/new/resume/fork/reload activations. Real public SDK/fake provider,
  isolated settings/credentials/workdir, no paid model calls. Every passing child
  naturally exited0, empty stdout, fixed expected stderr only, no extension errors,
  final awaited shutdown<1500ms. No timeout/forced-kill cleanup was needed.
- Tests have a guard that kills a stuck child only as failure cleanup; that path
  fails the clean-exit assertion. No process.exit is used to hide leaks.
- `pnpm pack --pack-destination /tmp/pi-otel-pack-validation`: **PASS**, rerun on
  final source/docs. Tar inspection **PASS**: package.json, README.md, four src
  files only. No tests, proto fixtures, plans, settings, credentials or lockfile.
  Owner files:[src] excludes CHANGELOG.md from tar (it exists in repository).
- **NOT run/accepted**: frozen install after dependency correction; isolated
  tarball installation/load; make test-package/CI. Do not invoke authored package
  scripts as a workaround for the known install prohibition.

## Blocker and minimum continuation

Despite the user's statement that package mutation was allowed, the current tool
harness rejected the combined dependency correction call **before execution**:

`pnpm remove -D @opentelemetry/otlp-transformer && pnpm add -D -E protobufjs@8.8.0`

> BLOCKED: package-mutation: package mutation blocked by active rule
> DO NOT attempt to work around this restriction!

No dependency removal/addition occurred, no lockfile was manually changed, no
transitive dependency import/copied installation/hoisting/custom decoder was used.
Parent was informed promptly and has requested the owner resolve the policy.
The installed transformer has official request **encoders**, not request decoders.
The receiver instead uses maintained protobufjs plus vendored official
opentelemetry-proto **v1.9.0** definitions/LICENSE (downloaded as test source).

After owner policy correction/installation, the minimum continuation is:

1. Declare/install direct protobufjs dev dependency, remove unused transformer and
   its temporary Knip ignore; preserve pnpm12.16.1 and regenerate the lock normally.
   Optionally add CHANGELOG.md to package files if it should ship.
2. Run format/check/test; **debug all decoded suites**, not just imports. They are
   authored, currently unexecuted: two-delta-interval attribution, actual tools
   (success/error/abort/nesting), trace parents/timings/log IDs/toggle parity,
   hostile environment/content/header refusal, state/cardinality/queue overflow,
   replacement/no replay, unsuccessful/unknown/malformed usage, sticky recovery.
   Runtime or test defects may remain; none is claimed proven by static typing.
3. The two-interval test deliberately produces a second real prompt/model change
   after the first metric ACK: SDK3 emits no empty delta request, so waiting for
   a second idle export would be an invalid test. Test inputs/known totals are
   independent of extension helpers; fake provider omits optional HTTP hooks.
4. Verify frozen install, run `make test-package` and inspect/load the isolated
   tarball under normal pnpm dependencies. Script uses offline local store,
   isolated HOME/agent directory and installed Pi; no global install.
5. Close uf4.3–uf4.7 sequentially **only after real acceptance**, update this
   handoff/plan and flush beads. Keep uf4.8 separate.

Other denied diagnostic calls (inline Node interpreter and explicit nested bash
syntax check) were not bypassed; those combined calls did not execute. Ordinary
Make gates were subsequently executed directly. No shell syntax-check success is
claimed for the package script.

## Boundaries kept

No live collector/database writes, paid calls, global installs, service restarts,
Fish/launchd/collector/viewer changes, push, publish, license decision or uf4.8
verification. No entire-task redelegation. Parent will independently review and
run gates once the decoder/install blocker is resolved.
