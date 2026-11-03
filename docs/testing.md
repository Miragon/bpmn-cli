# Testing bpmn-cli

What holds the code, from the fastest check to the slowest. The rules behind them are in
[CONTRIBUTING.md](../CONTRIBUTING.md#how-code-is-cut).

| layer | catches | command | time |
| --- | --- | --- | --- |
| tests | one behaviour of each class, the contract, the CLI in-process | `npm test` | minutes |
| the gate | everything a change has to pass | `npm run gate` | minutes |
| fuzz | invariant violations in long random edit sequences, through the real CLI | `npm run fuzz` | 10 s to hours |
| bench | stability, quality and semantic success of typical edits, against main | `npm run bench` | minutes |
| live engines | our checks and Camunda drifting apart | `node tools/verify/live-engines.mjs` | minutes, with podman |

## The tests

- `test/<module>/` mirrors `src/<module>/`: `src/edit/X.ts` has `test/edit/X.test.ts` with `describe('X')`.
  `packages/*/test/` do the same for the packages. A case is one behaviour of a public method, named as a
  sentence about BPMN, about 1 to 3 per public method.
- Inputs are BPMN fixtures from `fixtures/`, read through `test/support/`, never built with the edit API;
  a drawing test takes a before and an after fixture. No mocks inside a module; fakes only for files,
  engine REST and the clock.
- A mirrored test imports by value its class and the classes of its own module that build its input in
  production. It reaches another module only through `test/support/`: one `Fixtures` class that reads
  `fixtures/`, plus builders of values, at most 12 files.
- Per public method: the main path, each refusal code, each boundary BPMN names (empty, first lane,
  nested host) and each fixed bug by its behaviour. Not tested: private methods, plain getters, types,
  what moddle or commander do, one behaviour twice. A class with more than 20 cases splits; an `it.each`
  over corpus rows counts as one case.
- `test/e2e/` runs the CLI in-process per command group, with one spawn smoke test, `golden.test.ts`
  over `fixtures/cli/`, and `plugin.test.ts`, which holds the plugin to `package.json`.
- `test/contract/` holds what consumers rely on: the ten exports, the result
  fixtures, the cost of one write (`WriteCost.test.ts`), the names of the guide, the skill and the hints, and
  `architecture.test.ts`, which fails when `docs/architecture.md` lacks a module or names a class that
  does not exist.
- `test/fixtures/` runs the whole corpus: a no-op keeps every byte, random walks keep the DI complete and
  deterministic, and every drawn shape passes bpmnlint's `standard-size`.
- `test/repo/` proves the guardrails on planted repositories, and `hygiene.test.ts` fails on private paths,
  control bytes and a dependency of a private package that the core lacks or pins differently.
- Render's `packages/render/test/golden/` holds about 20 SVGs, so a shape or colour cannot change unseen.
- `fixtures/engine/` keeps verdict tables as data: each row names the class whose rule it tests, and that
  class's mirrored test runs its rows in one `it.each`. `FullLayout`'s mirrored test draws the 115 scenarios of
  `fixtures/layout/` and holds their total to 0.9's; `Scorer`'s matches 0.9's counts per kind on every
  corpus file.

Layout tests assert invariants and order, such as no overlap and inside its lane, never pixels.

## The gate

`npm run gate` runs everything a change has to pass, in this order; each also runs alone. CI runs it on
every pull request and every push to `main`. [CONTRIBUTING.md](../CONTRIBUTING.md#scripts-the-quality-gate)
lists what each step checks. `npm run check-build -- . budgets` holds `budgets.json`: lines per module and package, the
26 commands, the 143 flag slots and the guide's 20 KB. Raising a number needs a reason in
the commit, and coverage only rises.

The lines are capped at 60,000 in all and each module at about 15 % over its size, so a budget fails on an
outlier, not on every change; the 300 lines per file stay the sharp limit. drawing holds the most, since
the two layouts of 0.9 were ported rather than reinvented, and cutting them into classes of at most 300
lines added to them.

`npm run timings` builds on that: `--version` within 60 ms, and `bpmn add` on a Camunda 8 model of 500
nodes at most 1.2 times main's time on the same machine, best of 5 in turn. Main means the commit this
branch sits on (the merge base with `origin/main`), built in the worktree `.work/main` and cached by that
commit. It is part of the gate. On CI the absolute budget is advisory.

Not in the gate: the fuzz, whose invariants the walks of `test/fixtures/` cover; mutation testing, which
costs minutes per run for what the cases per public method ask anyway; and class members in knip, whose
6.x no longer reports them.

## The fixtures

`fixtures/` holds every BPMN input of the tests, the fuzz and the bench. All of it is synthetic or public.

| folder | holds |
| --- | --- |
| `models/` | the fixtures |
| `layout/` | the 115 layout scenarios, each with 0.9's score over all 26 kinds; `scores.json`, 0.9's counts per kind on every corpus file |
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
node tools/verify/fuzz/run.mjs --walks 200 --steps 60 --jobs 8 --hard warn --minimize
node tools/verify/fuzz/walk.mjs <model.bpmn> --seed 7 --steps 40 --save-steps
node tools/verify/fuzz/minimize.mjs tools/verify/fuzz/out/latest/walks/<walk> --kind hard:overlaps
```

The nightly workflow runs 60 walks of 30 steps with a new seed, `--hard warn --minimize`. Fuzz is not in the
gate: the walks of `test/fixtures/random-walks.test.ts` cover its invariants on every change.

After every step a walk checks:

- **clean re-import**: the written file parses with plain bpmn-moddle, without a new import warning;
- **DI complete**: every element has DI on the plane it belongs to, nothing dangling or duplicate;
- **no new hard layout defect**: a kind weighted 6 or more (`--hard warn` counts them as warnings, so a
  run goes on);
- **honest results**: the score of the result equals a standalone measurement;
- **no unreported moves**: every shape that moved is in the result;
- **determinism**: every n-th step runs twice and gives the same bytes;
- **failures stay clean**: no crash, no usage error, nothing written by a failed command;
- **the result renders**: `render --problems` succeeds and lists as many problems as the measure.

- Scorers: the fuzz and the bench score with v0.9.0, the last release before the refactoring, built in
  the worktree `.work/scorers`, so the code never grades itself. `Scorer`'s own test holds it to those
  counts in `fixtures/layout/scores.json`.
- Seeds: the same arguments give the same walks. `--seed`, `--filter`, `--corpus dir[:dir]` narrow a run;
  `BPMN_FUZZ_CORPUS` adds directories.
- Executors: by default each step runs through `bin/bpmn.js` (`BPMN_BIN` for another build); `--exec lib`
  runs the built library in-process, several times faster. `--via apply` sends every step as a batch.
- Output, git-ignored: `tools/verify/fuzz/out/latest/report.json` and one directory per walk, replayable with
  `walk.mjs --replay`. Minimising writes `min-<kind>/run.sh`, plain CLI calls on a copy of the model.
- Exit codes: 0 no error-severity violation, 1 violations, 2 bad arguments.

## Bench

```sh
npm run build
npm run bench                                   # arms new and baseline, tools/verify/bench/results/latest
node tools/verify/bench/run.mjs --track edits --filter agent__ --jobs 8
```

`tools/verify/bench/gen-edits.mjs` picks targets near the middle of the longest path of each model: E1 a user
task, E2 a branch at a gateway, E3 a removed task, E4 a boundary path, E5 a move to the neighbouring lane,
E6 a long rename, E7 all of them in turn, E8 and E9 a decision and a reminder path in one batch. The arm
`new` is this tree, `baseline` main at the commit it sits on. Per run it measures success, whether the
intended change is in the file, how far existing nodes moved, the harness score, the hard defects and
soft problems added, and validity.

With both arms it compares them and exits 1 on a regression. `tools/verify/bench/soft-budget.json` holds how many
runs may add a crossing or a backward flow, per corpus and edit: lower it when the layout improves. The
nightly workflow runs the bench.

## Live engines

`fixtures/engine/` records what the engines answered, so the gate needs none.
`node tools/verify/live-engines.mjs` starts Camunda 7, CIB seven, Operaton and Camunda 8 with podman,
deploys the corpus and fails when an engine no longer answers what it records. The versions are pinned
in that file. The workflow `live-engines.yml` runs it on a pull request that touches `fixtures/engine/` or
the file, and it runs once on each release candidate.

## Private corpora

Real models from customers or other private sources never go into this repository: not as fixtures, not
in test names, not in docs. Plug them in from outside:

```sh
export BPMN_BENCH_CORPUS="hand=$HOME/corpora/hand:$HOME/corpora/large"   # name=dir or dir
export BPMN_FUZZ_CORPUS="$HOME/corpora/hand:$HOME/corpora/large"
npm run bench
node tools/verify/fuzz/run.mjs --walks 300 --steps 50 --jobs 8 --minimize
```

- Results land in `tools/verify/bench/results/` and `tools/verify/fuzz/out/`, which are git-ignored. They contain the
  private models; delete them when done and do not attach them to issues.
- Choose neutral corpus names (`hand`, `large`): they appear in the results.
- To keep a finding, reduce it with the minimiser and rebuild the few elements it needs as a synthetic
  fixture in `fixtures/`.

## Looking at the result

The score does not see everything: labels, aesthetics, groups. Look at what you touched:

```sh
node bin/bpmn.js render file.bpmn --problems -o near.png
node bin/bpmn.js render file.bpmn --around <id> -o near.png
```

`bpmn render` draws close to bpmn-js, not identically. For reviews and blind judging, render with real
bpmn-js, for example with `bpmn-to-image`.
