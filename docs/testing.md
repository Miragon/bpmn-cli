# Testing bpmn-cli

Six layers, from fast to thorough (plus the isomorphism check of the
browser-safe core, see [Isomorphism check](#isomorphism-check), the opt-in
Camunda 7 engine check, see [Engine checks](#engine-checks-camunda-7), the
opt-in Camunda 8 engine check, see
[Engine checks (Camunda 8)](#engine-checks-camunda-8)):

| layer | what it catches | command | time |
| --- | --- | --- | --- |
| unit tests | behaviour of every op, the pipeline, the layout engines | `npx vitest run` | ~10 s |
| property test | invariant violations in short seeded edit sequences | `npx vitest run test/fuzz.test.ts` | ~5 s |
| layout regression | quality of the clean full-layout engine on tools/scenarios | `npm run layout:regress` | ~20 s |
| fuzzer | invariant violations in long random edit sequences, through the real CLI | `npm run fuzz` | 10 s to hours |
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

None of the layers depends on the shell's `BPMN_KEEP_FLOW_IDS`: the unit
tests clear it before every file (`test/setup.ts`), so the CLIs they spawn
rename flows as by default, and the fuzzer, the benchmark, the layout
regression and the demo run the CLI without it (`CLI_ENV` in
`tools/fuzz/lib/setup.mjs`). A test that needs it sets it for its own spawn.

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
  reported separately as warnings (a group is no leaf shape for the metrics,
  so they are rare, e.g. a group outside its pool);
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
  failed command;
- **the result renders** (the fuzzer, not the property test; `--no-render`
  skips it): every written step is drawn like `bpmn render --problems
  --tiles` as PNG (`renderPng` of `dist/node`); a throw (`E_RENDER`, a wasm
  trap, a crash), an image over 2000 px or another number of listed problems
  than the metrics have is a `render` error.

Warnings (`group:*`, `unreportedReroute`, `bboxJump`, `drift`, and `hard:*`
with `--hard warn`) are reported but only fail with `--strict`.

## Metric kinds

The layout problems come from one library, `src/domain/diagram/di/LayoutAnalysis.ts` (built into
`dist/index.js`). `tools/layout-regress.mjs` has its own copy of the
harness kinds; the library adds kinds the harness does not measure (for
example `frameIntrusion`, `frameOverlap`, `degenerateEdge`, `detachedEdge`). The bench, the
fuzzer and the property test read the kinds from the library at run time, so a
kind added there shows up in every report without touching the tools. Which
kinds are **hard** (`tools/fuzz/lib/metric-kinds.mjs`):

1. env `BPMN_HARD_KINDS` (comma-separated), if set;
2. else a list the library exports as `HARD_KEYS` (or `HARD_KINDS`);
3. else every kind with weight >= 6 except `failed`. For the harness kinds
   this is overlaps, through, missing, outsideLane, outsidePool and
   outsideSub; the frame, degenerate-edge and detached-edge kinds weigh 10
   and are hard too.
   The drawing-quality kinds (`QUALITY_KEYS`: backwardFlow, segmentOverlap,
   labelOutsideFrame, labelOnTitle, messageLabelFar) weigh less than 6:
   soft, reported with the score but never counted as hard defects.

Leaf shapes (`overlaps`, `through`, a label on a shape) are every shape but
pools, lanes, expanded sub-processes and groups, in the library and the
harness alike: a group box is drawn around its members.

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

`test/bpmnlint.test.ts` checks the project's bpmnlint configuration (issue
#33) with the real bpmnlint and @miragon/bpmnlint-plugin-rules, offline:
each case writes a repository of its own into a temporary directory (a
`.git` directory, a `.bpmnlintrc`, models, and a `node_modules` with
project plugins where the case needs them), except the cases about a model
outside a repository; the cases about a `.git` of another user (a
directory, a link to `/`, a hard link to a gitfile or to `/etc/hosts` where
the system allows one; the `.bpmnlintrc` applies, the plugin must not run)
mock the uid (skipped as root and on Windows), and the case of a system
without uids (Windows: only a repository inside the home directory runs
plugins) mocks `process.getuid` away and sets `HOME`. Its CLI cases build
`src/` with tsc into a temporary directory and run it under plain node,
which loads bpmnlint and the plugin as the published package does
(vitest's module loader would hide a load failure); they also run as root
over the tester's checkout (a `--require` preload makes
`process.getuid()` 0), build a broken install and a project whose own
bpmnlint is hoisted next to the plugin, close the pipe after the first
chunk (the exit code stays, no `EPIPE` trace), load a plugin that leaves a
timer running (the command still ends) and run from a removed working
directory. A `.bpmnlintrc` above the
temporary directory or the repository would run bpmnlint in every CLI test:
`test/global-setup.ts` (vitest's globalSetup) stops the run and names it.
The fuzzer, the benchmark and the layout regression pass
`--no-lint-config`.
The id conventions of a `.bpmnlintrc` (#34): `test/conventions-lint.test.ts`
lints every id bpmn-cli generates under several `element-id-naming` settings
(the bare flag, PascalCase with `Flow_`, snake_case with the qualifier
required, exact prefixes for pools, lanes, messages and the process, prefixes
without a separator, case any) with the real rule, in a new file and in files
of six other id styles (also elements a batch creates and then retypes or
gives another trigger, with the flows named after them, a split's join, the
join after an explicit split id in another case), and expects no finding (a
control without conventions has them); it also checks how
`idConventionsFromLint` reads the options and the `W_CONFIG_IGNORED` notes.
`test/conventions-declared.test.ts` checks the style around them (the rest of
a file stable over many writes and learned from its own ids that do not
follow the rule, single words (also under PascalCase), the kind word, glued
suffixes and joins, also after an explicit split id, message flows and
the processes of new pools over many writes and after the file's own
process ids where two share a prefix, flows renamed into the declared
form, `W_ID_PREFIX_STALE` alone and in a batch (also for a type the rule
switched off, and the id of what the element is now for an id that did not
pass the rule), the new id of an element the batch created and of the flows
named after it (also in the entries of an op before its retype), an id
freed and then claimed explicitly, the `conventions`
of a result (none in a new file or one that follows the rule), the view of
`show --conventions` with its reasons).
`test/bpmnlint.test.ts` checks the lookup, the notes in validate and writes
(also the one for a prefix declared for a DI type),
`show --conventions` and `new` on the command line (its own errors before
the `.bpmnlintrc`'s), and that a `.bpmnlintrc` without the rule, or
with it off, writes every fixture byte for byte as without one.

`test/step2-integration.test.ts` checks that the parts of step 2 work as one
pipeline: the in-memory API keeps the text (a no-op is the input string
itself, an insert gets ids in the file's style and changes only what it
touched, a full redraw keeps every DI start tag, a sticky keeps its text
when it follows its node), validators see the text-preserving result, a
host validator runs in memory (a write that adds its error is refused,
`validateXml` reports every finding), and the validators see the file a
helper writes (the `--out` target) or checks, unless `file` names another.
`test/validators.test.ts` covers the validator hook of the pipeline
(blocking, pre-existing errors through renames, findings counted one by one,
a warning matched by its `key`, `covers`, the context, failing validators,
the check of `validate`, and the CLI, which takes no host validators: a
refusal lists the structural errors under its message, and `validate` exits
with 2 on an error; a structural refusal (a black-box pool added to a file
without pools) lists its errors and writes nothing, `validate` on the
unchanged file shows none of them, the `E_VALIDATION` advice (the
catalogue fix, the `guide --short` line, the plugin skill's row) does not
send the reader to `bpmn validate`, and the guide's JSON error shape lists
the `errors` that advice points to),
`test/decision-link.test.ts` the decision link (`calledDecision`) in models
without an engine (the unprefixed attribute; with `platform: 'none'` the
spelling of the task's link or of the file's other links kept), Camunda 7,
Operaton and Camunda 8 files.
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
The round 1 verifier's findings, each with a test that fails on round 1:
`test/step3-ids-report.test.ts` (ids and the report: flows at unnamed
gateways named by their speaking ids (no `_2`), unnamed elements in a row
(the nearest named anchor once; where the prefix says the kind, `Task_`,
`task_`, the anchor's kind where an id would repeat the anchor's,
`Task_AfterCheckGateway`; flow ends that begin alike keep their last word
when cut), the 64-character cap (no cut below it beyond a name's 40
characters, whole words, the cut with the most words and then the most
characters, each id's prefix in a flow named by its ends' ids, fitPair's
tail and first-word rules, no end shrunk to a number or a bare Join, no id
ending on a number that reads like a suffix (`Phase1To...` kept), a cut
inside a word that keeps the numbers, a camelCase end without its first
word, a suffix within the cap, none skipped, also on an id that names the
anchor's kind, a file prefix or scope too long for the cap in every flow
form, cut flows voting for their form, flows 0.6 cut still following their
ends, also with `_100` and a leading separator, ends of any length cut
fast: #31),
transliteration beyond German, the definitions id of `new`, and the warnings
delta: platform findings counted, a shrinking `W_DUPLICATE_NAME`, a bridge
that takes over a removed flow's id, warnings of a batch's final state, `new`
with the platform's findings),
`test/step3-c8-fixes.test.ts` (Camunda 8, see "Engine checks (Camunda 8)"),
`test/views-context.test.ts` (`show <id> --context` on a synthetic shop
model: every boundary event of the sub-processes around an element, the
message of a message element with the flows of that message drawn to its
pool, a message flow's ends, what uses a message / signal / error /
escalation), `test/format-frames.test.ts` (align / place with selector sets
and explicit ids never take a shape out of its sub-process, also on the two
scenarios the fuzzer hit), `test/move-lanes.test.ts` (a node moved into a
flow between two lanes gets add's lane when it has none, keeps its own
otherwise and is drawn on a row of it, like `add --lane`) and
`test/remove-join.test.ts` (a plain remove bridges a merge, refuses a
parallel / inclusive join); `test/step3-fixes-integration.test.ts` checks the
fixes together (the message of `refAs` and speaking ids in `--summary`,
created elements not also listed as changed, the subscription redirect in the
warnings delta, a plain remove of a merge and `move` into a cross-lane flow
renaming flows after their new ends).
`test/drawn-ids.test.ts` checks that a full redraw gives id-less elements
ids before drawing them, and that an op giving a sequence flow without id
other ends gives it one from them, and `test/node-files.test.ts` the encodings (a file
is read as it declares, a write is UTF-8 and says so).
`test/layout-batch-parity.test.ts` checks issue #18, stage A, on the
synthetic hand-drawn model of the plugin eval `edit-hand-drawn-model`: the
agent's batches (decision + "no" to the existing node, decision + a new "no"
branch, `split`, a merge gateway; each with and without the timer reminder
path) give the same shapes as the same ops sent as single commands and add no
backward flow (without the reminder path no problem at all); a task and a
decision stay in the row, an exception path waits for the normal flow even when
its ops come first; a `connect` into a merge that would enter it backwards
moves the merge, a loop return does not; `place --side top|bottom` takes the
reminder path below the approval and back above it with score 0, makes the
room above a task in the top lane of a pool inside that lane, and its
refusals;
`E_NO_ROOM` of both eval refusals (`test/fixtures/layout-batch/`: the drawings
0.5.0 left after the agents' batches) carries a command that, run first, lets
the place succeed (library and command line, the file filled in), and names
the shapes to move without one; the bench edits E8 / E9 and the soft budget of
`bench --compare`. Its last block holds the findings of the stage A
verification, each failing on the stage A build: splices into two branches
of one gateway in one batch (a task and a merge, two tasks, the merge
batch, the merge added first; on the eval model and in a pool with lanes)
give the shapes and the score of single commands; `place --side` top and
back to the bottom in pools with lanes (`tools/scenarios`: a node of
another lane is no part of the path), back to a border two other boundary
events take (over its corner), into a lane with a lane underneath (the lane
grows at its bottom), and next to an annotation on a flow the move
reroutes (no `through`); `E_NO_ROOM` names the space-tool run with the
fewest layout problems, and after other ops of a batch only the batch op
(no command for the file).
`test/layout-room-making.test.ts` checks issue #18, stage B, on synthetic
hand-drawn models (`test/fixtures/layout-room/`), the eval's model and a
public scenario: a boundary path above a line from an earlier boundary event
opens the row below its host (the line and its end move down), a decision
spliced into a branch with a bypass right under it puts its new "no" branch
above the row, single commands and the batch alike and without a crossing;
every eval batch plus the reminder path scores 0, the reminder path that
crossed the "no" flow goes above the approval on its own; a branch row in a
transaction keeps clear of the transaction's cancel event (audit #63); the
local repair routes an existing line a new flow crosses again (reported in
`rerouted` and a note), and starts a chain that still crosses at its next
row candidate (`agent__o2c`), deterministically. Its later blocks hold the
findings of the stage B verification, each failing on the stage B build: a
path added to a boundary event on its host's top border (`place --side
top`, then the reminder; and a batch with a second path connected later)
runs above the host and leaves the hand-drawn row where it is; a line
through the top-border spot keeps the event below (the line unbroken, no
crossing); a boundary event drawn by hand keeps its border, one a command
placed goes to the top; a line a new end event would sit on is routed
around it; a repair reroute that would trade a crossing with a new flow for
one between two drawn lines is undone (`shared-reject-line.bpmn`); a
reroute that still crosses is not measured (the `debug` sink); and an
association a splice breaks is routed again before the next op of the
batch (fails when `routeNow` skips associations again).
`test/render.test.ts` checks `bpmn render` (issue #12, stage 1): every file
of `tools/scenarios` and `test/fixtures` (and each of its other planes)
renders to SVG and PNG within the default 2000 px, with the same bytes twice
(the PNG of every tenth file twice); the PNG has text pixels with the bundled
font only; a rasteriser failure (a 488-byte SVG that makes resvg trap, and
malformed SVG) is `E_RENDER` and the next render still works; external
labels sit where bpmn-js puts them (DI label bounds, below the shape, above
the middle of a flow; 11 px, laid out twice like bpmn-js 18); colours are drawn and unsafe colour
values are not; the planes and the elements without a shape are named; the
budget note; a file without a diagram is laid out in memory; the renderer is
not in an `applyToXml`-only bundle; and the command (`-o`, the temp default,
`-o -`, `--json`, `--plane`, the usage errors). The synthetic
`test/fixtures/render/gallery.bpmn` has every element kind the renderer
draws (built with the CLI, then a group and multiple events added by hand).
`test/render-agent.test.ts` checks the agent features (stage 2): every layout
problem of every scenario and fixture located inside the bounding box of its
elements on its plane (`locateProblems`; `layoutProblems` unchanged);
`--problems` listing every metrics problem in its order with the same ids,
every badge inside its elements and badges apart; `--around` drawing exactly
the nodes of `show --around` for every 4th node of every scenario, and the
median depth-2 crop of every node within 1,000 image tokens; `--path`,
`--scope`, ids, the crop's plane and the notes for other planes, the usage
and lookup errors; halos and `changeHighlight`; tiles cut between the
columns (every column in one tile, bands for a tall drawing, PNG per tile);
the focus region; the command flags, `--tiles` file names, `--render` on
mutating commands (text, JSON, the region of a large drawing, a failed render
that leaves the change standing); and the fuzz walk's render oracle. The
synthetic `test/fixtures/render/long.bpmn` (28 nodes in a row, 3,940 px
wide, built with the CLI) is the tiles and focus model.
`test/render-fixes.test.ts` checks the fixes after the verification of
issue #12 on synthetic models: broken or far-flung coordinates (NaN,
1e308, Infinity, 1e9, a negative size, far label bounds) are left out with a
note and never give `width="NaN"`, an all-broken plane is `E_RENDER`;
`--tiles` keeps only tiles with a shape or label (2 tiles for two shapes
50,000 px apart with an unnamed flow, not 676), stays one image beyond `MAX_TILES` (40) and
finishes quickly on shapes spread over ±1,000,000 px at `--max-size 50`,
numbers the bands it keeps; a scale in a note is rounded down; external
labels break like bpmn-js 18 (max(90, label width), then the widest line);
a message flow's envelope and message name; a file without a diagram lists
the `metrics` problems of the file; `-o x.jpg` is `E_USAGE` (with
`--format png` it is written); a `--scope` on an empty plane is
`E_NO_MATCH`.
`test/plugin.test.ts` checks the Claude Code plugin; for the look step
(stage 3) the render example of `SKILL.md` runs on the recipes' model and
writes a real PNG within 2000 px into `.bpmn-render/`, every render the
skill shows writes there (not to the CLI's default in the temporary
directory, outside the working directory), and the layout graders of the
eval case `tidy-after-edit` agree with `bpmn metrics --json` on its
fixture, the reference solution and seven other states of the file (one of
them the layout the agents of the first eval run ended with). The test bundles the CLI into a temporary
directory, with links to `assets/` and `node_modules/` beside it, so the
bundle finds the font and `@resvg/resvg-wasm`.

## Isomorphism check

The package's main entry (`src/index.ts`, published as `@miragon/bpmn-cli`)
must run in a browser; only the adapters (`src/adapters/`), the node entry
(`src/node.ts`, `@miragon/bpmn-cli/node`) and the CLI (`src/cli.ts`) may touch files,
`process` or other Node builtins.

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
  fails when the bundle contains `dist/node/`, `dist/commands/` or `dist/cli.js`, when the
  package `exports` do not resolve, or when a strict TypeScript consumer
  (`skipLibCheck: false`, no `@types/node`, lib ES2022) of both entries does
  not compile. It prints the minified and gzipped sizes, split like a host's
  bundler would split them: the initial chunks of the whole entry and of an
  `applyToXml`-only entry, and the chunks loaded on demand (the Camunda 7
  rules, the Camunda 8 rules with the FEEL, timer and schema-text checks,
  bpmn-auto-layout). It fails when a rule module
  (`dist/platform/profiles/`: the profiles, their base, utils and checks) is in the initial chunks of
  either entry, naming it; when a rule module imports a module the entry
  loads, naming both (Rollup / Vite would put that module into the host's
  entry chunk and make the rule chunk import the entry chunk back: a host
  whose entry module awaits a Camunda 7 / 8 call at top level would hang;
  the rules get the core helpers from `src/domain/validation/profiles/rule-kit.ts`); and
  when a size is over its budget in
  `tools/iso/budget.json` (KB = 1024 bytes; set to the measured size plus
  about 2 %: raise one only in the change that needs it, with the reason in
  the commit). `--table` prints the "Browser bundles" table of [library.md](library.md#browser-bundles). The
  entry chunk is the output whose metafile `entryPoint` is the requested
  entry (esbuild gives every `import()` target an `entryPoint` too).
  esbuild itself never shows the hang (it puts shared modules into chunks
  of their own); the check models what Rollup does, and the Vite run in
  HANDOVER.md ("Profile rules on demand") proved it in Chrome.
- `test/isomorphic.test.ts` bundles `src/index.ts` the same way (no build
  needed), checks that the check sees a planted `node:fs` import and
  `process` read, and runs the bundle in a `vm` context without any Node
  global: `applyToXml` (also with host validators, and a no-op that must
  come back `unchanged`), `layoutXml` (both engines), `newXml`,
  `validateXml` with the Camunda 7 and the Camunda 8 profile and with host
  validators, `showXml`, `findXml` and `metricsXml` must give there exactly what they
  give in Node, and `renderSvg` the same SVG. It also checks that the inlined
  Camunda 7 descriptor (`src/domain/document/vendor/camunda-descriptor.ts`) equals the
  installed `camunda-bpmn-moddle`; regenerate it with
  `node tools/gen-camunda-descriptor.mjs`.
- The same file bundles `src/index.ts` as an ESM split bundle (what Vite or
  esbuild make of the `import()` in `src/domain/validation/profiles/PlatformProfiles.ts`), writes a
  fresh copy per case, loads it with Node's own loader and records which
  chunk is evaluated: a plain model (also with a host validator, whose error, pre-existing
  error and covered lint warning come out like Node's) and
  `platform: 'none'` load no profile chunk, a Camunda 7 file only the Camunda 7 rules, a
  Camunda 8 file only the Camunda 8 rules; a batch that turns a plain file
  into a Camunda 7 / 8 file loads them after the ops and reports the added
  findings of 0.4.0; `runProfile` without loaded rules throws
  `E_PROFILE_NOT_LOADED`; a missing chunk rejects with `E_PROFILE_LOAD`
  (its hint says a browser may keep the failed fetch until the page
  reloads) and a later call imports it again, which in Node loads it. It
  also checks that the bundle's entry chunk is the requested one and that
  the rule modules (and so their chunks) import nothing the entry loads.
- Test files that call `runProfile` or `validateDoc(doc, { platform })`
  directly load the rules first (`await loadProfiles()` at the top); the
  pipeline tests do not, so they run the on-demand path.
- `test/api.test.ts` checks that the in-memory API gives what the CLI writes
  and prints for the same input.

When the check fails, move the Node-only code into an adapter in `src/adapters/out/files/`
behind a port of `src/application/port/out/` (or behind an
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
- **Rendering**: every written step is rendered (see *Invariants*; the
  gate's campaign included); `--no-render` skips it. A minimised `render`
  violation replays with the render oracle and its `run.sh` ends with the
  render command.
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
rename, E7 all applicable edits E1 to E6 one after the other. E8 and E9 are
one batch each (issue #18; bpmn-cli arms only): E8 splices a decision into a
branch of an existing exclusive split (a user task into the gateway's flow to
a non-gateway node, an exclusive gateway after it, a new "no" branch with a
send task and an end event), E9 adds a non-interrupting timer reminder path
on the new task to it (the plugin eval's request). The global track runs the
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
- *hard defects added*: hard problems the run introduced;
- *soft kinds added*: the crossings and backward flows the run introduced
  (`soft.addedKinds`);
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
hard defects, the hard defects added, the runs adding crossings and backward
flows (soft kinds; `-` for results without them), the mean harness delta and
the median share of moved nodes (old -> new), the global hard counts, and
every run that got worse or better. It exits 1 when semantic failures, runs
adding hard defects, hard defects added or global hard counts increased, or
when the soft budget is exceeded: `tools/bench/soft-budget.json` holds per
corpus and edit the largest number of runs of this repository's CLI (arm
`new`) that may add a crossing / a backward flow, today for E8 and E9 on the
scenarios (lower it when the layout improves, raise it only with a reviewed
reason). A corpus the budget does not name is reported only. Only hard kinds
known to both runs are compared, so a newly added metric kind is not a
regression of the code. With `--engine`, set `BASELINE_BIN` so that both runs
draw the engine corpus with the same CLI.

## Roundtrip fidelity

A write changes the text of the elements it changed and nothing else
(src/domain/document/xml/TextPreservation.ts, src/domain/document/utils/mirror.ts; [contract.md](contract.md#what-a-write-changes)). Two checks
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
not from the writer: a file without a diagram is drawn, the incremental
layout completes missing DI (an edge, a shape, the plane's `bpmnElement`)
and routes a line that does not reach its ends again (`detachedEdge`).
With `--no-layout` every no-op must be byte-identical; a `fall-backs` count
above zero means domain/document/xml/TextPreservation.ts could not keep a file's text (the note says
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
their DI, also after an end got another id earlier in the batch; a flow
form that stays put over many edits, also in snake_case and Pascal_Snake
bodies, ties, flows under an outvoted prefix or scope),
`test/keep-flow-ids.test.ts` (flow ids kept with `--keep-flow-ids`,
`W_FLOW_ID_STALE`, an end renamed or named earlier, `--flow-id` on a
splice, followed hints in files of mixed flow prefixes:
`test/fixtures/mixed-styles/`), `test/batch-aliases.test.ts` (aliases in `apply`, on the command
line too), `test/not-found.test.ts` (the candidates of `E_NOT_FOUND`),
`test/remove-branch.test.ts` (`remove --with-branch` / `--bridge-all`) and
`test/lane-splice.test.ts` (the lane and the geometry of a node added into a
flow between two lanes).

## Engine checks (Camunda 7)

The Camunda 7 profile of `bpmn validate` (`src/domain/validation/profiles/C7Profile.ts`) states for
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

The Camunda 8 profile (`src/domain/validation/profiles/C8Profile.ts`) states for every rule what
Camunda 8.9 does; placement and known names come from the Zeebe descriptor
(`src/domain/document/vendor/ZeebeDescriptor.ts`, the inlined `zeebe-bpmn-moddle`; regenerate with
`node tools/gen-camunda-descriptor.mjs`, `test/isomorphic.test.ts` fails
while it is stale). `test/c8-profile.test.ts` holds one synthetic model per
rule (151 models) with the expected codes and Camunda 8's verdict, the timer
and FEEL value checks with the values they were checked on, and the
`validate` output; `test/c8-ops.test.ts` covers `set` / `ext` / `retype` /
`show` in Camunda 8 files and runs the profile's hints through the real CLI
until a refused model has no deploy finding left; `test/step3-c8-fixes.test.ts`
checks the FEEL syntax check against `test/fixtures/c8/feel-verdicts.json`
(762 synthetic expressions with the verdict of Camunda 8.9.22, one per line:
add a new expression with the verdict you got from the engine) and the
schema-text, white-space, `refAs` and subscription rules;
`test/step3-followups-c8.test.ts` holds the timer range, cron field and
xsd:boolean models (27, with the verdict) and the duplicate id. By default they
check the CLI only. To re-check against a live Camunda 8 (REST v2, no
authentication), name its v2 root:

```
BPMN_C8_ENGINE=http://localhost:8088/v2 npx vitest run test/c8-profile.test.ts test/c8-ops.test.ts test/step3-c8-fixes.test.ts test/step3-followups-c8.test.ts
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
hint models of `c8-ops` are deployed after their hints were followed; the
accepted FEEL expressions go in files of 100 conditions, each refused one on
its own (about 300 deployments, refused ones leave nothing behind). With
Camunda 8.9.22: 519 / 519.

When you change how zeebe content is written, deploy the CLI-built models
and run them, and run the real-file battery on your private corpus (deploy
every file before and after each edit; compare every element's
`<bpmn:extensionElements>` text outside the edited element byte for byte).

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

The metrics do not see everything (labels, aesthetics, groups). Look at what
you touched:

```
node bin/bpmn.js render file.bpmn --problems -o /tmp/png/file.png      # no browser; the problems numbered; --plane <id> for a collapsed sub-process
node bin/bpmn.js render file.bpmn --around <id> -o /tmp/png/near.png   # the neighbourhood only (--path, --scope, ids; --tiles for a large drawing)
node bin/bpmn.js add file.bpmn task "X" --after <id> --render /tmp/png/after.png   # any mutating command: its result, what changed with a halo
```

`bpmn render` draws close to bpmn-js, not identically (its own glyphs). For
reviews and blind judging, render with real bpmn-js:

```
tools/render.sh /tmp/png file1.bpmn file2.bpmn            # any files
tools/bench/render.sh /tmp/png tools/bench/results/latest/work/edits/<arm>/<corpus>/<model>/*/model.bpmn
```

Both need Google Chrome (`PUPPETEER_EXECUTABLE_PATH` overrides the macOS
default path) and fetch `bpmn-to-image` with npx.
