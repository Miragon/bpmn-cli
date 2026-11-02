# Testing bpmn-cli

What holds the code, from the fastest check to the slowest. The rules behind them are in
[plan/code.md](plan/code.md#guardrails).

| layer | catches | command | time |
| --- | --- | --- | --- |
| tests | one behaviour of each class, the contract, the CLI in-process | `npm test` | minutes |
| the gate | everything a change has to pass | `npm run gate` | minutes |
| the oracle | every difference from main | `npm run oracle` | minutes |
| fuzz | invariant violations in long random edit sequences, through the real CLI | `npm run fuzz` | 10 s to hours |
| bench | stability, quality and semantic success of typical edits, against main | `npm run bench` | minutes |
| live engines | our checks and Camunda drifting apart | `node tools/oracle/live-engines.mjs` | minutes, with podman |

## The tests

- `test/<module>/` mirrors `src/<module>/`: `src/edit/X.ts` has `test/edit/X.test.ts` with `describe('X')`.
  `packages/*/test/` do the same for the packages. A case is one behaviour of a public method, named as a
  sentence about BPMN, about 1 to 3 per public method.
- Inputs are BPMN fixtures from `corpus/`, read through `test/support/`, never built with the edit API.
  No mocks inside a module; fakes only for files, engine REST and the clock.
- `test/e2e/` runs the CLI in-process per command group, with one spawn smoke test, `golden.test.ts`
  over `corpus/cli/`, and `plugin.test.ts`, which holds the plugin to `package.json`.
- `test/contract/` holds what consumers rely on: the ten exports, design-iq's recorded calls, the result
  fixtures, the cost of one write (`WriteCost.test.ts`), the names of the guide, the skill and the hints, and
  `architecture.test.ts`, which fails when `docs/architecture.md` lacks a module or names a class that
  does not exist.
- `test/corpus/` runs the whole corpus: a no-op keeps every byte, random walks keep the DI complete and
  deterministic, and every drawn shape passes bpmnlint's `standard-size`.
- `test/repo/` proves the guardrails on planted repositories, and `hygiene.test.ts` fails on private paths,
  control bytes and a dependency of a private package that the core lacks or pins differently.
- Render's `packages/render/test/golden/` holds about 20 SVGs, so a shape or colour cannot change unseen.
- `corpus/engine/` keeps verdict tables as data: each row names the class whose rule it tests, and that
  class's mirrored test runs its rows in one `it.each`. `FullLayout`'s mirrored test draws the 115 scenarios of
  `corpus/layout/` and holds their total to main's; `Scorer`'s matches main's counts per kind on every
  corpus file.

Layout tests assert invariants and order, such as no overlap and inside its lane, never pixels.

## The gate

`npm run gate` runs everything a change has to pass, in this order; each also runs alone. CI runs it on
every pull request and every push to `main`. [CONTRIBUTING.md](../CONTRIBUTING.md#scripts-the-quality-gate)
lists what each step checks. `npm run budgets` holds `budgets.json`: lines per module and package, the
10 exports, the 26 commands, the 143 flag slots and the guide's 20 KB. Raising a number needs a reason in
the commit, and coverage only rises.

`npm run timings` builds on that: `--version` within 60 ms, and `bpmn add` on a Camunda 8 model of 500
nodes no slower than main on the same machine, median of 5. It is part of the gate. On CI the absolute
budget is advisory.

## The oracle

`tools/oracle` runs main and this tree on the same input and asks main for every answer. Main means the
commit this branch sits on (`git merge-base HEAD origin/main`), built in the worktree `.oracle/main` and
cached by that commit, so between two rebases the judge stands still.

```sh
npm run oracle                                   # judge; leaves .oracle/result.json
npm run oracle -- --probe layout --filter walks  # one probe, a part of the corpus
npm run oracle:selftest                          # main against itself, and one planted change per probe
npm run oracle:record                            # record corpus/ again
node tools/oracle/design-iq-record.mjs <checkout> # record corpus/design-iq/ from a design-iq checkout
```

| probe | input | must match | may differ |
| --- | --- | --- | --- |
| bytes | `corpus/edits/`: a no-op, a rename and an insert per model | bytes where main keeps them; changed lines no more than main's | |
| findings | the corpus for Camunda 7, Camunda 8 and no engine, `corpus/lint/`, `corpus/engine/` | code, severity and element | wording |
| layout | the 115 scenarios drawn in full; the steps of `corpus/walks/` | the totals no higher than main's, scored by main's own scorers | coordinates; the score of one file or step |
| image | the corpus, every plane | at most 0.5 % of pixels, both rasterised by the same resvg-wasm | SVG bytes |
| edits | `corpus/walks/`, the bench edits of `corpus/edits/`, `corpus/design-iq/` | semantics without DI, ids, created, changed, removed, refusal codes, host-validator findings | DI, the result fields the allow-list names |
| CLI | `corpus/cli/`, one golden call per kept command and flag | exit code; in `--json`, the fields the edits and findings probes compare; `validate`'s verdict lines | other JSON fields, other text |

- Only the allow-list `tools/oracle/differences.json` (probe, pattern, reason) may differ. A row is a
  decision, with its reason: what goes on the commands and flags pages, the behaviour that goes, an ADR.
- The rebuild never grades itself: the layout probe, the fuzz and the bench score both sides with main's
  scorers. `Scorer`'s own test holds it to main's counts.
- A rebase that changes main's answers ports the fix or names it in the list. After the release the oracle
  compares the last release with main.
- A new probe, entry or recording is one file in `tools/oracle/probes/`, `entries/` or `recordings/`, and
  its proof one in `plants/`.

## The corpus

`corpus/` holds every BPMN input of the oracle and the tests. All of it is synthetic or public.

| folder | holds |
| --- | --- |
| `models/` | the fixtures |
| `layout/` | the 115 layout scenarios, each with main's score over all 26 kinds; `scores.json`, main's counts per kind on every corpus file |
| `edits/` | per model a no-op, a rename and an insert, and the bench edits, as operation JSON |
| `lint/` | 7 of the 10 examples of process-engine-blueprints with their `.bpmnlintrc` and `package.json`, the others being byte-identical in models and config, and models for each case `packages/lint` handles |
| `design-iq/` | the arguments of design-iq's recorded calls, the paths of `OPS_SCHEMA` it reads, and `COMMIT` |
| `engine/` | `parity/`: the 610 distinct models of 109 rule specs, with `codes.json` naming each of the 1,077 cases' model; `verdicts/`: 421 verdicts of Camunda 7.24, CIB seven 2.2, Operaton 2.1.5 and Camunda 8.9.22; `fixed/`; `feel/`: 762 FEEL verdicts; `structure/` |
| `walks/` | recorded fuzz walks, per step the operations and the file before |
| `scoring/` | small models per scoring criterion |
| `cli/` | one golden call per kept command and flag |
| `model/`, `edit/`, `drawing/`, `views/`, `write/`, `guide/`, `contract/` | the fixtures of those modules' tests |

Every fixture is synthetic. To keep a defect found on a private model, rebuild a minimal model that shows
it; the minimiser's repro tells you which operations matter.

## Fuzz

```sh
npm run build
npm run fuzz                                         # 24 walks of 30 steps over the corpus
node tools/fuzz/run.mjs --walks 200 --steps 60 --jobs 8 --hard warn --minimize
node tools/fuzz/walk.mjs <model.bpmn> --seed 7 --steps 40 --save-steps
node tools/fuzz/minimize.mjs tools/fuzz/out/latest/walks/<walk> --kind hard:overlaps
```

The nightly workflow runs 60 walks of 30 steps with a new seed, `--hard warn --minimize`. Fuzz is not in the
gate: the walks of `test/corpus/random-walks.test.ts` cover its invariants on every change.

After every step a walk checks:

- **clean re-import**: the written file parses with plain bpmn-moddle, without a new import warning;
- **DI complete**: every element has DI on the plane it belongs to, nothing dangling or duplicate;
- **no new hard layout defect**: a kind weighted 6 or more, as main's scorer finds it (`--hard warn` counts
  them as warnings, so a run goes on and the layout probe judges them);
- **honest results**: the score of the result equals a standalone measurement;
- **no unreported moves**: every shape that moved is in the result;
- **determinism**: every n-th step runs twice and gives the same bytes;
- **failures stay clean**: no crash, no usage error, nothing written by a failed command;
- **the result renders**: `render --problems` succeeds and lists as many problems as the measure.

- Seeds: the same arguments give the same walks. `--seed`, `--filter`, `--corpus dir[:dir]` narrow a run;
  `BPMN_FUZZ_CORPUS` adds directories.
- Executors: by default each step runs through `bin/bpmn.js` (`BPMN_BIN` for another build); `--exec lib`
  runs the built library in-process, several times faster. `--via apply` sends every step as a batch.
- Output, git-ignored: `tools/fuzz/out/latest/report.json` and one directory per walk, replayable with
  `walk.mjs --replay`. Minimising writes `min-<kind>/run.sh`, plain CLI calls on a copy of the model.
- Exit codes: 0 no error-severity violation, 1 violations, 2 bad arguments.

## Bench

```sh
npm run build
npm run bench                                   # arms new and baseline, tools/bench/results/latest
node tools/bench/run.mjs --track edits --filter agent__ --jobs 8
```

`tools/bench/gen-edits.mjs` picks targets near the middle of the longest path of each model: E1 a user
task, E2 a branch at a gateway, E3 a removed task, E4 a boundary path, E5 a move to the neighbouring lane,
E6 a long rename, E7 all of them in turn, E8 and E9 a decision and a reminder path in one batch. The arm
`new` is this tree, `baseline` main at the commit it sits on. Per run it measures success, whether the
intended change is in the file, how far existing nodes moved, the harness score, the hard defects and
soft problems added, and validity.

With both arms it compares them and exits 1 on a regression. `tools/bench/soft-budget.json` holds how many
runs may add a crossing or a backward flow, per corpus and edit: lower it when the layout improves. The
nightly workflow runs the bench.

## Live engines

`corpus/engine/` records what the engines answered, so the gate needs none.
`node tools/oracle/live-engines.mjs` starts Camunda 7, CIB seven, Operaton and Camunda 8 with podman,
deploys the corpus and fails when an engine no longer answers what it records. The versions are pinned
in that file. The workflow `live-engines.yml` runs it on a pull request that touches `corpus/engine/` or
the file, and it runs once on each release candidate.

## Private corpora

Real models from customers or other private sources never go into this repository: not as fixtures, not
in test names, not in docs. Plug them in from outside:

```sh
export BPMN_BENCH_CORPUS="hand=$HOME/corpora/hand:$HOME/corpora/large"   # name=dir or dir
export BPMN_FUZZ_CORPUS="$HOME/corpora/hand:$HOME/corpora/large"
npm run bench
node tools/fuzz/run.mjs --walks 300 --steps 50 --jobs 8 --minimize
```

- Results land in `tools/bench/results/` and `tools/fuzz/out/`, which are git-ignored. They contain the
  private models; delete them when done and do not attach them to issues.
- Choose neutral corpus names (`hand`, `large`): they appear in the results.
- To keep a finding, reduce it with the minimiser and rebuild the few elements it needs as a synthetic
  fixture in `corpus/`.

## Looking at the result

The score does not see everything: labels, aesthetics, groups. Look at what you touched:

```sh
node bin/bpmn.js render file.bpmn --problems -o near.png
node bin/bpmn.js render file.bpmn --around <id> -o near.png
```

`bpmn render` draws close to bpmn-js, not identically. For reviews and blind judging, render with real
bpmn-js, for example with `bpmn-to-image`.
