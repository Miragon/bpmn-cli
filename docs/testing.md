# Testing bpmn-cli

Six layers, from fast to thorough (plus the isomorphism check of the
browser-safe core, see [Isomorphism check](#isomorphism-check), the opt-in
Camunda 7 engine check, see [Engine checks](#engine-checks-camunda-7), the
opt-in Camunda 8 engine check, see
[Engine checks (Camunda 8)](#engine-checks-camunda-8), and the opt-in check
against design-iq's validator, see [design-iq](#design-iq-validator-check)):

| layer | what it catches | command | time |
| --- | --- | --- | --- |
| unit tests | behaviour of every op, the pipeline, the layout engines | `npx vitest run` | ~10 s |
| property test | invariant violations in short seeded edit sequences | `npx vitest run test/fuzz.test.ts` | ~5 s |
| layout regression | quality of the clean full-layout engine on tools/scenarios | `npm run layout:regress` | ~20 s |
| fuzzer | invariant violations in long random edit sequences, through the real CLI | `npm run fuzz` | 10 s – hours |
| benchmark | stability, quality, hard defects and semantic success of six typical edits, against a baseline | `npm run bench` | ~30 s per arm on the scenarios |
| roundtrip | how much of a file a no-op, a rename and an insert rewrite (byte-identical no-ops, changed lines, the replaced text region) | `npm run roundtrip` | ~10 s on the scenarios |

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
  format entries); reshaped connections that are not listed (`rerouted`, or
  `reshaped` since step 3) are a warning (`unreportedReroute`, audit bug #61);
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
   The drawing-quality kinds (`QUALITY_KEYS`: backwardFlow, segmentOverlap,
   labelOutsideFrame, messageLabelFar) weigh less than 6: soft, reported
   with the score but never counted as hard defects.

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

`test/step2-integration.test.ts` checks that the parts of step 2 work as one
pipeline: the in-memory API keeps the text (a no-op is the input string
itself, an insert gets ids in the file's style and changes only what it
touched, a full redraw keeps every DI start tag, a sticky keeps its text
when it follows its node), validators see the text-preserving result, the
design profile runs in memory with a content repository the host names, and
the file helpers find the repository of the file they write.
`test/views.test.ts` checks the reading views (`show --around`, `show <id>
--context`, lanes and message-flow names in `show`, message flows and
annotations in `show <id>`) on the synthetic `test/fixtures/views/claims.bpmn`
and holds a byte budget: on a generated 120-task model the neighbourhood
stays under 320 bytes per shown node and a tenth of `show`, and does not grow
with the model. `test/report-delta.test.ts` checks that a result lists only
the warnings a change added and resolved and counts the others (renames
followed, floods as one line, `--summary`); `test/cli-views.test.ts` the
same on the command line, plus compact JSON, stdin / stdout, `guide --short`
(<= 5 KB), every `guide <topic>`, `kinds --section` and the guide's CAMUNDA 8
recipe run command by command.
`test/step3-integration.test.ts` checks the step 3 packages together: an
`apply` batch that names everything by alias, with the selectors, the pool
order and `compact` taking aliases; an alias of a flow renamed after its new
ends followed into a format op, and `E_NOT_FOUND` naming the new id when a
later op uses the old one; `--summary` with aliases, renamed ids and one line
per format op; the event definition ids of a Camunda 8 file in the id style;
`show --around` / `--context` printing each zeebe setting once; the Camunda 8
profile in the warnings delta; and the strip of a removed node that must not
pull an expanded sub-process over a shape of another row (found by the gate's
fuzz campaign on the integrated build).
The verifier fixes of step 3 round 1: `test/views-context.test.ts` (`show
<id> --context` on a synthetic shop model: every boundary event of the
sub-processes around an element, the message of a message element with
the flows of that message drawn to its pool, a message flow's ends, what
uses a message / signal / error / escalation), `test/format-frames.test.ts`
(align / place with selector sets and explicit ids never take a shape out
of its sub-process, also on the two scenarios the fuzzer hit),
`test/move-lanes.test.ts` (a node moved into a flow between two lanes gets
add's lane when it has none, keeps its own otherwise and is drawn on a row
of it, like `add --lane`) and
`test/remove-join.test.ts` (a plain remove bridges a merge, refuses a
parallel / inclusive join).
`test/drawn-ids.test.ts` checks that a full redraw gives id-less elements
ids before drawing them, `test/node-files.test.ts` the encodings (a file is
read as it declares, a write is UTF-8 and says so), and the design profile
test the cases design-iq's validator decides differently from a plain BPMN
reading (its namespace check on the raw text, flows counted per id, every
collaboration, an attribute written twice).

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
  global: `applyToXml` (also with the design profile and a host validator,
  and a no-op that must come back `unchanged`), `layoutXml` (both engines),
  `newXml`, `validateXml` with the Camunda 7, the Camunda 8 and the design
  profile,
  `showXml`, `findXml` and `metricsXml` must give there exactly what they
  give in Node. It also checks that the inlined
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
  object, annotation, flow order) and 11 format generators (place variants,
  align, color, route, label, space (also closing space), tidy, lane order,
  compact, pool order, selectors: `color --path`, `align` / `color --kind`,
  `place --branch`). `--no-semantic` /
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

## Roundtrip fidelity

A write changes the text of the elements it changed and nothing else
(src/preserve.ts, src/mirror.ts; README "What a write changes"). Two checks
keep it that way:

- `test/roundtrip.test.ts` (part of `npx vitest run`): the synthetic
  fixtures in `test/fixtures/roundtrip/` (prolog, comments, CDATA, vendor
  attributes before typed ones, four-space indentation, `/>` without a
  space, a file without incoming / outgoing lists) with exact expected
  texts for a no-op, a rename, an insert, a condition, a retype, a removed
  element with a comment and a new namespace; and every fixture and
  scenario of the repository: a no-op is `unchanged`, a rename changes one
  line.
- `tools/roundtrip.mjs` measures a corpus in-process (dry runs, nothing is
  written): per file a no-op (`set <first named activity> name=<its
  name>`, layout auto and `--no-layout`), a rename (`--no-layout` and
  auto) and an insert after the first task with one outgoing flow. It
  prints the byte-identical no-ops (the others with their cause), the
  changed lines, and the share of the file that a host replacing one text
  region per save (design-iq's Y.Text `diffRegion`) rewrites, plus the
  notes about fall-backs and dropped comments.

```
npm run build
npm run roundtrip                                   # tools/scenarios + test/fixtures
node tools/roundtrip.mjs ~/corpora/hand --list      # a private corpus; --list names the non-identical no-ops
node tools/roundtrip.mjs --baseline <old>/dist/index.js ~/corpora/hand   # against another build
```

A no-op that is not byte-identical in layout auto comes from the layout,
not from the writer: a file without a diagram is drawn, and the incremental
layout completes missing DI (an edge, a shape, the plane's `bpmnElement`).
With `--no-layout` every no-op must be byte-identical; a `fall-backs` count
above zero means preserve.ts could not keep a file's text (the note says
why) and deserves a synthetic fixture.

## Speaking ids

`tools/speaking-ids.mjs` measures new ids on a corpus in-process (dry runs):
per file a named task, an unnamed gateway and an unnamed boundary event at
the first task with one outgoing flow. It prints the share of new ids that
speak (no Camunda Modeler hash, no number), the flows renamed because their
ids named their old ends, with `--baseline` the share that keeps the prefix
another build gives the same element, and how often two independent edits
of one file (two branches) share a new id (different names, the same name,
unnamed elements).

```
npm run build
node tools/speaking-ids.mjs                                   # tools/scenarios
node tools/speaking-ids.mjs --baseline <old>/dist/index.js ~/corpora/hand
```

The regression tests: `test/speaking-ids.test.ts` and
`test/conventions-ids.test.ts` (ids in every file style, renamed flows and
their DI), `test/batch-aliases.test.ts` (aliases in `apply`, on the command
line too), `test/not-found.test.ts` (the candidates of `E_NOT_FOUND`),
`test/remove-branch.test.ts` (`remove --with-branch` / `--bridge-all`) and
`test/lane-splice.test.ts` (the lane and the geometry of a node added into a
flow between two lanes).

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

## Engine checks (Camunda 8)

The Camunda 8 profile (`src/platform/c8.ts`) states for every rule what
Camunda 8.9 does; placement and known names come from the Zeebe descriptor
(`src/platform/zeebe.ts`, the inlined `zeebe-bpmn-moddle`; regenerate with
`node tools/gen-camunda-descriptor.mjs`, `test/isomorphic.test.ts` fails
while it is stale). `test/c8-profile.test.ts` holds one synthetic model per
rule (151 models) with the expected codes and Camunda 8's verdict, the timer
and FEEL value checks with the values they were checked on, and the
`validate` output; `test/c8-ops.test.ts` covers `set` / `ext` / `retype` /
`show` in Camunda 8 files and runs the profile's hints through the real CLI
until a refused model has no deploy finding left. By default they check the
CLI only. To re-check against a live Camunda 8 (REST v2, no
authentication), name its v2 root:

```
BPMN_C8_ENGINE=http://localhost:8088/v2 npx vitest run test/c8-profile.test.ts test/c8-ops.test.ts
```

Each model is deployed (`POST /v2/deployments`), the test asserts that the
profile reports a deploy-severity finding (or the structural error that
stands for it) exactly for the models Camunda 8 refuses, and every
deployment is deleted again (`POST /v2/resources/<key>/deletion`). The
runtime block starts processes and drives them (`/v2/process-instances`,
`/v2/jobs/activation`, `/v2/user-tasks`, `/v2/messages/publication`,
`/v2/incidents/search`): a job worker gets its type, input mapping and
headers, a message is correlated by its key, FEEL conditions route, a
called decision and a call activity return their results, a Camunda user
task is assigned and completed while a job worker user task is not listed,
a multi-instance runs per item, and each runtime rule misbehaves the way its
finding says (a flow without condition never taken, a condition out of a
task ignored, a standard loop run once, a JUEL completion condition and
non-numeric retries ending in an incident, camunda:* content and input
mappings on a start event ignored, `zeebe:publishMessage` not run). The
hint models of `c8-ops` are deployed after their hints were followed. With
Camunda 8.9.22: 332 / 332.

When you change how zeebe content is written, deploy the CLI-built models
and run them, and run the real-file battery on your private corpus (deploy
every file before and after each edit; compare every element's
`<bpmn:extensionElements>` text outside the edited element byte for byte).

## design-iq validator check

The design profile (`src/platform/design.ts`) mirrors the save gate of
Miragon's design-iq. `test/design-profile.test.ts` holds one synthetic model
per rule with design-iq's verdict (`designIq: 'pass' | 'fail'`, and the number
of its errors where it differs from the profile's); by default it checks the
profile only. To check the verdicts against design-iq's own validator, point
`BPMN_DESIGN_IQ_VALIDATOR` at `packages/validator/src/validate.ts` of a
design-iq checkout whose dependencies are installed (Node 22.6+ strips the
types; the test runs it in a child process and never imports it):

```
BPMN_DESIGN_IQ_VALIDATOR=<checkout>/packages/validator/src/validate.ts npx vitest run test/design-profile.test.ts
```

`test/validators.test.ts` covers the validator hook of the pipeline
(blocking, pre-existing errors through renames, warnings, context, failing
validators, the content-repository auto profile and the CLI output),
`test/decision-link.test.ts` the decision link (`calledDecision`) in design,
Camunda 7, Operaton and Camunda 8 files.

**On a private corpus.** Compare, per file, design-iq's `checkModel(xml, {
path })` errors with `checkFile(file, { profile: 'design' })` of
`@miragon/bpmn-cli/node` (or `validateXml(xml, { profile: 'design' })`; the
design profile's errors carry `validator: "design"`), file by file and finding by
finding (design-iq names the element in its message: `<id> is a dead end`,
`expected exactly one start event in process <id>`; it reports several start
events once per process, the profile once per start event). For the gate
itself, run edits through `mutateDoc(doc, ops, { profile: 'design' })` (or
`applyToXml`; neither writes) and check that a refused edit (E_VALIDATION with a `design`
finding) is exactly one whose output (written with `force: true`) has an
error design-iq did not report before. Keep the scripts and their output
outside the repository and report counts only.

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
