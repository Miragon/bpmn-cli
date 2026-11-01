# Plan: bpmn-cli 1.0, rebuilt from zero

bpmn-cli 1.0 is built from zero on the branch `rebuild`, one draft PR into main, beside today's code.
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
| [commands](cli.md) | which commands 1.0 keeps, and which behaviour goes |
| [flags](flags.md) | which flags 1.0 keeps, and when an input is a flag or a `key=value` |
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
| `next` | the npm dist-tag the release candidates `1.0.0-rc.N` go to; `latest` stays on main's releases until 1.0.0 |

## At a glance

| measure | today | 1.0 | details |
| --- | --- | --- | --- |
| lines in `src/` and `packages/` | 53,642 | ≤ 47,000 | [modules](modules.md#modules) |
| packages: published · private | 1 · 0 | 1 · 2 | [packages](modules.md#packages) |
| core modules with one entry | 0 | 10 | [modules](modules.md#modules) |
| `utils/` files · exported free functions | 84 · 455 | 0 · 8 | [classes](code.md#classes) |
| classes with a mirrored test | 0 of 320 | all | [tests](code.md#tests) |
| commands · flag slots · shared write flags | 28 · 443 · 15 | 26 · 143 · 4 | [flags](flags.md) |
| exports of `.` / `./node` | 94 / 18 | 10 / 0 | [contract](modules.md#contract) |
| `bpmn add` on a Camunda 8 model of 500 nodes, with a `.bpmnlintrc` | 1,109 ms | ≈ 480 ms, an estimate: no project lint and no full redraw in a write | [write step](rebuild.md#13-write-views-and-api) |
| text of a write result | up to 9.2 KB | ≤ 1 KB | [target](cli.md#target) |
| folder cycles in `src/`, type imports included | 64 | 0 | [guardrails](code.md#guardrails) |

## Users

What stays is what one of these uses. The short names head the use counts on the
[commands](cli.md#commands) and [flags](flags.md) pages.

| user | short name | uses | reaches 1.0 |
| --- | --- | --- | --- |
| the bpmn skill in `plugins/bpmn-cli/`, with 7 evals | skill, evals | the CLI | updated on `rebuild`, in the draft PR |
| the docs site in `docs/` | docs | the CLI | updated with the skill |
| design-iq, Miragon's modelling workspace | diq | pins bpmn-cli 0.9.0; the library: `applyToXml`, `showXml`, `findXml`, its own validators | tries the release candidate in a branch of its own, along its [map](modules.md#contract) |
| the skills of bpmn-to-code | b2c | `bpmn show`, `bpmn find` | checked against the release candidate |
| ask-miragon | ask | pins bpmn-cli 0.5.0 and imports 12 of its internals | moves after 1.0, along its [map](modules.md#contract) |
| the CI of Miragon's [process-engine-blueprints](https://github.com/Miragon/process-engine-blueprints): 10 examples, each with a `.bpmnlintrc` | | bpmnlint 12 with `@miragon/bpmnlint-plugin-rules` 0.17.0; bpmn-cli 0.7.0 only as a dev dependency, not in the lint | `bpmn validate` reports what that CI reports |

## Who finds what

Five things report problems. Two are bpmn-cli's own rules about the model, two run rules that come from
outside, and one judges the drawing:

| term | whose rules | asks | codes | runs | lives at 1.0 |
| --- | --- | --- | --- | --- | --- |
| structure checks | bpmn-cli's | is the file BPMN the CLI can read, change and draw | `E_*`, `W_*` | writes with model operations, `validate` | `checks/structure` |
| Camunda checks | bpmn-cli's | what Camunda 7 or 8 rejects at deploy, FEEL included | `W_C7_*`, `W_C8_*` | writes with model operations on executable processes, `validate` | `checks/camunda` |
| host validators | the embedding app's, such as design-iq's save gate | whatever the app asks | the app's | writes, before and after; `validate`, once | `write`: `HostValidators` runs them |
| project lint | the project's `.bpmnlintrc` | the project's naming and modelling rules | bpmnlint rule names | `validate` only | `packages/lint`, handed in by cli as a validator |
| layout score | bpmn-cli's | how well the model is drawn | problem kinds such as `crossings` | every write, `diagram`, the layout's trials | `scoring` |

- checks holds only bpmn-cli's own rules about the model. It neither runs foreign rules nor compares a
  before with an after.
- What a write added is told by one class, `FindingDelta` in write. Structure and Camunda checks it
  compares at the touched elements, checking the old document there only when the new one has errors;
  host validators run on the old file, then on the new one, and it compares their findings over the
  whole file, by `key`. Only a write has a before.

## Decisions

Made from 2026-10-30 to 2026-11-01; the gate step records each as an ADR in `docs/adr/`.

| decision | effect |
| --- | --- |
| The rebuild grows on its own branch, `rebuild`, as one draft PR into main, one commit or a few per step. It is rebased onto main whenever main moves. Main keeps today's code, takes fixes and releases at the owner's call. | the oracle judges against the commit `rebuild` sits on, and each rebase ports main's new fixes; this plan ends with the draft PR, the merge comes later ([where](rebuild.md#where)) |
| 1.0 runs on Node 24 and later only, as bpmnlint 12 asks; every workflow runs Node 24 alone. | `engines` becomes `>=24`, the CI job on Node 22.12 goes, and the migration note says so ([gate](rebuild.md#4-gate)) |
| The oracle judges the layout as main's gate does today: the total over the 115 scenarios and the total over the walk steps score no higher than main's. | a single file or step that scores higher is listed, not failed, as the fuzz's `--hard warn` lists hard defects ([oracle](rebuild.md#oracle)) |
| The Camunda checks stay bpmn-cli's own code. The experiment [#123](https://github.com/Miragon/bpmn-cli/pull/123), which runs them as bpmnlint rules, and plugin [#113](https://github.com/Miragon/bpmnlint-rules/pull/113) stay open; 1.0 does not need them. | each Camunda rule stays a class over the moddle object, so bpmnlint can run it later ([triggers](#triggers)) |
| Project lint happens only in `bpmn validate`, on bpmnlint 12 as in the blueprints' CI, in the private package `packages/lint`. | a write runs no project lint; lint imports nothing of the core and can be published as it is ([lint package](modules.md#lint-package)) |
| When a project installs a bpmnlint plugin that bpmn-cli also ships, such as `@miragon/bpmnlint-plugin-rules`, the project's copy runs; bpmn-cli's copy runs only when the project has none installed. Today bpmn-cli's copy answers first (`ChainResolver.ts:30`), so `bpmn validate` can pass a file that the project's CI, on a newer plugin, fails. | `bpmn validate` lints like the project's CI; a test compares lint with bpmnlint 12's CLI on the blueprints' configs ([lint package](modules.md#lint-package)) |
| Shapes bpmn-cli creates get the bpmn-js size, the size bpmnlint's `standard-size` checks: 100 by 80 for a task, 50 by 50 for a gateway, 36 by 36 for an event. A shape never grows for what it carries. | a new shape no longer copies its neighbours, a task never widens; `ShapeSizes`' test holds the table to the rule, and `test/corpus/` runs the rule over every drawn model ([shape sizes](modules.md#shape-sizes)) |
| bpmn-cli has no workaround for an antipattern: it draws and edits by the standard, and a check or the layout score shows what is off. | the three workarounds of today go: a task widened for three boundary events, a new shape sized like hand-drawn neighbours, a boundary event pushed over the corner ([behaviour that goes](cli.md#behaviour-that-goes)) |
| The docs are reworked for 1.0, and `docs/architecture.md` becomes a compact map: per module what it does, what it holds, why it exists and what it deliberately does not do. | it carries the modules table on when `docs/plan/` goes, in a fixed shape that an agent check can later compare with the code ([architecture doc](modules.md#architecture-doc), [triggers](#triggers)) |
| render and lint stay private packages until someone outside bpmn-cli needs one; esbuild builds them into what bpmn-cli ships. | no second release line and no exact pin before 1.0; publishing one later changes no code ([packages](modules.md#packages), [triggers](#triggers)) |
| Where a consumer reads something 1.0 drops, the consumer adapts along its map; bpmn-cli keeps it only when a consumer cannot do without it or it costs bpmn-cli nothing. | design-iq lists `validateXml`'s findings in its own `validate_bpmn` and drops the layout mode; bpmn-cli keeps the host validator phases and `validate`'s layout dry run ([contract](modules.md#contract)) |
| ask-miragon moves from 0.5.0 to 1.0 after the release, as a follow-up. | the contract keeps what its [map](modules.md#contract) needs |
| #123's 321 parity models go into `corpus/engine/`: synthetic, one per rule case, the cases of main's Camunda check tests written as files. | #123's tests build each model from template strings at run time, so the checks step runs them once on its branch and writes each model out |
| Operations are parsed strictly, as today: a key an operation does not take is refused, never dropped. | a batch or design-iq call that still sends `"timer": "P2D"` on `add` answers `E_USAGE` with the keys `add` takes, as today, instead of a timer event without its timer; no table keeps retired inputs ([operations](layers.md#operations-each-operation-defined-once)) |
| A flag says where an element goes, what is made with it (its id, the flow into it, a lane's members) and how the command runs; what the element holds is a `key=value`, with the keys of `bpmn set`. | `add` and `retype` lose their event flags, `connect` its `--name` and `--condition`, `layout` its `--expand` and `--collapse` ([flag or key](flags.md#flag-or-keyvalue)) |
| The layout score is a module of its own, `scoring`, below drawing: a `Scorer` runs one `ScoringCriterion` class per problem or group of problems; it imports only model and render's `./text`, and only drawing, write and views import it. | the 115 layout scenarios run in drawing's tests from `corpus/layout/`; `tools/layout-regress.mjs` and its second copy of the analysis go ([layout score](modules.md#layout-score)) |
| Each read answers one question: `show` describes the model or one element, `find` lists ids, `diagram` judges the drawing, `conventions` names the id patterns. A flag narrows an answer, never changes its shape. | `find` stays a command; `metrics` and `show --layout` become `diagram`; `ext list` and `--context` go into `show <id>` ([reads](cli.md#how-the-reads-answer)) |

## Steps

Each step is one commit or a few in the draft PR. Its card on the [rebuild page](rebuild.md#steps) says what is there today,
what is there after, which files it touches and when it is done; steps 1, 16 and 17 say it here.

### Before the rebuild: the judge

- [ ] **1. Branch**: branch `rebuild` off main at 089ba05 and open it as a draft PR into main, without a
  ruleset, since each rebase force-pushes it · done when the draft PR runs the gate
- [ ] **2. Naming subpath**: publish `./naming` from `@miragon/bpmnlint-plugin-rules`, the one change
  outside the draft PR · [card](rebuild.md#2-naming-subpath)
- [ ] **3. Oracle** · needs 1 · [card](rebuild.md#3-oracle)

From here main takes fixes only; each rebase brings them in ([where](rebuild.md#where)).

### The packages: render and lint

- [ ] **4. Gate**: clear `rebuild` and set the guardrails · needs 3 · [card](rebuild.md#4-gate)
- [ ] **5. Render**: build `packages/render` · needs 4 · [card](rebuild.md#5-render)
- [ ] **6. Lint**: build `packages/lint` · needs 4 · [card](rebuild.md#6-lint)

Done when render draws the corpus in Node and in a browser bundle, and lint's oracle entry gates.

### The core: 1.0.0-rc.1

- [ ] **7. Model** · needs 2, 4 · [card](rebuild.md#7-model)
- [ ] **8. Operations** · needs 7 · [card](rebuild.md#8-operations)
- [ ] **9. Checks** · needs 7 · [card](rebuild.md#9-checks)
- [ ] **10. Scoring** · needs 5, 7 · [card](rebuild.md#10-scoring)
- [ ] **11. Drawing** · needs 8, 10 · [card](rebuild.md#11-drawing)
- [ ] **12. Edit** · needs 8 · [card](rebuild.md#12-edit)
- [ ] **13. Write, views and api** · needs 9 to 12 · [card](rebuild.md#13-write-views-and-api)
- [ ] **14. CLI, ship rc.1** · needs 6, 13 · [card](rebuild.md#14-cli-and-rc1)

Done when every probe is green outside the allow-list and rc.1 is on `next`.

### Done: the draft PR

- [ ] **15. Skill, evals and docs** · needs 14 · [card](rebuild.md#15-skill-evals-and-docs)
- [ ] **16. Consumers**: try design-iq and the skills of bpmn-to-code on the release candidate, each in a
  branch of its own · needs 15 · done when design-iq's branch is green in its CI and bpmn-to-code's
  skills use `find` and `show <id>`
- [ ] **17. Ready**: rebase onto main's head and check the [done](rebuild.md#done) criteria · needs 16 ·
  done when they hold

Merging the PR and shipping 1.0.0 come after this plan ([later](rebuild.md#later)). Follow-up after 1.0:
ask-miragon moves from 0.5.0 to 1.0 along its [map](modules.md#contract).

## Triggers

1.0 does without these until the event happens.

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

Today's layers: [architecture.md](../architecture.md). Gate: [testing.md](../testing.md).
