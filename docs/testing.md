# Testing bpmn-cli

Five layers, from fast to thorough (plus the isomorphism check of the
browser-safe core, see [Isomorphism check](#isomorphism-check), and the
opt-in Camunda 7 engine check, see [Engine checks](#engine-checks-camunda-7)):

| layer | what it catches | command | time |
| --- | --- | --- | --- |
| unit tests | behaviour of every op, the pipeline, the layout engines | `npx vitest run` | ~10 s |
| property test | invariant violations in short seeded edit sequences | `npx vitest run test/fuzz.test.ts` | ~5 s |
| layout regression | quality of the clean full-layout engine on tools/scenarios | `npm run layout:regress` | ~20 s |
| fuzzer | invariant violations in long random edit sequences, through the real CLI | `npm run fuzz` | 10 s – hours |
| benchmark | stability, quality, hard defects and semantic success of six typical edits, against a baseline | `npm run bench` | ~30 s per arm on the scenarios |

`npm run gate` runs the build, all unit tests (including the property test),
the isomorphism check, the layout-regression budget and a short fuzz campaign
(12 walks of 15 steps).
Run it before every change you hand over; it exits non-zero on the first
failing stage. The gate's fuzz campaign is strict on the robustness invariants
and reports new hard layout defects as warnings (`--hard warn`): while layout
bugs are open, a random campaign would hit them by chance. Layout quality is
gated deterministically by the property test's fixed walks, the regression
budget and `bench --compare`.

The audit that motivated this tooling is summarised in
[audit-2026-10.md](audit-2026-10.md).

## Invariants

The fuzzer and the property test check after every step
(`tools/fuzz/lib/walk.mjs`):

- **clean re-import**: the written file parses with plain bpmn-moddle and has
  no new import warning;
- **DI complete on the right plane**: every flow node, flow, data element,
  artifact, lane, pool and message flow has DI, on the plane it belongs to; no
  duplicate, dangling or stale DI; finite, positive sizes; at least 2 waypoints;
  no expanded sub-process or pool covering foreign shapes, no overlapping
  sibling frames;
- **no new hard layout defect**: no problem of a hard kind that was not there
  before the step (see *Metric kinds* below); problems involving a group are
  reported separately as warnings, because groups count as overlaps;
- **honest results**: the `layout.metrics` block of the result equals a
  standalone measurement, and its `added` list equals the measured difference;
- **no unreported moves**: in incremental and format-only steps every shape
  whose bounds changed is listed in the result (`placed`, `moved`, ... or the
  format entries); reshaped connections that are not listed are a warning
  (`unreportedReroute`, audit bug #61);
- **determinism**: every n-th step is run a second time on the same input and
  must give the same bytes;
- **failures stay clean**: no crash (internal error, signal, timeout), no
  usage error (that would be a malformed generated op), nothing written by a
  failed command.

Warnings (`group:*`, `unreportedReroute`, `bboxJump`, `drift`, and `hard:*`
with `--hard warn`) are reported but only fail with `--strict`.

## Metric kinds

The layout problems come from one library, `src/diagram/metrics.ts` (built to
`dist/diagram/metrics.js`). `tools/layout-regress.mjs` has its own copy of the
harness kinds; the library adds kinds the harness does not measure (for
example `frameIntrusion`, `frameOverlap`, `degenerateEdge`). The bench, the
fuzzer and the property test read the kinds from the library at run time, so a
kind added there shows up in every report without touching the tools. Which
kinds are **hard** (`tools/fuzz/lib/metric-kinds.mjs`):

1. env `BPMN_HARD_KINDS` (comma-separated), if set;
2. else a list the library exports as `HARD_KEYS` (or `HARD_KINDS`);
3. else every kind with weight >= 6 except `failed`. For the harness kinds
   this is overlaps, through, missing, outsideLane, outsidePool and
   outsideSub; the frame and degenerate-edge kinds weigh 10 and are hard too.

Give a new kind a weight of 6 or more when it is a defect that must never be
introduced (or export `HARD_KEYS`).

## Unit tests and the property test

```
npx vitest run                       # everything
npx vitest run test/fuzz.test.ts     # the property test only
npm run typecheck
```

`test/fuzz.test.ts` runs about twenty fixed walks of 15 steps in-process on the
library (no build needed): the synthetic fixtures in `test/fixtures/` and a few
scenarios. A failure message names the step, the op and the violation, e.g.
`step 10 align: hard:overlaps Task_B,Task_C`. Reproduce and shrink it with the
fuzzer (after `npm run build`):

```
node tools/fuzz/walk.mjs test/fixtures/incremental/orders.bpmn --seed 11 --mode incremental --steps 12 --exec lib --out /tmp/w
node tools/fuzz/minimize.mjs /tmp/w
```

The `KNOWN` list in the test holds walks that currently hit open audit bugs;
they are marked `it.fails`. When a fix makes one of them pass, vitest reports
"expected to fail" for it: move it into `WALKS`. The last block plants defects
into otherwise good results (an unreported move, a missing shape, an overlap,
nondeterministic bytes, a crash) and checks that the oracles notice them.

Every fixture must be synthetic. To keep a defect found on a private model,
rebuild a minimal model that shows it (the minimiser's repro tells you which
ops matter) and add that.

## Isomorphism check

The package's main entry (`src/index.ts`, published as `@miragon/bpmn-cli`)
must run in a browser; only `src/node/` (`@miragon/bpmn-cli/node`) and
`src/cli.ts` may touch files, `process` or other Node builtins.

```
npm run build && npm run check:iso     # node tools/iso/check.mjs [--json]
npx vitest run test/isomorphic.test.ts
```

- `tools/iso/check.mjs` (part of the gate) bundles `dist/index.js` with
  esbuild for `platform=browser` and fails on an import of a Node builtin or a
  free reference to `process`, `Buffer`, `global`, `require`, `__dirname`,
  `__filename`, `setImmediate` / `clearImmediate`, naming the module
  (`tools/iso/bundle.mjs`: the globals are replaced through esbuild's `define`,
  which leaves local variables and properties of that name alone). It also
  fails when the bundle contains `dist/node/` or `dist/cli.js`, when the
  package `exports` do not resolve, or when a strict TypeScript consumer
  (`skipLibCheck: false`, no `@types/node`, lib ES2022) of both entries does
  not compile. It prints the minified and gzipped sizes, split like a host's
  bundler would split them.
- `test/isomorphic.test.ts` bundles `src/index.ts` the same way (no build
  needed), checks that the check sees a planted `node:fs` import and
  `process` read, and runs the bundle in a `vm` context without any Node
  global: `applyToXml`, `layoutXml` (both engines), `newXml`, `validateXml`
  with the Camunda 7 profile, `showXml`, `findXml` and `metricsXml` must give
  there exactly what they give in Node. It also checks that the inlined
  Camunda 7 descriptor (`src/platform/camunda-descriptor.ts`) equals the
  installed `camunda-bpmn-moddle`; regenerate it with
  `node tools/gen-camunda-descriptor.mjs`.
- `test/api.test.ts` checks that the in-memory API gives what the CLI writes
  and prints for the same input.

When the check fails, move the Node-only code into `src/node/` (or behind an
option, like the layout debug lines: `setLayoutDebug`, which the CLI maps to
`BPMN_LAYOUT_DEBUG`).

## Layout regression

```
npm run build
npm run layout:regress                              # FILES n  SCORE s
node tools/layout-regress.mjs --save /tmp/base.json # before a change
node tools/layout-regress.mjs --compare /tmp/base.json --verbose
node tools/bench/regress-gate.mjs                   # fails when SCORE > budget
```

The budget is `maxScore` in `tools/bench/regress-budget.json` (env
`LAYOUT_REGRESS_MAX` overrides it). Lower it when the engine improves; raise it
only for a reviewed reason, such as new scenarios or new metric kinds.

## Fuzzer

```
npm run build
npm run fuzz                                         # 24 walks x 30 steps, default corpus
node tools/fuzz/run.mjs --walks 200 --steps 60 --jobs 8 --modes auto,incremental --minimize
node tools/fuzz/walk.mjs <model.bpmn> --seed 7 --mode incremental --steps 40 --save-steps
node tools/fuzz/minimize.mjs tools/fuzz/out/latest/walks/<walk> [--kind 'hard:overlaps']
```

- **Corpus**: `test/fixtures` and `tools/scenarios`, plus the directories in
  env `BPMN_FUZZ_CORPUS` (colon-separated), or exactly `--corpus dir[:dir]`.
- **Seeds**: walk i of a campaign uses a seed derived from `--seed` and i, and
  a model and mode chosen from the shuffled corpus, so the same arguments give
  the same walks. A walk's own seed is printed with its directory name.
- **Generators**: 18 semantic (add after / into a flow / as a branch,
  boundary event with handler, connect, remove, move, lane move, retype,
  rename, split, sub-process with content, expand / collapse, lane, data
  object, annotation, flow order) and 8 format generators (place variants,
  align, color, route, label, space, tidy, lane order). `--no-semantic` /
  `--no-format` switch groups off.
- **Executors**: by default each step runs through the built CLI (`bin/bpmn.js`,
  env `BPMN_BIN` for another build) as the equivalent single command, or as
  `apply` for multi-op steps (`--via apply` always uses apply). `--exec lib`
  runs the built library in-process, several times faster; both give
  byte-identical files. The oracles always use this repository's `dist/`.
- **Output** (git-ignored): `tools/fuzz/out/latest/report.json` and one
  directory per walk with `summary.json`, `steps.json` (replayable with
  `walk.mjs --replay`), `log.jsonl` and, with `--save-steps`, every written
  step file.
- **Minimisation**: ddmin over the steps of a walk until the violation still
  occurs with as few steps as possible; writes `min-<kind>/run.sh` (plain CLI
  calls on a copy of `start.bpmn`), `steps.json` and `min.json`. With
  `run.mjs --minimize` this happens for the first walk of every error kind.
  A repro of a private model contains that model: never commit or share it,
  rebuild it synthetically.

Exit codes: 0 no error-severity violation, 1 violations, 2 bad arguments.

**Regression or old bug?** Run the same campaign (same `--seed`, corpus and
modes) against the previous build with `BPMN_BIN=<old>/bin/bpmn.js`; the
oracles stay this repository's, so both runs are measured alike. For a single
finding, replay the walk up to that step (`walk.mjs <model> --seed <s> --mode
<m> --replay <walk>/steps.json --steps <n+1> --save-steps --exec lib`) and run
the op of step n on the last saved step file with both builds: a defect both
builds add is an open bug, not a regression.

## Benchmark

```
npm run build
npm run bench                                   # arm new, tools/scenarios -> tools/bench/results/latest
npm run bench:summary                           # markdown tables of the latest results
node tools/bench/run.mjs --layout incremental --track edits --filter agent__ --jobs 8
node tools/bench/run.mjs --engine               # add the scenarios redrawn by the engine (engine-owned drawings)
node tools/bench/run.mjs --print                # show each arm's commands, run nothing
tools/bench/render.sh /tmp/png tools/bench/results/latest/work/edits/new-auto/scenarios/agent__claim/*/model.bpmn
```

**Edits.** For every model `tools/bench/gen-edits.mjs` picks targets near the
middle of the longest start-to-end path: E1 insert a user task, E2 a new branch
at an exclusive gateway, E3 remove a task (bridged), E4 a boundary path (timer
boundary plus end event), E5 move a task to the neighbouring lane, E6 a long
rename, E7 all applicable edits one after the other. The global track runs the
arm's full layout variants on the unedited model.

**Arms.**

| arm | what | how to enable |
| --- | --- | --- |
| `new` | this repository's `bin/bpmn.js` | always |
| `baseline` | another bpmn-cli build, e.g. the last release | `BASELINE_BIN=/path/to/other/bin/bpmn.js` |
| `pr` | the PR #218 tool of Miragon/design-iq (`@bpmiq/bpmn-edit`) | `BPMN_EDIT_MAIN=/path/to/checkout/packages/bpmn-edit/src/main.ts` |

With `BPMN_EDIT_MAIN` set the records also carry the PR tool's own layout
score for every arm. CLI options are feature-detected, so an older build
without `--layout` still runs as a baseline.

**Measures per run** (one JSON line in `<out>/<track>-<arm>.jsonl`):

- *ok* (exit 0; refused runs with E_IMPORT_LOSSY / E_VALIDATION are repeated
  with `--force` as a separate record) and *semantic* (the intended change is
  in the file);
- *stability*: centre displacement of the flow nodes that existed before, raw
  and after removing the median translation; share of nodes moved > 5 px;
- *harness score*: the metrics library's score before / after (the
  layout-regress score), with counts of every kind the library knows;
- *hard defects added*: hard problems the run introduced, groups excluded;
- *PR score* (only with `BPMN_EDIT_MAIN`);
- *validity*: import warnings, flow nodes without DI, edges without waypoints.

`<out>/meta.json` records the arms, the corpus sizes, the metric kinds and the
hard kinds of the run. A run rewrites the result files of the arms it runs;
`--resume` keeps the records already there and runs only the missing ones (for
a long private-corpus run that was interrupted). Result files of arms not run
this time stay, so use a separate `--out` per experiment.

**Comparing two runs.** Keep a results directory of the code before your change
and compare:

```
git stash; npm run build; node tools/bench/run.mjs --out tools/bench/results/base; git stash pop
npm run build
node tools/bench/run.mjs --compare tools/bench/results/base       # runs, then compares
node tools/bench/run.mjs --no-run --compare tools/bench/results/base   # compare existing results
```

The comparison prints per edit type the semantic failures, the runs adding
hard defects, the hard defects added, the mean harness delta and the median
share of moved nodes (old -> new), the global hard counts, and every run that
got worse or better. It exits 1 when semantic failures, runs adding hard
defects, hard defects added or global hard counts increased. Only hard kinds
known to both runs are compared, so a newly added metric kind is not a
regression of the code. With `--engine`, set `BASELINE_BIN` so that both runs
draw the engine corpus with the same CLI.

## Engine checks (Camunda 7)

The Camunda 7 profile of `bpmn validate` (`src/platform/c7.ts`) states for
every rule what the engines do. `test/c7-profile.test.ts` holds one synthetic
model per rule (82 models) with the expected codes and the engine verdict;
by default it checks only the profile. To re-check the verdicts against live
engines (REST, no authentication), list their REST roots:

```
BPMN_C7_ENGINES=http://localhost:8080/engine-rest[,http://host:port/engine-rest ...] npx vitest run test/c7-profile.test.ts
```

Each model is deployed to every listed engine, the test asserts the engine's
verdict and that a deploy-severity finding (`W_C7_DEPLOY_*`) is reported
exactly for the refused ones, and every deployment is deleted again. The
verdicts were identical on Camunda 7.24.0, CIB seven 2.2.0 and Operaton 2.1.5
(341 tests with three engines). The follow-up rounds add their own models with
engine verdicts the same way: `test/c7-followups-profile.test.ts` (deploy
rules the engines disagreed with or the profile missed; `operaton` marks a
verdict only Operaton gives, the engine is told apart by
`/telemetry/data`), `test/c7-followups-integration.test.ts` (events with
several event definitions, attributes BPMN does not define) and
`test/c7-followups-verify.test.ts` (schema rules on every event definition,
start events of transactions / empty sub-processes / ad-hoc sub-processes;
`run` also starts the process and checks that it fails or runs, and the
second-start hint is followed and run). Run all four with the same
`BPMN_C7_ENGINES`; `--no-file-parallelism` keeps two files from deploying
one message name at the same time.

The other C7 regression tests (`test/c7-semantic.test.ts`,
`test/c7-ext-structure.test.ts`, `test/c7-integration.test.ts`,
`test/c7-followups-ops.test.ts`) run without engines; their engine evidence (deploy and run the CLI-built models, real
customer files before and after edits) was collected outside the repository,
see [audit-2026-10.md](audit-2026-10.md#camunda-7-audit-2026-10-09). When you
change how vendor content is written, build a small model with the CLI, deploy
it to a Camunda 7 compatible engine and run it (start, fetch-and-lock /
complete, correlate), and run the real-file battery on your private corpus:
deploy every file before and after each edit and compare the camunda content
element by element.

## Private corpora

Real models from customers or other private sources never go into this
repository: not as fixtures, not in test names, not in docs. Plug them in from
outside:

```
export BPMN_BENCH_CORPUS="hand=$HOME/corpora/hand:$HOME/corpora/large"   # name=dir or dir
export BPMN_FUZZ_CORPUS="$HOME/corpora/hand:$HOME/corpora/large"
npm run bench
node tools/fuzz/run.mjs --walks 300 --steps 50 --jobs 8 --minimize
```

- Results, work files and fuzz output land in `tools/bench/results/` and
  `tools/fuzz/out/`, which are git-ignored. They contain the private models;
  delete them when done and do not attach them to issues.
- Corpus names appear in the results; choose neutral names (`hand`, `large`).
- To keep a finding, reduce it with the minimiser and rebuild the few
  elements it needs as a synthetic fixture under `test/fixtures/`.
- `test/repo-hygiene.test.ts` fails when a file in the repository names a
  local home, temporary or scratch directory, or contains control characters
  (a raw NUL makes git treat a file as binary).

## Looking at the result

The metrics do not see everything (labels, aesthetics, groups). Render what
you touched with real bpmn-js:

```
tools/render.sh /tmp/png file1.bpmn file2.bpmn            # any files
tools/bench/render.sh /tmp/png tools/bench/results/latest/work/edits/<arm>/<corpus>/<model>/*/model.bpmn
```

Both need Google Chrome (`PUPPETEER_EXECUTABLE_PATH` overrides the macOS
default path) and fetch `bpmn-to-image` with npx.
