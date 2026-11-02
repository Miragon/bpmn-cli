# Plan: the refactored bpmn-cli, rebuilt from zero

The refactored bpmn-cli is built from zero on the branch `rebuild`, one draft PR into main, beside today's code.
Today's code works but is hard to change: 84 `utils` files, 64 folder cycles, no class with a test of its own, 443 flag
slots, and a write that takes over a second. Main's algorithms and data are ported into new classes with
new tests; no file is copied as it is. Main also stays the judge: a tool, the oracle, runs main and the
rebuild on the same inputs and fails on every difference that a list does not explain. Only what a named
user needs stays. "Today" means main at 089ba05, the 0.9.0 release, which `rebuild` starts from; the
time of a write was measured three commits earlier, at 4cbec59.

| page | answers |
| --- | --- |
| [modules](modules.md) | which packages and modules exist, which way imports go, what the library exports |
| [layers by example](layers.md) | what the code of each layer looks like, along one change |
| [commands](cli.md) | which commands the refactoring keeps, and which behaviour goes |
| [flags](flags.md) | which flags the refactoring keeps, and when an input is a flag or a `key=value` |
| [code](code.md) | how code is cut into classes, how tests follow them, which checks hold the cut |
| [rebuild](rebuild.md) | where the rebuild grows, how the oracle judges it, the steps, releases and when it is done |

## Terms

| term | means |
| --- | --- |
| operation | one edit as JSON, such as `{ "op": "add", "kind": "userTask", "after": "start" }`; `bpmn apply` takes a list of them, and each edit command is one operation. The JSON key `op` and `OPS_SCHEMA` keep their short names: every batch file and design-iq use them |
| model operation | an operation that changes what the model says: `add`, `connect`, `set`, `remove`, `retype`, `move`, `order`, `ext`, `split` |
| drawing operation | an operation that changes only where things are drawn: `layout`, `tidy`, `compact`, `place`, `color`, `label`, `route`, `space`; the result reports them under `format`, as today |
| `$name` | an alias a batch gives a new element with `as`, so a later operation of the same `apply` can name it |
| DI | the diagram part of a BPMN file: the coordinates of shapes and flows |
| plane | one drawing surface in the DI: the process, and each collapsed sub-process, has its own |
| moddle | bpmn-moddle's object tree of a parsed file; bpmnlint's rules work on the same tree |
| `DrawingSnapshot`, `ChangeSet` | what drawing saw before a write, and what edit changed in it; drawing compares the edited document with the snapshot and takes from the change set what was created or moved |
| camunda-compat | bpmnlint's public rules for what each Camunda version supports |
| layout score | the weighted sum of the layout problems that the module `scoring` finds, one model for writes, the layout, `diagram` and the tests; lower is better ([layout score](modules.md#layout-score)) |
| flag slot | one flag on one command; a flag every write takes counts once per command |
| probe | one comparison the oracle makes between main and the rebuild, such as bytes or layout ([oracle](rebuild.md#oracle)) |
| allow-list | the differences from main the oracle accepts, each with its reason |
| `next` | the npm dist-tag the release candidates `0.10.0-rc.N` go to; `latest` stays on main's releases until the release |

## At a glance

| measure | today | target | measured | details |
| --- | --- | --- | --- | --- |
| lines in `src/` and `packages/` | 53,642 | ≤ 60,000, a ceiling for outliers | 51.3k ([budget](#the-line-budget)) | [modules](modules.md#modules) |
| packages: published · private | 1 · 0 | 1 · 2 | 1 · 2 | [packages](modules.md#packages) |
| core modules with one entry | 0 | 10 | 10 | [modules](modules.md#modules) |
| `utils/` files · exported free functions | 84 · 455 | 0 · 8 | 0 · 8 | [classes](code.md#classes) |
| classes with a mirrored test | 0 of 320 | all | all 519 | [tests](code.md#tests) |
| commands · flag slots · shared write flags | 28 · 443 · 15 | 26 · 143 · 4 | 26 · 143 · 4 | [flags](flags.md) |
| exports of `.` / `./node` | 94 / 18 | 10 / 0 | 10 / 0 | [contract](modules.md#contract) |
| `bpmn add` on a Camunda 8 model of 500 nodes, with a `.bpmnlintrc` | 1,109 ms | ≈ 480 ms, an estimate: no project lint and no full redraw in a write | 631 ms, main 1,154 ms in the same run, median of 9: 45 % faster, the estimate missed | [write step](rebuild.md#13-write-views-and-api) |
| text of a write result | up to 9.2 KB | ≤ 1 KB | ≤ 1 KB, cut at 1,024 bytes; 940 bytes on a batch of 81 operations | [target](cli.md#target) |
| folder cycles in `src/`, type imports included | 64 | 0 | 0 | [guardrails](code.md#guardrails) |

### The line budget

The first target, 47,000 lines, was missed: `src/` and `packages/` hold 51.3k, 2.3k fewer than today.
drawing is the difference: it has 19.2k lines against the 14.5k of the estimate, because main's two
layouts were ported, not reinvented, and cutting their free functions into classes of at most 300 lines
added to them. Going lower means changing what the layouts do, which the oracle would have to judge.

`budgets.json` therefore caps the total at 60,000 and each module at about 15 % over its size, so a
budget fails on an outlier, not on every change; the 300 lines per file stay the sharp limit.

The write missed its estimate as a read explains: `bpmn show` on the same file takes 389 ms, so loading
the CLI and parsing take most of it.

## Users

What stays is what one of these uses. The short names head the use counts on the
[commands](cli.md#commands) and [flags](flags.md) pages.

| user | short name | uses | reaches the refactoring |
| --- | --- | --- | --- |
| the bpmn skill in `plugins/bpmn-cli/`, with 7 evals | skill, evals | the CLI | updated on `rebuild`, in the draft PR |
| the docs site in `docs/` | docs | the CLI | updated with the skill |
| design-iq, Miragon's modelling workspace | diq | pins bpmn-cli 0.9.0; the library: `applyToXml`, `showXml`, `findXml`, its own validators | tries the release candidate in a branch of its own, along its [map](modules.md#contract) |
| the skills of bpmn-to-code | b2c | `bpmn show`, `bpmn find` | checked against the release candidate |
| ask-miragon | ask | pins bpmn-cli 0.5.0 and imports 12 of its internals | moves after the release, along its [map](modules.md#contract) |
| the CI of Miragon's [process-engine-blueprints](https://github.com/Miragon/process-engine-blueprints): 10 examples, each with a `.bpmnlintrc` | | bpmnlint 12 with `@miragon/bpmnlint-plugin-rules` 0.17.0; bpmn-cli 0.7.0 only as a dev dependency, not in the lint | `bpmn validate` reports what that CI reports |

## Who finds what

Five things report problems. Two are bpmn-cli's own rules about the model, two run rules that come from
outside, and one judges the drawing:

| term | whose rules | asks | codes | runs | lives after the refactoring |
| --- | --- | --- | --- | --- | --- |
| structure checks | bpmn-cli's | is the file BPMN the CLI can read, change and draw | `E_*`, `W_*` | writes with model operations, `validate` | `checks/structure` |
| Camunda checks | bpmn-cli's | what Camunda 7 or 8 rejects at deploy, FEEL included | `W_C7_*`, `W_C8_*` | writes with model operations on executable processes, `validate` on every process, since Camunda 8 refuses a file without an executable one | `checks/camunda` |
| host validators | the embedding app's, such as design-iq's save gate | whatever the app asks | the app's | writes, before and after; `validate`, once | `write`: `HostValidators` runs them |
| project lint | the project's `.bpmnlintrc` | the project's naming and modelling rules | bpmnlint rule names | `validate` only | `packages/lint`, handed in by cli as a validator |
| layout score | bpmn-cli's | how well the model is drawn | problem kinds such as `crossings` | every write, `diagram`, the layout's trials | `scoring` |

- checks holds only bpmn-cli's own rules about the model. It neither runs foreign rules nor compares a
  before with an after.
- What a write added is told by one class, `FindingDelta` in write. The new document is checked once,
  whole. Without an error anywhere nothing more runs; with one the old document is checked whole too,
  and an error whose key it lacks refuses without `force`, wherever it sits. Warnings are reported at the
  touched elements and counted elsewhere. Host validators run on the old file, then on the new one, and it compares their findings over the
  whole file, by `key`. Only a write has a before.

## Decisions

Made from 2026-10-30 to 2026-11-01. The ones that hold after the refactoring are ADRs in `docs/adr/`; the ones about how the refactoring is carried out, such as one branch, Node 24, the oracle and its corpus, live in this plan.

- [1. Project lint runs only in `bpmn validate`](../adr/0001-project-lint-only-in-validate.md)
- [2. The project's copy of a bpmnlint plugin runs](../adr/0002-the-projects-plugin-copy-runs.md)
- [3. New shapes get the bpmn-js size](../adr/0003-shapes-get-the-bpmn-js-size.md)
- [4. No workaround for an antipattern](../adr/0004-no-workaround-for-an-antipattern.md)
- [5. Render and lint stay private packages](../adr/0005-render-and-lint-stay-private.md)
- [6. Operations are parsed strictly](../adr/0006-operations-parse-strictly.md)
- [7. What a flag says, and what a key says](../adr/0007-flag-or-key-value.md)
- [8. The layout score is a module of its own](../adr/0008-scoring-is-a-module.md)
- [9. Each read answers one question](../adr/0009-each-read-answers-one-question.md)

## Steps

Each step is one commit or a few in the draft PR. Its card on the [rebuild page](rebuild.md#steps) says what is there today,
what is there after, which files it touches and when it is done; steps 1, 16 and 17 say it here.

### Before the rebuild: the judge

- [x] **1. Branch**: branch `rebuild` off main at 089ba05 and open it as a draft PR into main, without a
  ruleset, since each rebase force-pushes it · done when the draft PR runs the gate
- [ ] **2. Naming subpath**: publish `./naming` from `@miragon/bpmnlint-plugin-rules`, the one change
  outside the draft PR · [card](rebuild.md#2-naming-subpath) · moved to a follow-up after the release:
  [#143](https://github.com/Miragon/bpmn-cli/issues/143)
- [x] **3. Oracle** · needs 1

From here main takes fixes only; each rebase brings them in ([where](rebuild.md#where)).

### The packages: render and lint

- [x] **4. Gate**: clear `rebuild` and set the guardrails · needs 3
- [x] **5. Render**: build `packages/render` · needs 4
- [x] **6. Lint**: build `packages/lint` · needs 4

Done when render draws the corpus in Node and in a browser bundle, and lint's oracle entry gates.

### The core: the first release candidate

- [x] **7. Model** · needs 4; step 2 still open, so model keeps the naming defaults as data
- [x] **8. Operations** · needs 7
- [x] **9. Checks** · needs 7
- [x] **10. Scoring** · needs 5, 7
- [x] **11. Drawing** · needs 8, 10
- [x] **12. Edit** · needs 8
- [x] **13. Write, views and api** · needs 9 to 12 · [card](rebuild.md#13-write-views-and-api)
- [x] **14. CLI, ship the first release candidate** · needs 6, 13 · [card](rebuild.md#14-cli-and-the-first-release-candidate)

Done when every probe is green outside the allow-list and the first release candidate is on `next`.

### Done: the draft PR

- [ ] **15. Skill, evals and docs** · needs 14 · [card](rebuild.md#15-skill-evals-and-docs); the skill and its
  tests are on the refactored CLI, the eval runs on the release candidate and the docs are open
- [ ] **16. Consumers**: try design-iq on the release candidate, in a branch of its own · needs 15 · done
  when design-iq's branch is green in its CI. bpmn-to-code uses only the CLI in its skills; they move to
  `show <id>` and the new version in a docs change after the release
- [ ] **17. Ready**: rebase onto main's head and check the [done](rebuild.md#done) criteria · needs 16 ·
  done when they hold

Merging the PR and shipping the release come after this plan ([later](rebuild.md#later)). Follow-up after the
release: ask-miragon moves from 0.5.0 to the refactored library along its [map](modules.md#contract).

## Triggers

The refactored CLI does without these until the event happens.

| when | then |
| --- | --- |
| bpmn-auto-layout 2.x is stable, fixes [#154](https://github.com/bpmn-io/bpmn-auto-layout/issues/154) and [#116](https://github.com/bpmn-io/bpmn-auto-layout/issues/116), and scores at most 110 % of our layout score, lower being better | it replaces the full layout, `drawing/full/` (4.7k lines) |
| bpmn-modeler, Miragon's BPMN modeler for VS Code, wants the incremental layout | drawing becomes a package |
| a second user wants the Camunda checks | `checks/camunda` becomes a package |
| our painter gets 3 fidelity bugs in 6 months, or bpmn-js makes its drawing code API | spike bpmn-js drawing in render, licence first |
| a consumer needs the library without commander and resvg | split library and CLI into two packages |
| a consumer needs file functions, or a render user asks for highlights | add `./node`, or a `marks` option in render |
| #123 or plugin #113 is wanted after all | bpmnlint runs `checks/camunda`'s rule classes through an adapter, or the rules move into `packages/lint`, which then gets an entry without Node; writes then load bpmnlint |
| someone outside bpmn-cli wants to draw BPMN headless | `packages/render` is published as `@miragon/bpmn-render`: `0.0.0` by hand once to set up npm trusted publishing, then `0.1.0` by CI with provenance; the core pins it exactly |
| a review finds code in a module that its section of `docs/architecture.md` rules out | an agent check reads each module's section and code and reports what contradicts it; a report first, a gate once it runs quiet |
| a second Node host wants bpmn-cli's project lint | `packages/lint` is published, or goes into the plugin as a Node entry if its owner prefers |

## Keeping this plan current

- From step 1 the plan lives on `rebuild`, in the draft PR, where the steps land.
- The commit that finishes a step ticks its box and deletes its card; it links no commit, since a rebase
  changes every hash.
- A made decision leaves the table as an ADR in `docs/adr/`. A shipped release shrinks to one line.

The layers after the refactoring: [architecture.md](../architecture.md). Gate: [testing.md](../testing.md).
