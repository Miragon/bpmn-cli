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

Made from 2026-10-30 to 2026-11-01; each is an ADR in `docs/adr/`.

- [1. Rebuild on one branch, one draft PR into main](../adr/0001-rebuild-on-one-branch.md)
- [2. Node 24 and later only](../adr/0002-node-24-alone.md)
- [3. The oracle judges the layout by totals](../adr/0003-oracle-judges-layout-by-totals.md)
- [4. The Camunda checks stay bpmn-cli's own code](../adr/0004-camunda-checks-stay-our-code.md)
- [5. Project lint runs only in `bpmn validate`](../adr/0005-project-lint-only-in-validate.md)
- [6. The project's copy of a bpmnlint plugin runs](../adr/0006-the-projects-plugin-copy-runs.md)
- [7. New shapes get the bpmn-js size](../adr/0007-shapes-get-the-bpmn-js-size.md)
- [8. No workaround for an antipattern](../adr/0008-no-workaround-for-an-antipattern.md)
- [9. Rework the docs, with a compact architecture map](../adr/0009-compact-architecture-doc.md)
- [10. Render and lint stay private packages](../adr/0010-render-and-lint-stay-private.md)
- [11. Consumers adapt to what 1.0 drops](../adr/0011-consumers-adapt.md)
- [12. ask-miragon moves after 1.0](../adr/0012-ask-miragon-moves-after-1-0.md)
- [13. #123's parity models go into the corpus](../adr/0013-parity-models-go-into-the-corpus.md)
- [14. Operations are parsed strictly](../adr/0014-operations-parse-strictly.md)
- [15. What a flag says, and what a key says](../adr/0015-flag-or-key-value.md)
- [16. The layout score is a module of its own](../adr/0016-scoring-is-a-module.md)
- [17. Each read answers one question](../adr/0017-each-read-answers-one-question.md)

## Steps

Each step is one commit or a few in the draft PR. Its card on the [rebuild page](rebuild.md#steps) says what is there today,
what is there after, which files it touches and when it is done; steps 1, 16 and 17 say it here.

### Before the rebuild: the judge

- [ ] **1. Branch**: branch `rebuild` off main at 089ba05 and open it as a draft PR into main, without a
  ruleset, since each rebase force-pushes it · done when the draft PR runs the gate
- [ ] **2. Naming subpath**: publish `./naming` from `@miragon/bpmnlint-plugin-rules`, the one change
  outside the draft PR · [card](rebuild.md#2-naming-subpath)
- [x] **3. Oracle** · needs 1

From here main takes fixes only; each rebase brings them in ([where](rebuild.md#where)).

### The packages: render and lint

- [x] **4. Gate**: clear `rebuild` and set the guardrails · needs 3
- [x] **5. Render**: build `packages/render` · needs 4
- [x] **6. Lint**: build `packages/lint` · needs 4

Done when render draws the corpus in Node and in a browser bundle, and lint's oracle entry gates.

### The core: 1.0.0-rc.1

- [x] **7. Model** · needs 4; step 2 still open, so model keeps the naming defaults as data
- [ ] **8. Operations** · needs 7 · [card](rebuild.md#8-operations)
- [ ] **9. Checks** · needs 7 · [card](rebuild.md#9-checks)
- [x] **10. Scoring** · needs 5, 7
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
