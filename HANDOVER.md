# Handover, 2026-10-13 (after step 1 of the audit fixes, the Camunda 7 step and its follow-ups, step 2: bpmn-cli as design-iq's editing engine, step 3 round 1 with its fixes and follow-ups: views, speaking ids, layout ergonomics, Camunda 8, stages 1 to 3 of `bpmn render` with the fixes after its verification (#12), the profile rules loaded on demand (#13), stages A and B of the incremental layout of edits to hand-drawn models (#18), the removal of the design profile (#35), ids up to 64 characters cut at whole words (#31), flow ids kept on request (#32), the project's bpmnlint configuration (#33), the id conventions of its element-id-naming (#34), @miragon/bpmnlint-plugin-rules 0.12.1, decision links in the file's spelling (#42), the E_VALIDATION advice that reads the refusal, flows that follow every end change, an alias through a retype with a typed split's input checked, the move fixes after #32, the note when BPMN_KEEP_FLOW_IDS kept the flow ids, a write's count of what bpmnlint leaves out, the .bpmnlintrc reloaded after later installs and found through linked directories, group boxes drawn again by a full redraw, the id forms fixed before 0.7, a file's flow form that stays put, DI ids within 64 characters that follow `set id=`, and the stale edges of flows whose ends changed)

State of `bpmn-cli` and what to do next. Everything below is verified against
the code in this repository, not from memory.

## Where it stands

A CLI that lets an AI agent edit BPMN 2.0 models semantically. The agent names
elements by id and changes kinds, names, flows, triggers, lanes, pools,
properties and vendor extensions; it never sees or writes diagram interchange.
Every mutating command runs the same pipeline: load, apply operations,
validate, lay out, write atomically; the write keeps the text of everything
the change did not touch, and a result equal to the file is not written. The
same pipeline runs in the browser on strings (`@miragon/bpmn-cli`:
`applyToXml` and friends; the file helpers are `@miragon/bpmn-cli/node`), with
a host's own validators inside the transaction.
`validate` (and every write) runs the engine profile of the file's platform:
Camunda 7 (`W_C7_*`) or Camunda 8 (`W_C8_*`), each rule checked on the
engines; the rules of each platform load on demand (a chunk of their own in
a host's bundle). Elements are addressed by id only; new ids speak (names, kind +
place, the ends of a flow) in the file's id style (where the project's
`.bpmnlintrc` runs `element-id-naming`: in its prefixes and case), and an `apply` batch
names what it creates with aliases (`"as": "$name"`); a flow whose id names
its ends follows them, unless flow ids are API and kept (`--keep-flow-ids`,
`BPMN_KEEP_FLOW_IDS=1`: `W_FLOW_ID_STALE` names the stale ones). An agent reads a
large model through `show --around <id>` and `show <id> --context`, and a
write reports the warnings it added, not the file's old ones (`--summary`
for a few lines). A hand-made diagram is kept (new elements
are placed locally, like the modeler's space tool; a batch like the same ops
sent one by one; a new branch or boundary path takes a row that crosses no
line, opening one under its anchor or going above it, and a crossing left is
repaired once more), a new file or an
engine-owned drawing is redrawn by the built-in engine, and the agent formats
the picture with commands that name elements (`place`, `align`, `color`,
`label`, `route`, `space`, `tidy`, `compact`, `order` of lanes and pools;
selectors `--path`, `--kind`, `--branch`), and looks at it with `bpmn
render` (a PNG or SVG of the diagram, no browser: crops such as `--around`,
halos, the layout problems numbered in the image, tiles; `--render <png>` on
any mutating command draws its result). The format-command idea
comes from Miragon/design-iq PR #218 (`@bpmiq/bpmn-edit`, ADR 0008); no code
was copied, the concepts were re-implemented here.

```
npm install && npm run build
npm run gate            # build, 2201 tests (+246 opt-in engine tests), isomorphism check with bundle budgets, layout-regression budget, short fuzz campaign
npm run typecheck
node tools/layout-regress.mjs   # FILES 115 SCORE 444 (budget in tools/bench/regress-budget.json)
node bin/bpmn.js guide --short  # the cheat sheet an agent reads first (`guide` for all of it, `guide <topic>` for one section)
```

An audit in October 2026 (eight streams, about 60,000 mutations) confirmed 77
bugs; [docs/audit-2026-10.md](docs/audit-2026-10.md) has the table with the
current status of each, and [docs/testing.md](docs/testing.md) how to run every
test layer, the benchmark and the fuzzer.

## Stale edges of flows whose ends changed (2026-10-13, `fix/stale-edges-of-re-ended-flows`, follow-ups of #32)

Under `--no-layout` a flow whose ends an op changed (a bridge, the flows of
a move, a `set source=`) kept its BPMNEdge at the old ends, with
`--keep-flow-ids` without any note; a second BPMNDiagram of the same
process kept such edges after every write; and no later write repaired
them: `brokenEdge` tolerated the end gap an edge had before, so an edge
already off its ends never counted as broken, and no metric showed it.

- **`--no-layout`** (`src/pipeline.ts` skip path; `changedEnds` /
  `pruneReEnded` in `src/diagram/incremental.ts`; `pruneEdges` in the prune
  section of `src/diagram/write.ts`, nothing else there, so the rebase onto
  the DI-id PR stays local): the BPMNEdge of a sequence or message flow
  whose ends differ from the snapshot goes, in every diagram and both
  modes. Ends are compared by the id they have now: `set id=` and a retype
  (also retype + `set id=` in one batch: `successorOf` in `src/result.ts`)
  are no end change. An edge stays when its end points already reach the
  shapes of the new ends (within 10 px: a node added and removed again
  under `--no-layout` gives the input's DI back, and an engine drawing
  stays engine-owned), and on the root's first diagram while a new end has
  no shape (a splice of a node the same write added: the next write places
  it and routes the flow). The note counts and names the flows:
  `removed 3 stale diagram element(s), among them the edge(s) of Flow_AToB,
  Flow_BToC, Flow_CToDone (their ends changed; the next model edit without
  --no-layout draws them, or \`bpmn route <file> <flowId>\`)`.
- **`route` draws a missing line** (`drawnEdge(..., draw)` in
  `src/diagram/ops.ts`): a sequence or message flow without a BPMNEdge
  whose two ends are drawn on one plane gets one (before: `E_NO_SHAPE`, the
  same for a flow added with `--no-layout`). The `E_NO_SHAPE` hint of a
  flow, the catalogue entry and the note name `route` and the next model
  edit before `bpmn layout <file>`. `color` / `label` on such a flow still
  refuse (`E_NO_SHAPE`); format-only writes do not draw missing edges.
- **Further views** (incremental step 1): the same edges go from a second
  BPMNDiagram of a root (it is never drawn), with a layout note.
- **Detached edges heal** (`detachedEnds`, `DETACHED_GAP` = 10 in
  `src/diagram/reroute.ts`): a connection whose first or last waypoint lies
  more than 10 px outside its end's shape counts as broken whatever it was
  before. The incremental layout reroutes it with a note (`Flow_X routed
  again: it did not reach Activity_C`), and so do the format commands that
  change the geometry; that also catches flows a `tidy` / `place` left 11
  to 30 px off an event or gateway (`endGaps` tolerates half a round
  shape's width). Not on a plane with vertical pools or lanes:
  `brokenEdge(..., { detached: false })` there, since the incremental
  layout may route nothing on such a plane and a rename would otherwise be
  a full horizontal redraw (auto) or `E_LAYOUT_INCREMENTAL`.
- **Metric `detachedEdge`** (`src/diagram/metrics.ts`): the same rule as
  an EXTRA kind of weight 10 (hard), ids `[edge, end shape(s) it misses]`,
  located at the missed end point. The harness has no such kind: SCORE
  stays 444.
- Bundle budgets (`tools/iso/budget.json`, measured after the rebase onto
  #58 and #59): the PR adds about 4 KB minified / 1.3 KB gzip (pruning,
  `route` drawing a line, the metric, hints). The whole entry goes
  958.7 / 306.1 -> 962.7 / 307.4 KB, within #58's gzip budget of 309 but
  over its 960 KB minified; `applyToXml` only goes 678.3 / 216.8 ->
  681.8 / 218.0 KB, over 679 / 217. Raised to measured + 1 %: the whole
  entry's minified budget 960 -> 972 KB (gzip stays 309), `applyToXml`
  only 679 / 217 -> 689 / 220 KB.

Evidence (origin/main ef14c4d as the baseline):

- 11 new tests; 9 fail on origin/main (the splice test only because
  `detachedEnds` is new), and the retype + `set id=` and add + remove tests
  pin origin/main's behaviour, which the first version of this change broke
  (found in review): `test/keep-flow-ids.test.ts`
  (keep-mode move under `--no-layout`, the next write),
  `test/diagram-incremental.test.ts` (a bridge; `route` after and within a
  `--no-layout` batch, `color`'s refusal naming route; add + remove under
  `--no-layout` gives the input back; a splice to a new node; an edge
  150 px off its ends healed, tidied, kept by `--no-layout`),
  `test/diagram-incremental-robustness.test.ts` (a second view; vertical
  pool with a detached edge keeps the drawing on a rename; retype + `set
  id=` keeps both views' edges), `test/step1-diagram.test.ts`
  (`detachedEnds`, the metric).
- Differential (same edits in process on both builds, 159 repository files
  with a task: rename, add, timer path, split, remove, move, tidy, retype +
  `set id=`, and `--no-layout` add / remove / move / retype + `set id=`):
  every difference is in one class. The 14 scenarios whose edges are already
  off their ends (agent__anno*, agent__claim*, artifacts__*) heal on every
  write; `--no-layout` remove / move drop re-ended edges (143 / 114 files);
  14 runs differ only in the note's `<file>`; twoviews.bpmn loses re-ended
  edges in its second view; two `tidy` runs (gallery.bpmn,
  lanes__complaint-t1) reroute an edge the tidy left 14 / 18 px off an
  event. Retype + `set id=` is identical on every file without a detached
  edge, with and without layout. `route` on 634 drawn flows: identical.
  Private corpus (325 files, counts only): identical on the 324 files
  without a detached edge for every layout edit; the one with a detached
  association heals; one `tidy` reroutes a flow it left 30 px off a
  gateway; `--no-layout` drops re-ended edges (323 removes, 268 moves);
  `route` draws the line of 3 flows that had none (origin/main:
  `E_NO_SHAPE`).
- `layout-regress --compare`: SCORE 444, 0 better, 0 worse.
  `speaking-ids --baseline`: 570 / 570. `roundtrip`: no-op identical
  155 -> 142 of 164 and rename (layout auto) p90 2 -> 18 lines, all on the
  14 stale scenarios (a no-op heals them, like missing DI is completed);
  `--no-layout` no-ops 164 / 164.
- Bench against the baseline: `RESULT: no regression`; the 101 models
  without a detached edge give the same records; the 14 stale ones heal
  (mean harness delta -1.9 -> -14.1, tidy hard 55 -> 47).
- Fuzz, 80 walks x 25 steps, seed 11, auto and incremental: 0 errors; the
  baseline gives 4 `hard:detachedEdge` (`place` leaving flows off a gateway
  or event), this build none; the 2 `hard:frameIntrusion` are the same.
- Write time, interleaved medians: 15 incremental and `--no-layout` writes
  on 5 repository models 215.7 -> 213.4 ms (a second run 219.6 -> 221.2);
  generated 120 / 300 node models 691.4 -> 693.6 ms (+0.3 %): noise.
- After the rebase onto #58 and #59 (origin/main f492f7c as the baseline):
  2201 tests; the same edits on 166 repository files with a task (rename,
  add, remove, move, tidy; `--no-layout` add / remove / move) fall into the
  same classes: 15 files with lines off their ends heal on every layout
  write (the 14 stale scenarios and #59's fixture pool-branch-7922.bpmn,
  whose F5 misses G); `--no-layout` remove / move drop re-ended edges and
  nothing else (159 / 143 files); twoviews.bpmn loses re-ended edges in its
  second view; nan.bpmn and nobounds.bpmn differ only in the note's
  `<file>`; the two `tidy` runs reroute the one edge they left off an event.
  `roundtrip`: no-op identical 159 -> 145 of 169, all 14 on those files;
  `--no-layout` no-ops 169 / 169. `layout-regress --compare`: 0 better, 0
  worse. Write time, interleaved medians of 25 rounds, two runs: 15 writes
  on 5 repository models 156.0 -> 152.6 and 160.5 -> 165.9 ms; 6
  incremental and `--no-layout` writes on generated 120 / 300 node models
  681.0 -> 684.3 and 683.8 -> 668.5 ms: noise (within 3.5 % either way).

Left for later:

- A pruned edge's colour, label position and DI id are not carried to the
  line the next write draws (documented in contract.md and migrating.md);
  carrying them would need the old DI kept somewhere across writes.
- `color` / `label` on a flow without a line refuse with a hint to `route`
  first; a format-only write does not draw missing edges.
- An edge another tool left detached in a further view, or on a plane with
  vertical pools / lanes, stays (`detachedEdge` reports it).
- `endGaps`' half-width tolerance for round ends is unchanged below 10 px.
- On the first diagram, retype + `set id=` in one batch still reroutes the
  node's flows ('ends changed' in `collectEdges` compares through
  `currentId`, which does not follow a retype); harmless, as on origin/main.
  Following `successorOf` in `currentId` would touch every pool / lane /
  host check there, so it was left out.
- The 14 stale scenario files are not redrawn: they are inputs as other
  tools write them.

## DI ids within 64 characters, and they follow `set id=` (2026-10-13, `fix/di-ids-within-64-follow-renames`)

Follow-ups of #31 and #32. A new drawing (a new file, a file without DI, DI
whose ids show no form) and its full redraws kept both engines'
`BPMNShape_<id>` / `BPMNEdge_<id>` / `BPMNPlane_<id>` / `BPMNDiagram_<id>`
uncut (73 to 76 characters for ids of 63 to 64), although #31 promised 64
for every id and docs/audit-2026-10.md said derived DI ids were cut; and
`bpmn set <file> <id> id=<new>`, the command `W_FLOW_ID_STALE` and
`W_ID_PREFIX_STALE` suggest, left `BPMNShape_<old>` / `BPMNEdge_<old>` /
`<old>_di`, which the automatic flow rename moves.

- **`src/diagram/write.ts`**: `restoreDiIds` no longer returns early
  without old DI. DI without an old id that is free gets
  `styledId(<file's style> ?? 'bpmn', kind, id)` (a plane or diagram
  `BPMNPlane_` / `BPMNDiagram_` + the root id cut, as `diIds()` already
  did), through `claimUnique`, given after every old id and with the ids
  that need no cut first, so a cut id never pushes an uncut one to `_2`.
  Old ids still win and are never cut. `styledId` has a `legacy` flag
  (passed to `cutAt`); `diStyleOf(diId, elId, kind)` (was `edgeStyleOf`,
  edges only) also compares the cut, the 0.6 cut and either with a
  collision suffix `_2`. `followDiIds(defs, el, old, id, ids)` moves each
  BPMNShape / BPMNEdge id of `el` derived from `old` to the one derived
  from `id` in the same style, `_2`, `_3`, ... when that is taken (as new
  DI gets its id); one already derived from `id` stays. A main diagram
  whose root changed (a pool added) counts its old ids as derived from the
  old root also when they were cut, now or as 0.6 cut them (`namesRoot`),
  so `BPMNPlane_<long processId, cut>` still follows the new collaboration.
  `MAX_DI` stays 61.
- **`src/layout.ts`**: the auto engine runs its second pass (parse,
  `restoreDiIds`, serialize) also without old DI when an id of the model
  is longer than 49 characters (`diIdsFit`); otherwise its XML is returned
  untouched as before.
- **`src/ops/set.ts`** `renameId` and **`src/ops/flows.ts`** `followEnds` /
  `followRenamedEnd` call `followDiIds`; the plane and diagram of a
  sub-process collapsed without a drawing (`src/pipeline.ts`
  `persistExpansionHints`) take `diIds()` ids. Planes and diagrams do not
  follow a rename (`set <process> id=` keeps `BPMNPlane_<old>`).
- **`src/ops/remove.ts`**: the DI a remove detaches gives its ids back to
  `doc.ids`, so in a batch `remove X` + `set Y id=X` takes `BPMNShape_X` /
  `X_di` as two commands do (before, the id still counted as taken and Y
  kept `BPMNShape_Y`).
- **Evidence**: 12 tests fail on origin/main and pass (test/conventions-di.test.ts:
  a fresh drawing with 52 to 64 character ids, flows named after long
  names, a collapsed sub-process and a 54-character process id under both
  engines, `_2` for two cut ids alike, the uncut id first, a pool added to
  a drawing of a 54- and a 61-character process id under both engines and
  both layout modes, a plane 0.6 cut, the collapse placeholder, the 0.6
  `BPMNEdge_Flow_Pruefung10To2030` after a splice and a `set id=`;
  test/keep-flow-ids.test.ts: `set id=` on a flow and a task in `_di` and
  `BPMN<Kind>_` files, with ids kept too, following the `W_FLOW_ID_STALE`
  hint now writes the very file the default rename writes, a DI id not
  derived stays and one whose new id is taken gets `_2`, a derived id with
  `_2` / `_3` follows, `remove` + `set id=` in one batch writes what two
  commands write (with and without `--no-layout`), and the comment inside
  the renamed element's DI element is dropped with the result's note); 1
  guard passes on both (an old DI id over 64 stays). Differential against
  origin/main, in process (layout, layout `--engine auto`, the file
  without DI drawn by both engines, `set name=`, `set id=` of a task and
  of a flow, also `--no-layout`, a splice, validate): the 164 repository
  files and the 635 files of the private corpus give the same JSON
  everywhere and the same XML except two classes: DI ids of ids too long
  for their room in a fresh drawing (repository 1 file, corpus 433, all
  cut, each new id within 64), and the renamed element's DI id after
  `set id=` (that DI element is then rewritten as bpmn-moddle writes it,
  as the renamed element itself already was; the text around it is
  byte-identical). Redraws of files with DI, `set name=`, splices and
  validate are identical (run again after the review fixes and after the
  rebase onto #56, against that main: the same counts). layout-regress
  444 -> 444 (BETTER 0, WORSE 0), roundtrip identical per file,
  speaking-ids identical.
- **Runtime**: in process, warm, both builds interleaved, sum of per-file
  medians of 9 runs over the 115 scenarios, against main after #56: fresh
  drawing clean 719.5 -> 726.8 ms, auto 2,678.3 -> 2,681.5 ms, `set id=`
  1,499.5 -> 1,498.1 ms (noise); with every id lengthened to 52 to 63
  characters the clean engine 823.2 -> 838.5 ms and the auto engine
  2,794.2 -> 2,958.1 ms (+6 %, the second pass, about 1.4 ms a file, only
  without old DI and with an id over 49).
- **Bundle**: whole entry 957.7 -> 958.7 KB minified (305.7 -> 306.1 KB
  gzip), `applyToXml` only 677.6 -> 678.3 KB (216.6 -> 216.8 KB), measured
  after the rebase onto #59 (docs/library.md's table has the new sizes).
  The whole entry's gzip budget is raised 306 -> 309 KB (measured + 1 %):
  #59 brought it to 305.7 KB, and this change's +0.4 KB (`followDiIds`, the
  cut of new DI ids, the auto engine's second pass) passes 306. The other
  budgets stay (960 KB minified; 679 / 217 KB for `applyToXml` only).
- **Left**: DI ids a file already has over 64 characters stay (an id is
  never renamed by a redraw); planes and diagrams do not follow `set id=`
  of their root.

Left for later (low finding of the review, not fixed here):

- `set id=` writes the renamed element's DI element anew, as bpmn-moddle
  writes it (attribute order, `/>`, numbers such as `240.0` -> `240`), and
  drops a comment inside it (the result's note counts it), as the renamed
  element itself already was on main: `src/preserve.ts` pairs elements by
  id, so a renamed one counts as removed and added. docs/migrating.md and
  docs/reference.md say so, a test pins the note. Pairing the one unpaired
  sibling of the same tag on each side would keep both texts, but
  preserve.ts sees text only: a `remove` plus an `add` of the same kind
  among the same siblings would pair as well and carry the removed
  element's comments into the new one. Doing it right needs the batch's
  renames (element and DI ids) handed to `preserveText`, which runs through
  `src/document.ts` and the pipeline; a change of its own, with a
  differential over every `set id=`.

## A file's flow form stays put (2026-10-13, `fix/flow-style-vote`, follow-ups of #31 and #32)

Four follow-ups of #31 ("Left for later") and #32 ("Left out, for later"):
in files whose flows mix prefixes, or number them glued (`f3`, `flow12`),
the learned flow style tipped after a few edits or a move, and flows named
under the losing prefix stopped following their ends, by default and with
ids kept (where a followed `W_FLOW_ID_STALE` hint then named its ends no
more). All in `src/idstyle.ts` (`learn`, `basesOf`); `idNamesEnds` only
passes the flow id to `derivedBases`.

- **bpmn-cli's glued flows vote** (`GLUED_NAMED`, `FlowVotes.gluedNamed`):
  a flow without `_` named by its ends after a glued numbered prefix
  (`fPackToWeigh` next to `f1`; the longest such prefix followed by an
  upper-case letter or a digit) votes `numbered` for that prefix; with a
  suffix (`GLUED_SUFFIXED`) it now votes for the prefix too, and still
  counts only where the file has glued numbered flows. In a snake_case or
  Pascal_Snake body bpmn-cli's glued flows have a `_`
  (`fweigh_parcel_to_label_parcel`, `fWeigh_Parcel_To_Label_Parcel`):
  a flow with `_to_` / `_To_` (`GLUED_JOINED`, `FlowVotes.joined`) waits
  until the glued prefixes are known and votes for one where it is the id
  bpmn-cli gives its ends after it (`gluedJoinedOf`: uncut, cut, as 0.6
  cut it, with `_2`, or naming its source whole, so a spliced flow whose
  id was kept still votes); every other one counts as before. Before, such
  flows counted against the form: polish-rename.bpmn read as `Flow_` after
  five adds, and the sixth named `Flow_ArchiveTo...` and kept
  `fBillToShipTheGoodsToTheCustomer` on Archive -> C (the snake_case file:
  the sixth renamed `farchive_order_to_event` to
  `Flow_archive_order_to_close_case`).
- **Ties between forms and prefixes never go by document order**
  (`Tally.top(min, prefers)`, `FORM_ORDER`): a tie between forms goes to
  the one that names the ends, between a form's prefixes to the one more
  flows use (`uses`: `any` plus the glued numbered flows and the glued
  flows that voted for a prefix, so `f1, f2` against `sf_1, sf_2` is a
  tie), then to the alphabetically first; `any` alphabetically. Before, the
  first one counted won, so a move that declared a flow elsewhere flipped
  F / G (seeds 9473, 7922). A tie between the scopes of scopedTo flows and
  the element prefix tallies keep the first one counted, as before (a
  scope tie is a file of one prefix and one form, whose conventions must
  not change).
- **Flows follow under every prefix and form the file's flows use**
  (`Learned.flowStyles`, `otherStyles`, `connectionBases`, `mayBeOf`):
  `derivedBases` lists the bases of the winning style and of every other
  one (`named` under each flow prefix with its separator, each form built
  from the ends under the prefixes that voted for it, scopedTo per scope;
  replaces `namedPrefixes`). Given the flow id, it computes only the styles
  the id can be of (it starts with their head, prefix and a scopedTo
  flow's scope, or with `Flow_` where the head is 40+ characters), so a
  file of many prefixes or scopes costs a string test per style. A renamed
  flow takes the winning style's id (a flow under another scope: the scope
  new flows there take).
- **0.6's scoped flows cut to an empty target word vote** (`SCOPED_CUT`,
  `legacyScopedCut`): `Flow_KotO_WarenwirtschaftssystemabgleichTo` (with a
  glued suffix or none) votes scopedTo where it is the base 0.6 wanted for
  its ends; four of them no longer switch a file of three uncut ones to
  named `Flow_`.
- Tests: `test/conventions-ids.test.ts` (polish-rename's six adds; the
  same walk in a snake_case and a Pascal_Snake body, also eight adds with
  ids kept; the flow12 test tightened by three more commands and a splice;
  glued votes only for a matching glued prefix, also with `_`; ties both
  ways, with SequenceFlow_ / Flow_ hashes, a glued against a `_` prefix and
  two forms under one prefix; a flow under the outvoted prefix and an
  idPair flow under an outvoted form renamed, with ids kept
  `W_FLOW_ID_STALE`; the 0.6 scoped file and a look-alike that does not
  vote; a scope tie that keeps the first scope, and a flow under the other
  scope that follows its ends), `test/keep-flow-ids.test.ts` (the five
  recorded follow-hint seeds 1003, 9456, 9473, 7392, 7922 as fixtures in
  `test/fixtures/mixed-styles/`, and 9456's default-mode drift); the guide
  pin in `test/step3-ids-report.test.ts`. 14 of them fail on origin/main,
  and so does the guide pin; the scope-tie test pins origin/main's scope
  (fixture `mixed-styles/scope-tie.bpmn`).
- Differential against origin/main (ef14c4d): `show --conventions --json`
  on the 163 distinct fixtures and scenarios differs in one file
  (`step1/nested.bpmn`: H1, H2, G1-G3, F1-F3, G and F tied, G declared
  first: now F); no file whose flows use one prefix and one form differs.
  3,226 single-op batches (both modes): 22 differ, 16 on nested.bpmn and 6
  on scope-tie.bpmn (a flow under the scope that lost the tie is renamed
  after its new ends, with ids kept `W_FLOW_ID_STALE`; main left it naming
  its old ends). 648 walks of eight adds each: 26 differ, 20 in five glued
  files (the three `polish-*.bpmn`, two of the new fixtures), where the
  branch keeps `f` (main switched to `Flow_` after five to seven adds), 4
  on nested.bpmn and 2 on scope-tie.bpmn (as above). The classes that may
  differ: mixed-prefix files with tied prefixes, glued numbered files,
  files with two tied forms under one prefix (now the form that names the
  ends: two hashes and two idPair flows give idPair new flows instead of
  `Flow_<A>To<B>`; no fixture has one), and scopedTo files with several
  scopes (renames only). `tools/speaking-ids.mjs --baseline`: the same 20
  renames on both builds, 2 flow prefixes differ (nested.bpmn);
  `tools/roundtrip.mjs` identical; `layout-regress --compare` 0 better, 0
  worse. The recorded hint cases: 0 'NOT NAMING after follow' (5 on main).
  A keep-mode campaign (4,832 random ops on fixtures and scenarios, every
  hint followed): 0 followed ids that stop naming their ends (11 on main),
  2,120 hints (2,072).
- Runtime (CPU medians, interleaved rounds): `IdStyle.infer` on 300 flows
  unchanged (stemTo 6.1 / 6.3 ms, named 13.5 / 13.5, glued 1.8 / 1.7,
  mixed 1.9 / 2.1; a snake_case glued file 3.7 -> 1.9, snake_case
  `flow_a_to_b` flows next to `f1`, each one checked, 2.0 -> 3.2, snake_case
  without glued flows 2.0 / 2.1); `derivedBases` per flow on single-style
  files unchanged (named 44 / 42 us, glued 41 / 40), stemTo 79 -> 87 us
  (one more 0.6 base for the `named` style), three flow prefixes 44 -> 64
  us, a scopedTo chain with 3 / 12 / 30 scopes 37 -> 53, 44 -> 69, 53 -> 81
  us (each scope tested by its head: before that filter 629 us at 30); 60
  splices on a 200-flow chain 147 -> 149 ms (ids kept 155 -> 151), within
  noise.
- Bundle: whole entry 955.0 / 304.7 -> 957.7 / 305.7 KB, `applyToXml` only
  675.0 / 215.5 -> 677.6 / 216.6 KB (minified / gzip); within the budgets
  (960 / 306, 679 / 217), unchanged, but the gzip headroom is now 0.3 and
  0.4 KB: the next PR that adds code to the entry will likely have to raise
  them; `docs/library.md` updated.

Left for later:

- A file whose glued numbered flows were all renamed away (no `f3` left)
  has no prefix for its `fAToB` flows to vote for: they count for nothing
  and the file reads as `Flow_` (the vote needs the numbered evidence; a
  run of lower-case letters alone would read bare camelCase flow ids as
  prefixes).
- A tie between element prefixes (per kind and family), and one between
  the scopes of scopedTo flows, still goes to the first one counted, so a
  move that declares flows elsewhere can change the scope of new flows
  where two scopes tie (kept: such a file's conventions must not change).
- A glued flow in a snake_case / Pascal_Snake body votes only where it
  names its ends or its source (`gluedJoinedOf`); one whose source a move
  or a bridge changed while its id was kept counts for nothing, where a
  camelCase one votes by its shape alone (`GLUED_NAMED`).

## Id forms before 0.7 (2026-10-13, `fix/id-forms-before-0.7`, follow-ups of #31 and #34)

Six follow-ups of #31 and #34 change the form of new ids, so they land
before 0.7.0 (release PR #43), which then ships them; #31's cuts and #34's
glued suffix were never released and need no compatibility, 0.6's ids are
recognised as before (the legacy paths and tests are unchanged). The user's
decisions: the letter word is `No`; a long head stays wherever the id fits
(Q3 a); the filler rule covers the 40-character name slugs too.

- **`No` before a glued collision number after a digit** (`withSuffix`,
  `isSuffix` in `src/ids.ts`): under a declared camelCase / PascalCase and
  in learned stemTo / scopedTo flows a taken base that ends in a digit gets
  `No2` (`serviceTask_step1No2`, `ServiceTask_Phase2No2`,
  `flow_checkOrderToSendPdf10No2`; before `serviceTask_step12`, which
  pushed the real Step 12 to `serviceTask_step122`). `IdStyle.next`,
  `Doc.regeneratedId`, the `W_ID_PREFIX_STALE` hint and a split's join use
  it; `idNamesEnds`, `flowForms` and `cutOfForm` accept `No` before the
  digits (`idNamesEnds` also for the former ends and labels a batch
  records since #46, `test/conventions-ids.test.ts`), glued digits stay
  accepted (0.6's `...Pdf102` follows). The real element-id-naming rule
  passes the new ids (`test/conventions-lint.test.ts`).
- **No filler word at the end of a cut** (`isFiller`, `cutName`; `endForms`):
  a cut flow end gives up a filler word (und, oder, an, die, the, of, ...;
  a fixed German / English list) that a given-up word leaves last or before
  its Join / number tail, and the 40-character slug of a name and a body cut
  to its room drop one too (`Activity_LieferantenbestellungVersenden`, was
  `...VersendenUnd`). The first word stays, and so does a filler word
  between a number and the number tail (`StartAfter2Und2`; without that
  the cut fell back to a word cut inside, `...Lieferantenbestellungsueb2`);
  whole-id cuts (DI ids, joins) are unchanged; an uncut name that ends on
  one keeps it.
- **Numbers before a number tail stay** (`endForms`): a flow's end
  `zahlungseingang_2_2` never shrinks to `zahlungseingang_2` (another
  element's id; the suffix then skipped `_2`), so no flow skips a suffix.
  An element body that the 64-character cap ends on a number still skips
  the suffix its cut gives back, as on main (`<prefix>_auftrag_2_2`,
  `_2_3`): a guard that cut one more word instead gave the second
  "Auftrag 2 2" `<prefix>_auftrag_2`, the id of an element named Auftrag 2,
  and three equal names a mix of cuts; the review removed it.
- **A body keeps a letter; long element prefixes per id** (`withLetter`,
  `cutBody`, `leadOf`): a room that ends inside a leading number starts at
  the first word with a letter (`<prefix>_rechnung`, was `<prefix>_10202422024`;
  camelCase lower first); a file prefix of more than 52 characters (fewer
  than 8 left beside a `_99`) stays where the body's words up to its first
  word with a letter and no filler word fit whole, else `activity_...`, per
  id (`<55>_auftrag`, `activity_auftrag_2`; a 56+ prefix now keeps
  `<prefix>_gh`). For an unnamed element that lead runs to the anchor's
  first word (`afterCheck`, `timerOnReview`), so its id still names the
  anchor: `activity_afterCheckOrder` under a 56-character prefix as on main,
  not `<prefix>_after`, `<prefix>_after_2`, ... with `W_ID_SUFFIXED`.
- **The backing data object keeps its word** (`IdRequest.tailWord`,
  `backingRequest`): where references and data objects share a prefix and
  the name's 40 characters leave `Object` / `Store` no room, the word goes
  after the body (`processDataArtefactItem_lieferung_vollstaendig_object`,
  was `..._eingegangen_2` with a `W_ID_SUFFIXED` that named no collision),
  bare ids too. `<name> Object` counts only where its id still ends in the
  word: a name that ends on a filler word lost both to the cut
  (`..._variante` for "... Variante A"), and the next reference named
  "... Variante" took `_2`.
- **A long flow head stays where the ends fit** (`wholePair`, `wholeEnds`,
  `wholeIdFormBase`, `namedHead().long`): a flow prefix or scope that leaves
  the ends fewer than 16 characters stays where they fit at whole words
  (`Flow_<41-char scope>_ValidateToPack`, was `Flow_Validate_To_Pack`), else
  Flow_ as before. A suffix whose cut gives the head up gives the whole id
  the `Flow_` form with its `_2` (`Flow_Validate_To_Step1_2`; before the
  review `Flow_<scope>_ValidateToStep1_2`, a form the learner does not read
  back). `show --conventions` shows the file's head with `Flow_ where the
  ends do not fit`. One file can hold both forms; `derivedBases` lists both.

Evidence:

- `npm run gate` after the rebase onto 74c3b50 (#46 to #55): 2158 tests
  (+246 opt-in; 2149 on main), isomorphism check, layout regression 444
  (budget 444), fuzz 12 x 15 with 0 errors; `guide --short` 4,644 bytes,
  unchanged. Before the rebase (on 98fa834): `npm run roundtrip` and
  `tools/speaking-ids.mjs --baseline` (scenarios and fixtures) as on main.
- A differential against main (98fa834, before the rebase), classified per changed id by a
  trigger read off main's and the branch's ids (a local script, not
  committed): filler = main's id has a filler word right before an end
  boundary (the end, `To`, a number, a suffix, the next id of an idPair
  flow) where the rule drops it (not the first word of an end, not between
  two numbers, `To` itself no filler) and the branch's id has none there,
  or main's 40-character slug of a name in the edit was cut after one;
  No = `<digit>No<n>`; x22 = two numbers in a row; long element prefix =
  the head changed and one is over 52 characters, or main's body has no
  letter; data = a backing id that now ends in `Object` / `Store`, or a
  reference whose name it freed; long flow head = one id starts with the
  file's long head. The suffixed ids of a changed base take its class, a
  flow that names a changed element id that element's. Anything else, an
  id over 64 or a change of warnings alone is unexplained. The first
  version attributed changes by commit and took any filler word in the
  edit (`To` too) as the trigger, which held for every corpus edit; these
  counts replace it.
  - 512 BPMN files on disk (the fixtures, the scenarios and a private
    corpus, counts only), 11,892 edits (a task, a gateway, two unnamed
    tasks, a timer, long names, a splice, a leading number, two flows,
    Step 1 / Step 12, Auftrag 2 2, data, data names that end on a filler
    word; without and with the rule's defaults): 7,730 identical, 4,162
    different with 13,342 changed ids: filler 6,371, No 5,448, data 40,
    flows naming a changed id 1,483, unexplained 0; `show --conventions`
    identical on every file.
  - 372,000 synthetic request sequences (three ids each) in 31 file styles
    (long prefixes and scopes, bare ids, a shared data prefix, declared
    cases), with filler words and numbers: 77,200 differ (207,063 ids:
    filler 92,415, long flow head 80,597, long element prefix 24,750, No
    8,780, x22 521), unexplained 0; the filler trigger holds for 39 % of
    all sequences, changed or not. Without filler words and numbers
    (372,000): 32,707 differ, all of them long flow head (67,820 ids) or
    long element prefix (24,715) in those styles.
  - The first version found four slips (a bare-id data object, a number
    that ended a cut end held like a tail, the glued suffix after a head
    given up for Flow_, a filler first word kept a long element prefix);
    the review and the stricter one five more, fixed in the last commit:
    the unnamed lead, the data object after a filler word, the suffix
    form after a long head, the guard in `next()`, the filler word between
    two numbers.
- Runtime (in-process, CPU time medians, 98fa834 -> branch, two runs):
  `derivedBase` 12-13 -> 11-12 us, `derivedBases` 48 -> 50-51 us, three
  ids from `next()` 31 -> 30 us per request, `IdStyle.infer` on 300 flows
  (250 cut) 3.4-4.3 vs 2.9-3.5 ms, a splice write without layout 1.9 ->
  1.8 ms median.
- Bundle, on 74c3b50: whole entry 950.6 / 303.2 -> 955.0 / 304.7 KB,
  `applyToXml` only 671.8 / 214.4 -> 675.0 / 215.5 KB (minified / gzip);
  both fit the budgets (960 / 306, 679 / 217), unchanged;
  `docs/library.md` updated.

Left for later:

- The filler list is fixed and short (`ueber`, `nach`, `vor` are not in
  it: `Activity_BenachrichtigungUeber`); a number left before a dropped
  word (`...Und4`, c31-count-before-dropped-word) and an end that shrinks
  to a leading filler word stay as in #31.
- An element body that the cap ends on a number skips a suffix (above).
  A suffix that never reads as another name's id would need a word there
  (`No` is for glued suffixes only, Q1).
- A long element prefix kept for a base gives way in a suffixed id that
  leaves the lead no room: `<55>_auftrag`, then `activity_auftrag_2`,
  although `activity_auftrag` is free (the id still names Auftrag).
- A slug the filler rule frees of its last word can end on a number that
  #31's number tail then keeps at the cost of words in a small room
  (`<45>_user_task_2024` for a spelled "user task after ok 2024 und ...",
  main `<45>_user_task_after_ok`; `<50>_after2024` for "After Daten 2024
  zur ..."): the tail rule is #31's, the slug only shorter.
- A suffix cut that cuts a flow end inside a word does not know that the
  numbers before a number tail stay, and can drop one there
  (`..._kund_2024ToLieferante2` after the base `..._kunde_1_2024ToLieferan`).

## Group boxes over a full redraw (2026-10-13, `fix/full-redraw-keeps-groups`)

A full redraw (`bpmn layout`, `--relayout` / `--layout full`, an
engine-owned drawing in `auto` mode, the `W_LAYOUT_INCREMENTAL_FAILED`
fallback, `--engine auto`) dropped every group's BPMNShape without a word,
and the quality line called the lost box resolved overlaps (gallery.bpmn:
`score 182 -> 64; resolved: overlaps [Group_FirstTasks, Activity_UserTask],
...`). Now a redraw draws each group again around what its box held.

- **`src/diagram/groups.ts`** (new, browser-safe): `rememberGroups` records
  every drawn group before an engine replaces the DI (plane, box, label,
  members: shapes whose centre lay in the box, frames and groups inside
  whole, elements referencing its category value). `redrawGroups` runs after
  either engine, smallest group first (an inner group counts as a member of
  the outer one), appended in the old DI order; the old DI id comes back
  through `restoreDiIds`, colours through `applyColors`. The box: the
  members' new bounds with their boundary events and the labels that pull
  in no neighbour, 20 px around (40 above for a name), each side at most
  half-way to a shape that is no member or to the frame around the members;
  then whatever has its centre inside joins (a boundary event with its
  host), until nothing joins. Other groups' boxes play no part in the
  padding or the labels, so the order the groups are drawn in never changes
  a box; a box that holds a group drawn after it is measured again with it.
  So a redraw of the result changes nothing, and an edit to it finds the
  drawing engine-owned. A group with nothing drawn inside comes after the
  others and is no member of any: it keeps its box, or its size GROUP_PAD
  below the drawing when the redraw put a shape or label on the old box,
  and the layout block says so (`note: group <id> kept its box: ...` /
  `moved below the drawing: ...`). A group bpmn-auto-layout drew itself
  (members that reference its category value) is left alone;
  `GROUP_MEMBERS_NOT_FOUND` goes for the groups drawn here.
- **Clean engine**: the parts of a scope that no flow connects follow the
  first part of their group (`place.ts` `groupedOrder`,
  `PlaceOptions.groups` from `membersOf`). A part's group is that of the
  first of its nodes (declaration order, boundary events after their host)
  a box held, and the parts from a start event and from a node without
  incoming flow are one list, so groups of independent chains no longer
  swallow each other, also when a box held only the tasks or a chain has no
  start event; without groups the order is the old one. A
  collaboration-level group no longer reports `W_LAYOUT_DI_NOT_CREATED`; an
  association to a group says `an end is a group: its box is drawn after
  the layout` instead of "different diagrams".
- **Metrics** (`src/diagram/metrics.ts` and `tools/layout-regress.mjs`
  alike): a group is no leaf shape, so no overlaps, through or label on
  shape with a group (a group's own label still counts). The bench no longer
  excludes groups (`hardDelta` / `softDelta`, `addedGroup` gone); the
  fuzzer keeps `group:*` as warnings (rare now: the gate campaign 4 -> 0).
- **Review fixes** (before the PR): stacked groups (test/fixtures
  incremental/groups.bpmn) came out differently on a second redraw, since
  the padding stopped at a group box drawn earlier; an empty inner group
  kept at its old box stretched the outer group to it; a kept empty box
  could land on redrawn shapes (unstable, and the next edit found the
  drawing hand-made); a box around tasks only, or a chain without a start
  event, still let groups swallow each other; two overlapping groups needed
  a second redraw to settle; a boundary event could join a box without its
  host; `docs/migrating.md`, `docs/reference.md` (`notes` of a full
  redraw), `docs/commands.md` and the guide's `layout` summary did not say
  what changed. Each has a test now.
- **Evidence**: 16 tests (test/layout.test.ts "groups over a full redraw",
  15, and test/diagram-metrics.test.ts) fail on origin/main and pass.
  Differential against origin/main, in process (layout, layout `--engine
  auto`, a rename in `auto` mode, validate): the 159 repository files
  without a group and the 347 files of the private corpus without one give
  identical results; the 5 + 4 with a group differ by the redrawn boxes,
  the metrics and the wording of an annotation-to-group `DI_NOT_CREATED`
  only (their incremental edits write the same XML; every group they had is
  drawn again by both engines, a second redraw is unchanged and an edit
  after it runs `full`). layout-regress 444 -> 444 (BETTER 0, WORSE 0; no
  scenario has a group, the budget stays), roundtrip identical. Runtime: no
  measurable change. In process, warm (`layoutXml`, sum of per-file
  medians, both builds interleaved): the 115 scenarios 1,156.1 -> 1,159.2
  ms and 1,179.7 -> 1,183.1 ms in two runs (clean, +0.3 %, the noise of
  swapping the order), 3,512.1 -> 3,477.1 ms (`--engine auto`), the 5
  fixtures with a group 69.2 -> 69.8 ms; on gallery.bpmn remembering and
  redrawing its group take 0.08 + 0.09 ms.
- **Bundle** (measured after the rebase onto the merged follow-ups): whole
  entry 942.0 -> 950.6 KB minified (300.3 -> 303.2 KB gzip), `applyToXml`
  only 663.5 -> 671.8 KB (211.6 -> 214.4 KB gzip). `src/diagram/groups.ts`
  and the grouped order are in every `applyToXml` (a full redraw can run in
  any write), and both entries no longer fit main's budgets of 948 / 302 and
  670 / 214, so they are raised to 960 / 306 and 679 / 217, the measured
  size + 1.0 % (docs/library.md's table too).
- **Left**: the engine does not keep the members of one connected flow
  together, so a box around members the redraw spread out also takes in
  what lies between them (and holds it from then on), and its border can
  cut a shape that lies partly between them (a wide annotation; the padding
  itself never crosses one); an association between a text annotation and
  a group is still not drawn by a full redraw (the annotation goes above
  the drawing). Groups still cannot be created.

Left for later (low findings of the review, not fixed here):

- Two groups that overlap without one inside the other: a part held by both
  is keyed by the nested path of both, so the other group's parts do not
  follow it and one box can take in the other (five chains in the rows 2, 4,
  1, 5, 3 with Group_A on 2, 4, 1 and Group_B on 1, 5: Group_B ends up
  around everything). The redraw is stable now (one pass settles it), but
  keeping each group's parts consecutive needs an order in which every
  group's parts are adjacent (a consecutive-ones ordering) rather than a
  sort key, which is more than this fix; no repository or corpus file has
  such groups.
- A non-member that the members' own box overlaps (a wide annotation placed
  between two members) is cut by the border. Letting such a shape join
  would make the box grow over neighbours it never held, possibly in a
  cascade; the docs now say that the padding never crosses a neighbour but
  members spread apart can still overlap one.

## The .bpmnlintrc in long-running hosts and through linked directories (2026-10-13, `fix/lint-reload-and-linked-dirs`)

Follow-ups of #33. A library host (design-iq's live host) that followed the
`W_LINT_UNAVAILABLE` hint and installed the plugin kept saying "is not
installed" until it restarted; a model reached through a symbolic link from
outside its repository got no `.bpmnlintrc`, while git finds the repository;
and `bpmnlintEngine()` resolved none of the camunda-compat configs the
plugin's bundle lacks, which a `.bpmnlintrc` gets offline.

- **Reload** (`src/node/bpmnlint.ts`, `loadBpmnlint`): a cache entry keeps
  what the load depended on in the project besides the `.bpmnlintrc`'s text
  (`LoadDeps`, one `Dep` each): the packages the chain left out
  (`ChainResolver.reason`, not bpmnlint), the project modules that failed to
  load, and the moddle module paths the project answered or left out (not
  the plugin's camunda / zeebe descriptors). Each `Dep` holds its `depState`
  from before the load looked it up (`ChainResolver.first` before any tier,
  `boundedRequire` before the require, `moddleExtensionsOf` before the
  lookup), so a package that lands while the load runs is a change for the
  next call. `depState` is where Node resolves the spellings, plus the files
  Node's caches do not see: the nearest `node_modules/<package>` from the
  `.bpmnlintrc`'s directory up, its `package.json` and the path inside it,
  or a relative / absolute path itself, each as path, inode, size, mtime,
  ctime (npm extracts with the tarball's fixed mtime, so the inode and ctime
  count). Node remembers each resolution for the life of the process
  (`Module._pathCache`, returned without looking at the disk), so a package
  found above the repository stayed found there after the hint's install
  inside it: a reload first drops those entries of the old load's deps
  (`forgetResolutions`; the request and its subpaths). Node does not cache a
  require that threw, so a fixed plugin loads. A hit with nothing left out
  and no project descriptor checks nothing. Not seen: a fix inside a module
  the failed plugin requires in turn (a reinstall is); a project plugin that
  loaded stays in Node's require cache (restart, as before); a failed plugin
  reinstalled as a version whose `main` moved stays "not installed" until a
  restart, because Node keeps the `package.json` it read (in C++, not
  reachable from JS).
- **Linked directories** (`findBpmnlintConfig`): the path as given first, so
  an in-repository link to a directory outside keeps the repository's
  `.bpmnlintrc`; where that finds none and the start directory is reached
  through a link, the physical directory, where git finds the repository
  (`mlink -> repo/models` gets `repo`'s). `physicalOf` takes the deepest
  existing ancestor of a directory a write is about to create (`bpmn new
  mlink/sub/x.bpmn`), so a new subdirectory behind the link gets the same
  `.bpmnlintrc` and id conventions. A linked model file counts by the
  directory of the link, as git counts the working directory (the guide and
  docs say "a model whose directory is reached through a symbolic link").
  Trust is unchanged: the project tier decides on the physical root of the
  repository of the `.bpmnlintrc` found. `shown()` puts a physical path
  outside a linked `lintFrom` relative to where the link leads (`..`), not
  across the two spellings; the CLI's working directory is physical, so its
  paths do not change.
- **`bpmnlintEngine()`**: its resolver is the offline part of the chain
  (`offlineResolver`): the plugin's bundled resolver, then bpmnlint's
  `NodeResolver` inside the plugin for the packages bpmn-cli ships. It stays
  synchronous, and what neither knows throws the bundled resolver's error.
  Library hosts get `camunda-cloud-8-5`, `camunda-platform-7-20` and the
  other camunda-compat configs with the rules and findings a `.bpmnlintrc`
  gets (test). The upstream half (Miragon/bpmnlint-rules: bundle every
  camunda-compat config, or say that only the latest 7.x / 8.x one is
  bundled; it matters for browser hosts, which have only the bundle) is not
  filed.
- **Bench** (chore): `tools/bench/lib/corpus.mjs` passes `--no-lint-config`
  to the engine corpus's `layout --force` when the reference build has it
  (detected once, only when a file is drawn), like `arms.mjs` and the fuzz
  executor. The corpus does not change (115 of 115 files byte-identical).
- Docs: docs/bpmnlint.md (Which configuration runs, Project code, Library
  use, Limits), docs/library.md, one line in the guide's BPMNLINT, the
  module header. This closes the cache and lookup items of #33's "Left for
  later" and the bpmn-cli half of its camunda-compat bundle item.

Evidence:

- `npm run gate`: 2133 tests (+246 opt-in; +7 in test/bpmnlint.test.ts, each
  fails on origin/main; the two added after the review, a package found
  above the repository and one that appears during the load, and the new
  subdirectory checks of the two link cases also fail on the branch's first
  version), isomorphism check within budget (whole entry
  941.8 / 300.2 -> 942.0 / 300.3 KB, the guide lines; `applyToXml` 663.5 /
  211.6 unchanged), layout regression 444 (budget 444), fuzz 12 x 15 0
  errors.
- Differential against origin/main: the CLI on the 164 files of
  tools/scenarios and test/fixtures (`validate`, `validate --json`, `add
  --dry-run`) in a repository without a `.bpmnlintrc`, one with a project
  plugin, a missing plugin and moddle descriptors, a link inside it to a
  directory outside, and a directory outside any repository: 1968 of 1968
  outputs identical. Through a link from outside the repository 477 of 492
  differ, all by bpmnlint now running (the 15 others: an `add` both builds
  refuse, `E_AMBIGUOUS_SCOPE`, before any lint), and every `validate` equals
  the output inside the repository but the paths (328 of 328).
  `layout-regress --compare` 0 better / 0 worse, `speaking-ids --baseline`
  570 of 570, `roundtrip` identical.
- The review's probes: a plugin and a moddle package found above the
  repository and then installed inside it, and a descriptor written while
  the load runs, are used by the next call in the same process (before: the
  same message until a restart); the reinstall that moves `main` gives "is
  not installed" until a restart (the documented limit).
- Runtime: a cache hit with nothing left out makes the same file system
  calls as main (one read, one exists, one realpath, two lstat, one stat, no
  module resolution; about 30 us either way). One package left out and one
  project descriptor: 11 stats (the walk to the nearest
  `node_modules/<package>` up to `/`) and two resolutions, about 60 to 85 us
  a hit against 25 to 30 us on main, which checked nothing. A load takes the
  state of each package and descriptor before it looks it up (a resolution
  and a few stats each, once per load). A lookup that finds no
  `.bpmnlintrc` adds one realpath (about 20 us; through a link it walks
  twice, about 0.12 ms). The CLI's `validate` with a `.bpmnlintrc` that has
  a project plugin, a missing plugin and two moddle paths: median 167 ms
  against 171 ms on main (30 runs each), within the noise.

Left for later (low, not fixed here):

- A failed plugin reinstalled as a version whose entry module moved is
  reported as "not installed" until the host restarts (Node's package.json
  cache). The reason could say that the package directory is there and Node
  cannot resolve it, with a restart hint; that also changes the message of a
  broken install in a fresh process, so it belongs in a PR of its own.
- `test/global-setup.ts` checks only the path as given for a stray
  `.bpmnlintrc` above the temporary directory. That is enough: outside a
  repository only the start directory counts.
- The upstream half of the camunda-compat bundle item (Miragon/bpmnlint-rules)
  is not filed; it is a public issue and waits for the user's go.

## A write counts what bpmnlint leaves out (2026-10-13, `fix/lint-left-out-counted`)

Two findings of #33's third review ("Left for later" in its section, the
2nd and the 3rd). On a file without incoming / outgoing lists a write's
validator line read `0 error(s)` while `bpmn validate` exited 2: the
list-rule findings a write leaves out were dropped without a count. And a
moddle descriptor BpmnModdle rejects stopped every rule, while a write's
line looked like a healthy run. Now a write's totals are validate's, and
its line says what it did not compare
([docs/bpmnlint.md](docs/bpmnlint.md#writes)):
`validator bpmnlint (.bpmnlintrc in .): 7 error(s), 0 warning(s) in the
result (0 added, 0 resolved, 0 already in the file, 7 left out (incoming /
outgoing lists the file does not keep; `bpmn validate <file>` lists them))`.

- **A per-run channel** (`src/validators.ts`, additive and optional API):
  `ValidatorFinding.leftOut` (a short reason). The issue keeps it hidden (a
  symbol like the key, never serialised). `compareRuns` skips such issues
  before and after: never added, resolved, kept or pre-existing, never
  blocking. A left-out finding after also takes its unmarked twin before
  out of `resolved`: a real dead end that a change gives a flow in a file
  without the lists is still reported by bpmnlint in CI, so it is not
  resolved (W_DEAD_END is, as itself). It counts them in `counts` and in
  `ValidatorReport.leftOut` (`[{ reason, count }]`, one entry per reason,
  absent when there is none). A run with no run before (the advisory
  bpmnlint of a created document, `bpmn new`) ignores the mark and reports
  every finding, so `new` still lists a whole-model W_LINT_FAILED with its
  cause and hint. A write's left-out finding covers no lint warning; a
  check reports and covers as before
  ([docs/validators.md](docs/validators.md#left-out)).
- **bpmnlint** (`src/bpmnlint.ts`): in before / after, a list-rule finding
  the element's flows contradict is marked `incoming / outgoing lists the
  file does not keep` (it was a `continue`), and the W_LINT_FAILED of a
  model bpmnlint could not lint at all `W_LINT_FAILED, no rule ran`.
  validate is unchanged. `resolveBpmnlintConfig` builds a BpmnModdle with
  all descriptors once; when that throws it adds them one prefix at a time
  and leaves out each one BpmnModdle rejects (a prefix or uri already
  defined, an extends of an unknown type) as a `moddle` W_LINT_UNAVAILABLE
  (`BpmnModdle rejects it (<first line>)`, pkg the module path or
  `descriptor object`). The other rules run, and the node layer's detail
  counts it (`1 left out (W_LINT_UNAVAILABLE; ...)`) without a change there.
  The whole-model case that is left: a descriptor BpmnModdle takes but
  cannot parse the file with (a property that redefines one bpmn does not
  have).
- **Text** (`src/report.ts`): `keptOf` subtracts the left-out findings, so
  `already in the file` and `--summary`'s `preexistingCount` count what they
  counted before on a list-less file. The line adds ``N left out (<reason>;
  `bpmn validate <file>` lists it/them)`` inside an advisory validator's
  parenthesis, and ` (N left out (...))` to a blocking one (`lintBlocks`);
  a host's validator, which `bpmn validate` does not run, says `a check
  lists it/them` instead. `--summary` names them in a line of its own
  (``validator bpmnlint: 7 left out (...; `bpmn validate <file>` lists
  them)``) and its JSON in `leftOut: [{ validator, reason, count }]`
  (additive, optional): a list-less write with `--summary` showed nothing
  while validate exited 2, and the redefines case no longer said that no
  rule ran.
- Docs: docs/bpmnlint.md (Writes, Which rules are available,
  moddleExtensions, Lists of incoming and outgoing flows),
  docs/validators.md (`leftOut` in Findings, a Left out section at the end
  of Before and after, Results), docs/library.md, docs/reference.md
  (`--json`, `--summary --json`), the guide's bpmnlint topic, its JSON
  shapes and the catalogue entries of W_LINT_UNAVAILABLE and W_LINT_FAILED,
  SKILL.md (the left-out findings include the ones of elements the change
  added). `guide --short` is unchanged (4,644 bytes).

Evidence:

- Tests (each fails on main): test/validators.test.ts, a host validator
  that leaves its dead ends out (blocking: not refused, not resolved, the
  lint warning it would cover stays; advisory: the line and `--summary`; a
  check reports it), one entry per reason, a finding real before and left
  out after (not resolved) and the reverse (added), and a created document
  (advisory: reported; blocking: left out); test/bpmnlint.test.ts, a write
  on a list-less file (the line, the JSON, `--summary`, a new element there:
  the write's totals equal validate's on the written file, `lintBlocks`), a
  file with lists (no `leftOut`, the line as before), `add end --after` and
  `connect` on a real loose node of a list-less file (no bpmnlint finding
  resolved, W_DEAD_END / W_UNREACHABLE resolved as themselves), descriptors
  BpmnModdle rejects (duplicate prefix and uri, `extends: ['bpmn:Nope']`,
  two of one prefix, `{}` after `[]`) in the core and on disk (validate
  lists the real findings), the whole-model W_LINT_FAILED left out of a
  write (line and `--summary`) and listed by a new file with its cause and
  hint. The core test of a model that cannot be linted now uses the
  redefines descriptor (`{ c: [], d: {} }` is no longer one).
- `npm run gate` (after the rebase on #54): 2126 tests (+246 opt-in;
  2118 on main), isomorphism check, layout regression 444 (budget 444),
  fuzz 12 x 15 0 errors. The whole entry 938.9 / 299.2 -> 941.8 / 300.2 KB,
  `applyToXml` only 663.0 / 211.4 -> 663.5 / 211.6 KB: within main's
  budgets (948 / 302, 670 / 214), unchanged; docs/library.md has the new
  sizes.
- Differential against main (in process, test/fixtures + tools/scenarios,
  164 files as they are and without the lists, configurations
  recommended, recommended + automation, camunda-compat 7-24 and 8-10 with
  their moddle descriptors, a duplicate-prefix and a redefines descriptor;
  validate, `set name=`, `add task --after` and a new file, text, JSON,
  `--summary` and the written XML; 5832 cases, 3568 identical, 0
  unexplained): every file that keeps its lists gives byte-identical
  output. The differences: a write on a list-less file (650 cases, 12 of
  them fixtures whose own lists are incomplete) differs only in the
  validator's `counts` and `leftOut`, its line and `--summary`'s
  `leftOut`, and its totals equal validate's on the result; in 4 of them a
  list finding main called resolved is no longer resolved (all 6 are still
  in validate's result) and the lint warning it covered is resolved as
  itself. The duplicate prefix (969 cases plus `new`) equals recommended
  plus one W_LINT_UNAVAILABLE in validate (328 of 328 checked). The
  redefines descriptor (644 writes) moves the W_LINT_FAILED from `already
  in the file` to `1 left out (W_LINT_FAILED, no rule ran; ...)`, and
  `--summary` from `preexistingCount` to its `leftOut` line; its `new` is
  identical to main (W_LINT_FAILED added, with cause and hint).
  `tools/roundtrip.mjs` and `tools/speaking-ids.mjs --baseline` are
  identical to main.
- Runtime: with nothing left out, `compareRuns` does one more test per
  issue. A `.bpmnlintrc` with moddle extensions costs one BpmnModdle
  construction more per load (resolveBpmnlintConfig with the camunda
  descriptor 0.05 -> 0.68 ms, once per load, cached with it); without them
  nothing. The CLI's validate and `set` with camunda-compat 7-24 on
  orders.bpmn: within noise (119 -> 117 ms, 856 -> 828 ms, medians of 15).

Left:

- A whole-model failure in one run only (before lints, after cannot, or
  the reverse) still lists the other run's findings as resolved / added.
  With the descriptor check the remaining causes are the configuration's,
  which fail both runs alike.
- `rules reading <x>: properties` in the W_LINT_UNAVAILABLE of a rejected
  descriptor names the moddleExtensions key, also where the descriptor's own
  prefix is another (`x` with prefix `bpmn`).
- The W_LINT_UNAVAILABLE and W_CONFIG_IGNORED notes in the validator's
  detail keep main's `bpmn validate lists it` (no `<file>`, no backticks):
  changing them would change the line of every file that keeps its lists.
- A finding left out before and real after (a node with flows loses them)
  is added, like on main: the change made it real.

## A result says when BPMN_KEEP_FLOW_IDS kept the flow ids (2026-10-13, `feat/keep-flow-ids-env-note`)

The second half of a #32 'Left out' item. `BPMN_KEEP_FLOW_IDS=1` usually
sits in the `env` of an agent's settings, where the agent reading a result
does not see it. With it set, a result could differ from the default with
no warning at all: on a line of numbered flows, a move put the node's old
out-flow back (`changed: Flow_2, Flow_4, Flow_3, ...`) where the default
creates a new flow and removes the old one. Nothing in the result named the
variable.

- **CLI only** (`src/cli.ts`): `keepFlowIdsOption` returns the value and,
  when the variable (not a flag) turned keeping on, the variable's value.
  `printMutation` (every mutating command and `apply`, with stdin / stdout
  too) adds one note, `flow ids kept: BPMN_KEEP_FLOW_IDS=1
  (--no-keep-flow-ids renames flows after their new ends for one command)`
  with the value as set, where the kept ids changed the result
  (`keptByEnvNote`): the change gave `W_FLOW_ID_STALE`, or a move
  relocated a node (`ChangeSet.relocated`, from #47) and the change lists a
  sequence flow it did not create as changed. The note sits among the result's notes (text and JSON
  `notes`); `--summary`, which prints no notes of its own, prints it after
  its change lines (`summaryText`), and `--summary --json` gets a `notes`
  key only then. An `E_NOT_FOUND` of a batch of two or more ops gets one
  more hint sentence (`keptIdsHint`): the missing id may be the one the
  default renames a flow to, which kept its old id here. The library and
  its reports are unchanged; the browser bundle only by the guide's text.
- **When the note shows.** Kept ids change a result in two places only:
  `followEnds` (`src/ops/flows.ts`) keeps a flow whose id names its old ends
  and records it for `W_FLOW_ID_STALE`, and a move puts the moved node's
  one out-flow back (`src/ops/move.ts`, `doc.keepsFlowId`) instead of
  removing it and creating a new one. A flow whose id does not name its ends
  (`Flow_10`, Camunda Modeler's `Flow_1q7m2zd`) is renamed in neither mode,
  so a splice, a bridging remove or `set target=` on it is listed as changed
  in both; a flow the change created follows its ends in both; `set <flow>
  name=` / `id=` (also the rename `W_FLOW_ID_STALE`'s hint gives) is the
  same in both. None of these gets the note. The first version of this
  branch showed it for any changed sequence flow; the review's differential
  found that 548 of its 636 edits came out byte-identical without the
  variable.
- **No change** when a flag decides (also `--keep-flow-ids` with the
  variable set), when the variable is unset, empty or off, and for `new`,
  `layout` and the read commands.
- **Docs**: guide OUTPUT and the `--summary --json` shape, docs/reference.md
  (Environment, `--summary --json`), docs/commands.md, docs/contract.md
  (Limitations), plugins/bpmn-cli/skills/bpmn/SKILL.md. `guide --short` is
  unchanged.
- **Tests**: test/cli.test.ts (the note in text, `--summary`, `--json` and
  `--summary --json`, with the value as set, for a stale flow and for the
  numbered-flow move that has no warning, also in `apply`; byte-identical
  output where a flag decides, the variable is unset or off, or the kept ids
  changed nothing: a task rename, `connect`, `remove <flow>`, a batch that
  connects and then names a flow, `set <flow> name=` / `id=`, and a splice,
  a bridging remove and `set target=` on numbered and on Camunda Modeler
  flow ids; the `E_NOT_FOUND` hint in text and JSON, none where a flag
  decides or for one op); test/batch.test.ts (guide, docs and skill name
  the note).
- **Evidence**: `apply ... -o -` of the benchmark's edits E1-E6, E8, E9
  plus a move, a `set target=`, a `set name=`, a bridging remove and a batch
  that splices after a task and then names the task's old out-flow, on every
  scenario (1,094 edits, 26,256 runs) and again on a copy of the scenarios
  whose flows got ids that name their ends (the same counts). Against a
  build of origin/main: every run with the variable unset, set with either
  flag, `0`, or unset with `--keep-flow-ids` is byte-identical (exit, XML,
  report); with it set the exit and the XML are identical and the report
  differs only by the note. On the branch, the variable set against unset
  in the same output format: the note is present exactly where the two
  differ. On the scenarios (numbered flow ids) that is the 88 moves and
  nothing else; on the speaking copy 724 edits (E1 108, E3 112, E8 76, E9
  76, and 88 each of the move, `set target=`, the bridging remove and the
  splice-then-name batch). `set name=` on a flow, E2 and E4-E6 come out the
  same and get no note. No run failed only with the variable, so the
  `E_NOT_FOUND` hint has its test only. Only `dist/cli.js` and
  `dist/guide.js` differ; layout-regress (SCORE 444, 0 better / 0 worse),
  speaking-ids and roundtrip print the same numbers for both builds. Gate:
  2075 tests, fuzz ERRORS 0, bundle +0.4 KB minified / +0.2 KB gzip (guide
  text), `applyToXml` alone unchanged.
- **Rebased onto #55, #52, #53, #46, #48 and #47.** #47 made a move in
  place a no-op whose flow options (`flowName`, `condition`, `flowId`) go
  to the flow into its first node, the same in both modes. The first
  version of this branch keyed the move case on "the ops ran a move"
  (`moves`, set by `mutateArg`), so such a batch got the note with nothing
  kept (`[{op:'move', ids:['Activity_BookInvoice'], after:
  'Activity_CheckInvoice', flowName:'ok'}]`: `changed: Flow_2` in both
  modes). It now asks `ChangeSet.relocated`, which a move in place leaves
  empty, and `moves` is gone; test/cli.test.ts has the two cases (speaking
  ids with `flowId`, numbered with `flowName`), which fail with the old
  condition. docs/reference.md names the move in place among the results
  without a note. Gate after the rebase: 2118 tests (+246 opt-in; 2115 on
  main), fuzz ERRORS 0, layout regress SCORE 444, `guide --short` 4,644
  bytes; bundles 938.9 / 299.2 KB whole entry and 663.0 / 211.4 KB
  `applyToXml` alone, within main's budgets (948 / 302, 670 / 214;
  docs/library.md).

Left for later:

- A move that changes a flow without putting one back (a gateway with
  several out-flows spliced into a flow; a node the same batch created)
  still gets the note. Telling the put-back apart would need the library to
  mark it; the benchmark has no such move (every move with the note
  differs from the default).
- The `E_NOT_FOUND` hint is conditional ("If it is the id ..."): the CLI
  does not know whether the default would have given that id, so a typo in
  a later op of a batch gets the sentence too.

## Moves anchored on their own nodes, moves in place (2026-10-13, `fix/move-anchor-and-noop`)

Three follow-ups of #32 (two from its "Left out, for later", one found
while checking them), in both flow-id modes, with the fixes of their
review:

- **A chain anchored on one of its own nodes is refused**
  (`ops/move.ts assertChainAnchor`). `move A Join Done --after Join`,
  `move T1 E --after E` or `move A B --flow Flow_BToC` placed the chain
  after one of its later nodes: exit 0 with unreachable nodes, a flow
  listed as created and removed, `_2` ids. The per-node check
  (`assertNotInside` against each node's own placement) never saw it. Now
  the node the chain starts after (the `--after` anchor, also with
  `--before`; the source of the `--flow`) must not move with a later node:
  be it, lie inside it, or be one of its boundary events (`isInside` checks
  `attachedToRef` too: `move A T --after <T's timer>` or `--flow` out of it
  made a cycle T -> timer -> A -> T with exit 0). A `--before` anchor inside
  a later node is refused too (`move A Sub --before <node in Sub>`; it was
  refused with a message about Sub and A). `E_INVALID_PLACEMENT` before
  anything changes; the hint names the move of the first node alone, or,
  when that one is already there (`move C B --after B` with B -> C), the
  reorder `bpmn move <file> C --before B` (only when B has one flow in). The
  first node keeps its own check and message (`assertFirstPlacement` runs
  moveNode's checks first, in their order); a single node after its own
  boundary event is `E_INVALID_PLACEMENT` now (`that is one of its boundary
  events, which move with it`; it was `E_NOT_FOUND` for the boundary event).
  A `--before` anchor or the `--flow`'s target that is a later node stays
  allowed (`move A Join --before Join`, keep-flow-ids.test.ts).
- **A move in place changes nothing** (`inPlace`). `move B --after A` with
  A -> B detached B (the bridge A -> C took B -> C's label and condition)
  and spliced it back: by default `Flow_AToB_2 "go"`, `Flow_BToC_2` and two
  `W_ID_SUFFIXED`; with ids kept the label moved to A -> B. A node with
  several out-flows (a gateway after its predecessor) or several in-flows
  (a merge before its successor) lost all of them. Now a placement that
  leaves every node where it is gives a note (`Activity_B is already after
  Activity_A`; for a chain `..., in this order`) and no change: each later
  node follows the one before through its only in-flow, `--after X` is the
  first node's only predecessor through its only in-flow (X no gateway: an
  append makes a new branch), `--before Y` the last node's only successor
  through its only out-flow (Y no join: a prepend), `--after` + `--before`
  both (also `--after <gateway> --before <join>`). Flow options go to the
  first node's in-flow (`optionsOnInFlow`: `applyFlowOptions`, now
  exported, and a `flowId` renames that flow through `renameId`, like `set
  id=`, `E_DUPLICATE_ID` when taken; one change entry `(renamed from
  Flow_CToDone)`), so they need exactly one. Before the review fix a
  `flowId` was dropped without a word; origin/main made a new flow with it
  where it appended the node and dropped it where it spliced. Boundary
  events, a node given twice and `--flow` are never in place. Some inputs
  that failed before are notes now when the nodes are in place
  (`E_HAS_SUCCESSOR` from an anchor with several out-flows,
  `E_HAS_PREDECESSOR` before an implicit merge, `E_NO_FLOW` for a chain
  with `--after X --before Y`, `E_INVALID_BRIDGE`).
- **Nothing written.** The incremental layout placed every id of a move
  with a placement again (`pipeline.ts relocatedIds`), so even a no-op
  rearranged a hand-made drawing (step1/far-label.bpmn: SUB, SE and ST
  moved). It now takes only the nodes a move relocated:
  `ChangeSet.relocated` (new, public, additive; the ids at the time of the
  move, not renamed, concatenated by `merge`, not in `toJSON`). This also
  keeps `move X --in <its own scope>` ("already in") from moving X's shape.
- **What the bridge took.** `detachNode` and `detachWithBridge` return the
  `Bridge`: the in-flow (`flow`), the out-flow it replaced (`from`) and what
  it `took` (the name string, the condition element, the associations;
  `carryAssociations` returns them; the default-flow rule of
  `detachWithBridge` deletes `took.condition`). With ids kept, once the
  whole chain is placed (`reportBridgesKept`, after `giveBackLate`), the
  last change entry of a put-back out-flow says what of its own label (as
  the move started: `labelsBefore`) a bridge still holds, by the bridge's
  id then: `(was -> Activity_C; its name and condition stay with the bridge
  Flow_AToB)`. It follows later bridges of the chain that took the value
  over, and says nothing for what the flow has again or what a later
  bridge did not take (that detach warned). The first version built the
  clause when the flow was put back: a bridge a later node renamed was
  named by its old id (a batch flow following its ends), and a swap
  (`move B A --after Start`) got two clauses pointing at each other and an
  extra entry `ChangeSet.change` no longer deduplicated. A bridge a later
  node removed (not bridged: an end event, a split) took the label along,
  silently on origin/main too (`move A E1 --after G`: `removed F_T_A
  "done"`, no "done" left): the flow now gets name and condition back when
  it ends between its old ends (`giveBack`, listed once), else
  `W_LABEL_DROPPED` / `W_CONDITION_DROPPED` (`the bridge F_S_A took it, and
  a later node of the move removed F_S_A`). Default mode is unchanged (the
  out-flow is `removed` with its label).
- One #32 test changed: "a later change that leaves a stale flow where it
  was" moved X in place to run Flow_AToB through its named ends; that move
  is a no-op now, so the test moves X away and back (`move X --after C`,
  `move X --after A`) with the same three expectations.
- Rebased onto #46, #48, #52, #53 and #55: the change entries this branch
  builds from another one (the renamed flow of a move in place, the clause
  of `reportBridgesKept`) keep the element they are about
  (`flowChange(flow, detail)`, `about`), as #46 made every entry of move.ts
  do, so a later rename still finds them.

Docs: commands.md (move), ops.md, reference.md (placement), migrating.md
(Changes from 0.6: the refusal, the move in place and its `flowId`,
`ChangeSet.relocated`, the clause), the guide (`E_INVALID_PLACEMENT` in
the catalogue, the move summary, a placement note, the batch text), the
`flowId` description of the op schema (batch.ts), SKILL.md (error table).
`guide --short` is unchanged (4,644 bytes).

Evidence: 7 new tests (test/keep-flow-ids.test.ts,
test/ops-mutate.test.ts) fail on origin/main and pass here. A differential
of generated move ops (the fuzz's own move, moves in place, chains along
the flows with anchors inside and outside, flow options with `flowId`,
swaps and reversed chains, chains anchored on a boundary event of a later
node, `--before` inside a later sub-process; both modes, the whole pipeline
with its layout) on origin/main and this branch differs only on no-op and
self-anchored moves, in the clause and where a removed bridge's label is
given back or warned about:

| | test/fixtures + tools/scenarios (164 files) | private corpus (222 files, counts only) |
| --- | --- | --- |
| runs | 14,756 | 18,804 |
| identical | 7,583 | 9,951 |
| no-op on the branch | 4,330 | 5,356 |
| ... origin/main kept the graph (new ids, label moved, `flowId` flow made) | 3,718 | 4,384 |
| ... origin/main changed the graph (a gateway's or merge's other flows cut) | 406 | 740 |
| ... origin/main refused (`E_INVALID_PLACEMENT`, `E_HAS_SUCCESSOR`, `E_INVALID_BRIDGE`, ...) | 206 | 232 |
| refused as self-anchored (a later node, inside one, its boundary event) | 2,542 | 3,206 |
| ... origin/main wrote a rewired model | 1,530 | 1,610 |
| refused as placed on its own boundary event (origin/main: mostly `E_NOT_FOUND`) | 296 | 290 |
| only the clause of the put-back flow added (keep mode) | 5 | 1 |
| a removed bridge's label given back or warned about | 0 | 0 |
| anything else | 0 | 0 |

The fuzz walks themselves (tools/fuzz/walk.mjs, the same seeds on both
builds, 96 walks x 25 steps, seed 1, auto and incremental, 130 move steps):
82 walks identical step by step, 14 diverge, each first at a `move-after`
that is a no-op here; one error-severity violation, the same in both builds
(a walk that does not diverge). `npm run roundtrip` and `tools/speaking-ids.mjs
--baseline` are identical to origin/main, the layout regress score stays
444, and the gate's fuzz has `ERRORS 0` and 4 warnings, as on origin/main.
Runtime: a move with the same output takes the same time (median 30 / 30
ms and 35 / 35 ms per run, the two corpora, origin/main / branch); a no-op
is about 16 % faster (no detach, nothing placed again). The differential,
the walks and the runtimes were measured before the rebase. Bundles after
it: whole entry 938.5 / 299.0 KB (origin/main 931.6 / 296.7), `applyToXml`
alone 663.0 / 211.4 KB (657.5 / 209.6). Main's budgets (935 / 298 and 660
/ 210) had 0.3 to 3.4 KB left after #46 and #48 grew the edit path, less
than this change adds (about 7 / 2.3 and 5.5 / 1.8 KB), so they are raised
to the measured size plus about 1 %: 948 / 302 and 670 / 214
(tools/iso/budget.json, docs/library.md).

Left for later (low, from the work and its review):

- With `--before` and flow options a first node without exactly one
  in-flow runs the old path (there is no single flow for the options).
- A relocating move that splices drops a `flowId` without a warning, as on
  origin/main (`add` says `W_OPTION_IGNORED` with the `set id=` hint); the
  schema says `flowId` names only a flow the op creates.
- The refusal hint is not run: "move the first node alone" can itself be
  refused (a start event spliced into a flow).

## A batch alias through a retype, a split's input in the library (2026-10-13, `fix/batch-alias-retype-split-input`)

Two items #34 left open ("Open after #34" and "Left for later" below).

- **An alias follows its element through a retype** (`src/ops/retype.ts`,
  `src/result.ts`, `src/ops/index.ts`, `src/ops/aliases.ts`). A retype to
  another BPMN type replaces the element (`swapType` makes a new one), and
  the alias table kept the old one: a later op that used the alias got
  `E_NOT_FOUND` ("which an op before this one removed"), and the result's
  `aliases` left the alias out. Now `ChangeSet.replaced` records
  `{ from, to }` (merged like `bindings`; `runBatch` clears both before it
  returns), and `runBatch` calls `AliasTable.rebind(from, to)` after each
  op. The alias follows the new element, also when a retype under the
  declared conventions gave it a new id (`serviceTask_checkInvoice` ->
  `userTask_checkInvoice`). A retype within one type (a trigger change)
  never replaced the element, so nothing changes there. Output changes only
  for batches that alias an element and retype it to another type: a batch
  that uses the alias afterwards now runs, and `aliases:` and the JSON
  `aliases` list the retyped element's alias.
- **A split's input in the library** (`src/ops/split.ts`,
  `src/ops/aliases.ts`). Typed ops skip `parseOps`. `mutateDoc` took a
  branch without `nodes` as a direct gateway -> join flow. `nodes: 'abc'`,
  `branches: 'oops'`, a null branch, a node that is no object and a node
  without a string `kind` crashed with an uncoded TypeError, in the alias
  table's `slots()` or partway through the split with the gateway already
  added. `splitFlow` now checks that shape before the split changes
  anything (the ops before it in the batch have run). The error is
  `E_USAGE` with parseOps' message and hint, `split` where parseOps has
  `ops[i] (split)`: `split branches[0]: missing required key "nodes"
  (Nodes of the branch in order ...)`; the parentheses come from
  `BRANCH_FIELDS` / `NODE_FIELDS` of `src/batch.ts` (imported, batch.ts
  unchanged), and the test compares each message and hint with
  `parseOps`. The alias helpers read the split's lists only where they are
  arrays of objects. `branches` that are missing or empty stay
  `E_INVALID_VALUE`. The CLI and `applyToXml` run parseOps first, so their
  texts do not change.
- Docs: [docs/ops.md](docs/ops.md) (an alias follows its element "through
  a rename and a retype"), [docs/library.md](docs/library.md) (`mutateDoc`:
  what a split checks, and that the ops before it have run),
  [docs/migrating.md](docs/migrating.md) (two bullets in "Changes from
  0.6": the alias through a retype; a typed split without `nodes` is
  `E_USAGE`, 0.6 made it a direct flow), one sentence each in the full
  guide's ops section and the skill's `reference/ops.md`. `guide --short`
  is unchanged (4644 bytes on main with #55, #52, #53 and #46).
- Tests: `test/batch-aliases.test.ts` (create, retype, set and a format op
  on the alias, also for a gateway and an event; retyped twice; removed
  after the retype is still `E_NOT_FOUND`; a new id under the declared
  conventions; the CLI's `aliases:` line and `--json`) and
  `test/ops-create.test.ts` (`mutateDoc` with branches without `nodes`,
  `nodes: 'abc'`, `branches: 'oops'`, a null branch or node, a node
  without a string `kind`: `E_USAGE` in parseOps' words, the document
  unchanged; `nodes: []` still a direct flow). All four fail on main.
- Evidence against a build of main: the same batches through
  `applyToXml` on test/fixtures and tools/scenarios (164 files, 2216
  batches). Batches without a type-changing retype of an aliased element,
  and the split errors of parseOps, are byte-identical (xml and result):
  1793. The alias used after a retype: 259 now run (main `E_NOT_FOUND`).
  The retype only: 162 differ by the added alias alone. On a private
  corpus (counts only) the numbers are 231 / 27 / 21 of 279, with no other
  difference. The CLI's split errors are identical. A seeded fuzz campaign
  `--via apply` (40 walks x 25 steps, 44 retypes) wrote byte-identical
  models and logs, apart from timings. `layout-regress --compare`: 0
  better, 0 worse; `speaking-ids --baseline` and `roundtrip --baseline`
  are unchanged. Bundle: whole entry 925.7 -> 927.2 KB minified (294.5 ->
  295.0 KB gzip) before the rebase; after the rebase onto main with #55,
  #52, #53 and #46 930.1 -> 931.6 KB (296.1 -> 296.7 KB gzip), `applyToXml`
  656.1 -> 657.5 KB (209.0 -> 209.6 KB gzip): within the budget, which
  stays as it is. Runtime: one loop over the op's
  replaced elements (empty without a retype) and a check over the split's
  lists; within noise.
- Left for later: a typed split node whose `kind` is a string but empty or
  unknown is `E_UNKNOWN_KIND` from `addElement`, after the split gateway
  was added (coded, as before; parseOps refuses it up front). Checking it
  in `checkShape` would need parseOps' `checkKind` (the
  `eventSubProcess:<trigger>` kinds), which lives in `src/batch.ts`, which
  P6b (`outAs`) edits. The other keys of a typed split node (`set`,
  `flowName`) are not checked, as for a typed `add`. `split.ts` has its own
  five-line `describe()` (batch.ts does not export its copy).

## Flows follow every end change (2026-10-13, `fix/flows-follow-every-end-change`, follow-ups of #32 and #34)

Four leftovers of #32 ("Left out, for later") and #34 ("Pre-existing"), all
in the test whether a flow id names its ends and in the change report.

- **An end renamed earlier** (`ops/flows.ts endLabels`, `recordFormerEnd`,
  `idNamesEnds`; `Doc.recordFormerEnd`): `idNamesEnds` named an end only as
  it was called then (labelOf, its id's stem, formerLabels). After `set
  Activity_Check id=Activity_Verify` (in the batch or a command before) or
  `set name=` on an end whose id says nothing, `Flow_CheckToOk` neither
  followed a later splice nor was reported with ids kept. It now also tries
  (a) the end's name where its id speaks (left out where its words are a
  label's, `slugify` equal, so a file whose ids are their names' slugs does
  the same work as before); this covers `set id=` of a named end across
  commands; and (b) the id and labels `set` recorded before it changed an
  end's `id` or `name` in the running batch or op on its own
  (`Doc.formerEndsOf`, forgotten where `runBatch` and `runOp` alone forget
  the kept flows), with the connection request built from the recorded id
  (stemTo, idPair and scopedTo are built from ids). It records on change,
  only for a node with sequence flows; no snapshot of every end. A retype
  that builds a new element (`swapType`) hands the record on
  (`Doc.replaceElement`). followEnds renames such a flow after its current
  ends (`Flow_VerifyToLog`), staleFlowWarning reports it against them.
- **A flow without id** (`followEnds`): `idNamesEnds` is false for an empty
  id; `followEnds` gives a flow without id whose ends change an id in both
  modes, from its new ends (`allocateId`, no Rename: there was no old id) or
  the `--flow-id` of the `add` that splices into it (claimed like the id of
  a flow add creates: E_INVALID_ID / E_DUPLICATE_ID alike; no
  W_OPTION_IGNORED then), and returns `''`, which `renamedNote` turns into
  ` (id added: it had none)` on its one change entry; `Doc.keepsFlowId` is
  false for it (a move does not put it back); `createSequenceFlow` claims no
  undefined id. `add`, `split`, `apply` and a bridge into it ran into
  E_INTERNAL (exit 70); the incremental layout now draws it by that id.
  `format.ts` prints `(no id)` for a removed one (was `undefined`),
  `--summary` leaves it out (`report.ts uniqueIds`).
- **The report names a flow by its own id** (`result.ts about`, `replaced`):
  a splice renamed the spliced flow, the new flow took the freed id, and
  `ChangeSet.rename` renamed every entry with that id, the new flow's too:
  `created sequenceFlow Flow_CheckToCheck` twice in the text and `--json`,
  `--summary` without the changed one, no `renamed`. Change entries and
  renames now carry their element in a WeakMap (`about`; JSON and the
  entries' shape unchanged): `flowChange(flow, detail?)` and `changeOf`
  record it (the six `{ ...flowChange(x), detail }` sites pass the detail
  instead, so they keep it), `Doc.recordRename` / `recordRegenerated` take
  it, and `ChangeSet.rename` renames an entry with the old id only when it
  has no element or the renamed one (also in a batch's merge). A retype
  that builds a new element records it as the old one's successor
  (`Doc.replaceElement` -> `replaced`), so the entries an earlier op made
  for the old element still follow its regenerated id under declared
  conventions (`[add, set doc=, retype]` names `userTask_checkInvoice`
  everywhere, as on main). The file was always right.
- **One command per flow for a splicing `add --flow-id` with ids kept**
  (`Doc.preferFlowId`, `KeptFlow.preferred`, `flowIdIgnoredHint`):
  `W_OPTION_IGNORED` named `bpmn set <file> F id=<flowId>` and
  `W_FLOW_ID_STALE` `bpmn set <file> F id=<speaking>`; following both failed
  (E_NOT_FOUND). Where the splice kept the flow, add records the given id
  with the node the flow then ends at; `staleFlowWarning` suggests it while
  the flow still ends there and the id is valid and free (else the speaking
  id), and the `W_OPTION_IGNORED` hint says `W_FLOW_ID_STALE names the
  command that renames F`. Where no W_FLOW_ID_STALE comes for that flow (its
  id still names its new ends, a later op put it back or renamed it),
  `reportStaleFlows` gives the hint its own command back, or none where the
  flow no longer has that id or the `--flow-id` is taken. Default mode and a
  flow that was not kept (hashed, or created in the batch): unchanged.
- Docs: guide (`W_FLOW_ID_STALE`, `W_OPTION_IGNORED`, the `--flow` rule,
  `kinds --section ids` renames; `guide --short` unchanged, 4,644 bytes),
  reference.md (Ids, flow options), ops.md, migrating.md.

Evidence:

- `npm run gate` (rebased on #55, #52 and #53): 2,104 tests (+246 opt-in;
  2,090 on main; 14 new in keep-flow-ids, drawn-ids, speaking-ids,
  conventions-ids and conventions-declared, 11 of them fail on main, 3
  guards pass on both: a renamed end changes nothing else, the `--flow-id`
  fallbacks, and every entry names the final id after `[add, change,
  retype]` under declared conventions), isomorphism check, layout
  regression 444, fuzz 12 x 15: 173 ok, 7 refused, 0 errors.
- Against main, a build of each, the same seeded batches (the fuzzer's
  semantic steps, a `set id=` before a quarter of them, a second step chained
  to almost a third; with and without ids kept, every third step with the
  layout too) on tools/scenarios and test/fixtures: 164 files, 1,968
  batches, 5,248 comparisons. 5,017 identical, 181 refused alike, 50 differ,
  each only in flow ids (by default the same file once the new ids are mapped
  back, with ids kept the same file and result plus W_FLOW_ID_STALE): 32
  where an end got another id in an earlier command and its name still
  names the flow (16 renamed, 16 reported), 18 where it got it earlier in
  the batch. None of the 164 files as read has a flow the wider test reads
  differently. `tools/speaking-ids.mjs` on the same files: identical output
  (18 renamed flows on both); `layout-regress --compare`: 0 better, 0 worse;
  `tools/roundtrip.mjs`: identical.
- With the conventions of a bare element-id-naming: seeded batches on
  tools/scenarios (920, 166 with a retype; 1,840 comparisons) differ in 2,
  both a `set name=` earlier in the batch (renamed / reported); `[add, set
  name=, retype]` after the first task of each of 112 files gives the same
  result as main in all of them.
- With ids kept, the same 1,968 batches (`set id=` or `name=` before 30 %):
  no E_INTERNAL, no flow id changed, one rename command per flow, every
  W_FLOW_ID_STALE command can be followed (295 hints; 281 on main). 4
  followed ids no longer name their ends on the next read (3 on main): the
  mixed-style drift in #32's Left out (polish-*.bpmn, `f` and `Flow_`); the
  fourth is a flow only this branch reports.
- Bundle (rebased on #55, #52 and #53): whole entry 927.5 / 295.2 -> 930.1 /
  296.1 KB (minified / gzip), `applyToXml` only 654.3 / 208.3 -> 656.1 /
  209.0 KB, the table in `docs/library.md` too; budgets unchanged.
- Runtime: by default `idNamesEnds` makes the same `derivedBases` calls as
  before where an end's name gives its id's words (one `slugify` more per
  named end); only an end with a different name, or one `set` renamed
  earlier in the batch, adds a label or an id to try. Under a machine load
  of 100 to 190 (other worktrees), medians of 15 interleaved runs, base ->
  branch: 60 splices on a 200-flow chain 206 -> 203 ms following, 211 -> 212
  ms with ids kept, 30 `set id=` + splice pairs 147 -> 150 ms, the 60
  splices through `applyToXml` 271 -> 269 ms.

Left out: `set name=` on an end whose id says nothing, followed by an end
change in a later command, and `set id=` on an end without a name (or whose
name gives no id words) followed by an end change in a later command:
nothing records the old name or id across commands, so such a flow keeps
its id without a word (by default too); a retype or trigger change that
changes an unnamed end's kind word (`Task` -> `UserTask`) before an end
change in the same batch (not recorded; only `set id=` / `name=` are).

## The E_VALIDATION advice reads the refusal (2026-10-13, `fix/e-validation-hint`)

An open point after #35, and wider than its note said there: the
advice after an `E_VALIDATION` refusal sent the reader to `bpmn validate
<file>`. A refusal writes nothing, so validate runs on the unchanged file
and shows none of the refused errors (`bpmn new; add task; add participant
Customer --black-box`: refused with `E_EMPTY_COLLABORATION` and
`E_ORPHAN_PROCESS`, then `validate` says `valid, 3 warning(s)`, exit 0). An
agent that followed it could take the refusal for spurious. A host
validator's errors never show in the CLI at all.

- Text only, no code, id or output other than these: the catalogue's
  `E_VALIDATION` fix (`bpmn guide` COMMON ERRORS, `guide errors`, `bpmn
  kinds`, `kinds --json`, `ERROR_CATALOGUE`) says to read the errors in the
  refusal (the lines under it, JSON `error.errors`, library
  `err.details.errors`) and that `bpmn validate <file>` does not show them;
  the `guide --short` line (4,644 of 5,120 bytes); the hint of a structural
  refusal (`src/pipeline.ts`) is now the validator refusal's without its
  brackets; the plugin skill's error table. The guide's error output
  (`guide commands`) and `docs/reference.md` list `errors` in the JSON
  error and the lines under a refusal (the guide also the `command` /
  `ops` it left out), `docs/library.md` lists it in `CliError.details`, and
  `docs/validators.md` says that a check of the unchanged document does not
  show them.
- Tests (`test/validators.test.ts`): the black-box refusal (text and JSON
  hint, file unchanged, validate exit 0 without the refused codes, the hint
  equal to `validatorRefusal`'s), and that no sentence of the catalogue fix,
  the short-guide line or the skill row names `bpmn validate` except to say
  that it does not show them, with `errors?` in the guide's JSON error.
  Both fail on main; `docs/testing.md` describes them.
- Differential against main (1,769 CLI runs on the scenarios: guide, every
  topic and `--help`, kinds, refusals, forced and plain writes): only these
  texts differ, each a pure substitution (209 structural refusals in text
  and in JSON, 4 catalogue texts, `kinds --json`, the short line, the
  error output in `guide` and `guide commands`); written
  files, exit codes, ids, speaking-ids, layout-regress and roundtrip
  identical.
- `npm run gate` (rebased on #55 and #52): 2,090 tests (+246 opt-in),
  isomorphism check (the whole entry 927.0 / 295.0 -> 927.5 / 295.2 KB,
  `applyToXml` only 654.2 / 208.3 -> 654.3 / 208.3 KB, the table in
  `docs/library.md` too, no budget raised), layout regression 444 (budget
  444), fuzz 12 x 15 0 errors (the 4 group warnings in one walk of main).

## Decision links in the file's spelling (2026-10-13, `fix/42-decision-link-spelling`, issue #42)

With the library's `platform: 'none'` (design-iq's live host passes it for
a document without an executable process), `set <id> calledDecision=`
replaced a link in an engine spelling with the unprefixed attribute:
`camunda:decisionRef` became `calledDecision`, a `zeebe:calledDecision` lost
its `resultVariable`, and a new link next to engine links was unprefixed, so
one file mixed spellings. #42 settles it as written. Auto-detection never
gives none for such a file (a link in an engine spelling makes it Camunda 7
/ 8), so the CLI's `set` is unchanged: it converts as before, and a file
without engine content gets the unprefixed attribute as before. The docs
(migrating.md, reference.md, the guide) say so.

- **Spelling** (`src/ops/decision.ts`, `setDecisionLink`, platform none
  only): a task whose link has an engine spelling keeps it
  (`camunda:decisionRef` / `operaton:decisionRef` updated in place, the one
  the readers read first when a task has two; a `zeebe:calledDecision` gets
  the `decisionId` and keeps its `resultVariable`, no
  `W_DECISION_RESULT_VARIABLE`). The own link is the one `decisionLinkOf`
  reads: a `zeebe:calledDecision` without a `decisionId` is none, so such a
  task follows the file (the element goes, or with a zeebe file it takes the
  `decisionId` and keeps its `resultVariable`), and next to an own unprefixed
  link it stays unprefixed. A task without a link takes the engine
  spelling of the file's other links (every business rule task, in
  sub-processes and other processes too) when they all have one and the
  same, with a namespace that resolves (`fileEngineSpelling`, one walk over
  the BPMN tree, only on this path; written with the file's prefix).
  Otherwise, also on a task whose own link is unprefixed (`calledDecision`,
  or a hand-written `calledElement`, which is still replaced; #42 does not
  list it), the unprefixed `calledDecision` as before. The Camunda 7 / 8
  branches share the writers (`writeC7`, `writeZeebe`) with unchanged
  output; reading (`decisionLinkOf`) is unchanged.
- **Whose spelling**: the unprefixed `calledDecision` is bpmn-cli's own
  spelling for a model without an engine. The comments (decision.ts,
  set.ts, c7.ts, view.ts, bpmnlint.ts), the guide (the `set` summary, the
  `calledDecision` set key of `bpmn kinds`, the fix of
  `W_C7_DEPLOY_SCHEMA`), the bpmnlint import-warning hint,
  docs/bpmnlint.md, docs/reference.md (Set keys: the spellings),
  docs/library.md (`platform`), docs/testing.md and docs/migrating.md say
  so, and none names design-iq as the reason. docs/audit-2026-10.md keeps
  its historical wording.
- **Tests**: `test/decision-link.test.ts` 14 -> 30 cases (each acceptance
  line of #42, the follow-up probes, a `zeebe:calledDecision` without
  `decisionId`, the CLI's path with platform auto converting as before, and
  a check that no guide entry about the link names design-iq); 11 of them
  and the bpmnlint hint case fail on main. `test/c7-followups-integration.test.ts` and `test/c8-profile.test.ts`:
  a comment and a case label only.
- **Differential** against main (in-process: `set calledDecision=<d>` and
  `calledDecision=` on every business rule task, an added business rule
  task with a link after the first task, platform auto and none; 109 public
  files and 197 private ones, counts only): with auto (the CLI's path) all
  identical; with none 8 of 798 runs differ, in 4 files with engine links,
  each a kept own spelling (4) or a new link that follows the file's single
  spelling (4). The 47 private files with unprefixed links: identical.
- `npm run gate`: 2,088 tests (+246 opt-in), isomorphism check (whole
  entry 925.9 / 294.6 -> 927.0 / 295.0 KB, `applyToXml` only 653.3 / 208.0
  -> 654.2 / 208.3 KB, budgets unchanged), layout regression 444 (budget
  444), fuzz 12 x 15 0 errors. `guide --short` unchanged (4,638 bytes).

Open after #42:

- `ext add` of another platform's extension warns nothing (the other
  upstream ask of design-iq's ADR 0009): an issue of its own.

## @miragon/bpmnlint-plugin-rules 0.12.1 (2026-10-13, `fix/bpmnlint-rules-0.12.1`)

The plugin is pinned to 0.12.1 (was 0.12.0; bpmnlint stays 11.15.0). The
lockfile changes only the plugin's own entry (version, tarball, integrity,
its peer range `bpmnlint >=11.14.0`); its dependencies are the same.

- **`case: "toString"`**: element-id-naming no longer throws on a case named
  after a key of `Object.prototype` (upstream #79; `toString`, `__proto__`);
  it checks the fallback, PascalCase, like any unknown case.
  `idConventionsFromLint` gives that case the note of every unknown case
  (`case "toString" is unknown: the rule checks PascalCase, and new ids take
  it`). A `resolveCase` answer without a known label comes only from helpers
  a host injects from a plugin before 0.12.1 (Object.prototype's property: a
  function for `toString`, Object.prototype itself for `__proto__`); its rule
  cannot check the case (`<prefix_undefined>`, or W_LINT_FAILED on an id with
  the prefix), so that path keeps a note of its own: `is unknown, and the
  rule of a @miragon/bpmnlint-plugin-rules before 0.12.1 cannot check it: new
  ids take PascalCase, the fallback for an unknown case`. The guide
  (`W_CONFIG_IGNORED`) and docs/bpmnlint.md give the unknown-case wording,
  docs/library.md the older plugin's limit; `test/conventions-lint.test.ts` pins both notes (the older helpers by a
  stub) and lints `userTask_checkInvoice` under `toString` and `__proto__`
  with the real rule (one PascalCase finding each).
- **ESM build**: it loads in plain Node now (upstream #78). bpmn-cli keeps
  `createRequire` (the CJS build): `bpmnlintEngine()` is synchronous, and
  Linter and NodeResolver are required from the plugin's own location, so
  they are the bpmnlint the plugin's rules import, and the shipped tier
  resolves from inside the plugin. The module header of
  `src/node/bpmnlint.ts`, docs/library.md, docs/testing.md and the header of
  `test/bpmnlint.test.ts` give that reason instead of the broken ESM build.
- **Peer range `bpmnlint >=11.14.0`** changes where npm puts the plugin: with
  a project bpmnlint older than 11.14, npm no longer hoists the plugin next
  to it but keeps it under bpmn-cli, next to bpmn-cli's own bpmnlint 11.15.0,
  and lint runs (checked with npm 12.0.2: project `bpmnlint 11.0.0`, packed
  CLI; the 0.12.0 pin gave W_LINT_UNAVAILABLE, the 0.12.1 pin `4 error(s), 14
  warning(s)`). The old hoisted bpmnlint, and its W_LINT_UNAVAILABLE, is left
  for `--legacy-peer-deps` (the plugin is hoisted again) and package managers
  that ignore peers. docs/bpmnlint.md ("A hoisted bpmnlint"), the guide's
  `W_LINT_UNAVAILABLE` and the module header of `src/node/bpmnlint.ts` say
  so; the tests that build such a layout by hand are unchanged.
- Of the upstream items listed under #33 below, 0.12.1 settles the ESM
  build, the peer range, the rule name in the doc comments and the README's
  `.bpmnlintrc` examples (strict JSON now, `json` blocks that `JSON.parse`
  reads). The bundle with only camunda-compat 7-24 / 8-10 is now documented
  upstream as intended (README and `createBundledResolver`'s doc comment:
  chain bpmnlint's NodeResolver behind it for older engines), which is what
  bpmn-cli's shipped tier does; nothing of that list is open.
- Version mentions: CONTRIBUTING.md, docs/bpmnlint.md, docs/migrating.md
  (the 0.7 dependency line; the toString note was never released, so no
  migration line of its own). The broken-plugin stub in
  `test/bpmnlint.test.ts` keeps `version: '0.12.0'` (any version; it throws
  on load).

## Id conventions of the .bpmnlintrc (2026-10-13, `feat/34-id-conventions`, issue #34)

bpmn-cli learned the id style from the file alone. A new file got bpmn-js ids,
a kind the file had never used fell back to the default prefix, and in a
repository whose `.bpmnlintrc` runs `@miragon/rules/element-id-naming`
(`recommended-for-automation` turns it on) every write added findings of that
rule, which #33 then listed. Now the ids bpmn-cli generates follow the rule
where it declares a prefix ([docs/bpmnlint.md](docs/bpmnlint.md#id-conventions)).
The user's decisions hold: the conventions come only from the resolved
setting of element-id-naming, read as the rule reads it, with the plugin's
own naming helpers; no `.bpmn-cli.json` and no other config file (no topic
or message name templates either); generated ids fill the
gap a change opens, existing ids are never renamed for the conventions; a
value new ids cannot follow never blocks a command.

- **Core** (`src/conventions.ts`, browser-safe; the naming helpers are
  injected): `idConventionsFromLint(setting, naming, { source })` merges the
  options over `DEFAULT_PREFIXES` as the rule does, runs `resolvePrefix` on
  an element of every concrete `bpmn:` type of the moddle registry (120
  types; 23 hits for the bare flag, so `bpmn:Definitions`, `bpmn:DataStore`
  and the rest are covered when named exactly) and `acceptedPrefixes` on an
  event of each kind and trigger (32 qualified prefixes), and gives
  `IdConventions` (plain data: prefixes, `case`, `qualifier`, `source`,
  `ignored`) plus `W_CONFIG_IGNORED` notes: a prefix that is no string,
  cannot start an id, has a character outside ASCII or is longer than 56
  characters (left out: that type follows the learned style; `ignored`
  names the concrete types the rule still checks with it), under
  `required` a qualified prefix longer than 56 characters (`ignored` names
  `bpmn:EndEvent:escalation`), an unknown case (the rule's PascalCase; also
  `toString` and other names of JavaScript's Object, which the rule cannot
  check) or qualifier (optional; the hint's guess is `closestKey` of
  `src/batch.ts`).
  DI types are out of scope. `conventionsView` / `renderConventions` are
  `show --conventions`: rows grouped by pattern and source (`lint`, `file`,
  `lint shape`, `default`), `<kind>_` for prefixes named after their kind,
  `not checked` or `checked; prefix ignored (W_CONFIG_IGNORED)` for kinds
  the rule names nothing new ids can follow, the flow head new flows really
  get (`IdStyle.explainFlow`: `F_` after `F1`..`F12`, `Flow_` after a prefix
  that leaves no room), one line for the qualified prefixes; where none are
  declared, why (`undeclared`: `--no-lint-config`, no `.bpmnlintrc`, one
  that did not load, the rule off, no usable prefix).
- **Ids** (`src/idstyle.ts`, DECLARED CONVENTIONS in the module contract): a
  request whose type has a declared prefix takes it (the qualified one only
  under `required`) and a body in the declared case; the kind word drops
  what the prefix says (`startEvent_timer1stOfMonth`), a number first gets
  the kind word under camelCase / PascalCase, where the collision suffix is
  glued (`serviceTask_checkInvoice2`) and a join is `<id>Join` (snake_case
  `<id>_join`, also in a file of bare ids; after an explicit split id the
  declared prefix does not start: that prefix and the gateway's label,
  `gateway_checkJoin`; after one whose body is not in the declared case,
  `CASE_BODY`, the rule's patterns: that prefix and the body's words,
  `gateway_approvedJoin` for `gateway_Approved`). Flows take
  the declared prefix in the `named` form (the file's scope segment left
  out of the ends, `From` before a number); message flows an exact
  `bpmn:MessageFlow` entry, else the style the file's own message flows
  show (`flowVoted`: two that agree; the ones under the borrowed prefix do
  not vote, so the second message flow no longer flips to `Flow_`), else
  the sequence flows' prefix and style. The learner runs twice: `l` without the ids that
  already start with a prefix the conventions accept for their element
  (`conforms`; the drift fix: a PascalCase file keeps `Lane_TeamA` ..
  `Lane_TeamH` over eight writes, and its `Activity_CheckOrder` still
  votes), `all` over every id (`learnedOnly()`: rename recognition through
  `derivedBases`, and the comparison behind the `conventions:` line).
  Uncovered types take the declared case only where `l` shows none (single
  lower-case words show none there: `lane_sales`, then `lane_backOffice`;
  under a declared PascalCase, which they cannot be, they vote camel)
  and its prefixes do not begin with the other letter (`otherShape`: a
  Modeler file of `Participant_` and hashed `Activity_` ids keeps
  PascalCase), the declared prefixes' shape only where `l` shows none.
  Process and definitions ids are bpmn-cli's (`IdStyle.DEFAULT`:
  `Process_<Name>`, also a new pool's process, never learned from the
  lint-shaped `participant_` ids bpmn-cli wrote) unless an exact
  `bpmn:Process` / `bpmn:Definitions` entry exists (`process_main` and
  `definitions_main` without a name). Under `required` an event whose
  qualified prefix is too long (`IdConventions.ignored`:
  `bpmn:EndEvent:escalation`, one W_CONFIG_IGNORED) follows the learned
  style, and `headsOf` accepts nothing for it. `stalePrefix` for
  W_ID_PREFIX_STALE: the declared prefix of `to` on the rest of the id, or,
  where nothing is declared for `from` (a type switched off, an ignored or
  too long qualified prefix: the rule did not check the id before), the id
  the element's request wants now (its name, else its id's words as the
  context). Without declared conventions none of it runs.
- **Doc, pipeline, ops**: `Doc.conventions` (setting other ones learns the
  style again), `NewDocOptions` / `MutationOptions` / `EditOptions.conventions`;
  `mutateDoc` sets them for the call and puts the caller's back.
  `Doc.allocateId` records an id under a prefix the conventions declare
  for the request (`explain(req).source === 'lint'`: not a lane, a pool or
  a message flow that borrows the sequence flows' prefix) whose base
  differs from what `learnedOnly()` gives (also a split's join and an exact
  process or definitions prefix of `new`, each only where the rule names its
  type); the result's `conventions: { ids, source }`, a
  `conventions:` line in text and `--summary`. `retype` and trigger changes
  record the element's state before them (`recordIdState` in `ops/set.ts`,
  the first record of an id wins); `reportStaleIdPrefixes` builds
  `W_ID_PREFIX_STALE` at the end of the op on its own or of the batch, like
  W_FLOW_ID_STALE: once per element, from its state before the batch to the
  one after, the `bpmn set <file> <id> id=<new>` free after the batch and
  among the hints; none for an element a later op renamed or made fit. An
  id the batch generated (`Doc.generatedBase`; a split's join too,
  `markGenerated`; an explicit claim, `claimId`, takes an id out again, also
  one an op freed) is nobody's API yet: a retype or trigger change gives
  the element the new prefix on the id it wanted (`regeneratedId`, a suffix
  where taken, W_ID_SUFFIXED), a rename with `Rename.regenerated` that the
  entries' details, the notes and the warnings follow (its old
  W_ID_SUFFIXED goes; a later op that names the old id gets an E_NOT_FOUND
  that says so), and no warning. The sequence and message flows the batch
  generated from its ends follow it (`flowsNamedAfter` before the rename,
  `followRenamedEnd` after: `SFGoToSTCheck` -> `SFGoToUTCheck`,
  `flow_task_b_serviceTask_check` -> `flow_task_b_userTask_check`,
  `flow_checkToCheck2` -> `flow_checkToCheck`; `Rename.was` keeps them out
  of the retyped ones in E_NOT_FOUND).
- **Node** (`src/node/bpmnlint.ts`): `projectLint` gives the validator and
  the conventions from one load (memoised per resolved configuration);
  `projectIdConventions(file, opts)` for the CLI's `new` and `show` (its
  notes add the configuration's W_LINT_UNAVAILABLE, and `unavailable` marks
  a `.bpmnlintrc` that did not load, so `show --conventions` names it). The
  notes go into the bpmnlint validator (`bpmnlintValidator(..., { notes })`),
  so `validate` and `new` list them and a write only counts them, with
  `N element-id-naming values ignored (W_CONFIG_IGNORED; ...)` in its
  validator line. `fileContext` passes the conventions unless the host passes
  `conventions` or a validator named bpmnlint; `validate -` gets them
  through `checkLoadedDoc` (lookup from the working directory).
  `LoadedBpmnlint.where` is new.
- **CLI**: `show <file> --conventions` (with `--json`, `--lint-config`,
  `--no-lint-config`, whose help says so and which are `E_USAGE` without
  `--conventions`; a missing path shows a new model there, stdin looks up
  from the working directory; an id or another view flag is `E_USAGE`);
  `new` checks `--id` (`assertProcessId`) and an existing target
  (`assertNewFile`, which `toFile` uses too) first, as main does without a
  `.bpmnlintrc`, then reads the conventions before `Doc.create`;
  `--no-lint-config` says it drops the conventions too. The view names the
  triggers of an event type whose required qualified prefix is too long on
  its row (`message, escalation: qualified prefix ignored, ...`) and in the
  qualifier line (`not the triggers marked above`).
- **Docs and codes**: `W_ID_PREFIX_STALE`, `W_CONFIG_IGNORED`; guide section
  and topic `conventions`, `ID_CONVENTIONS.declared`, one line in the short
  guide (4,638 of 5,120 bytes, 4,522 before); docs/bpmnlint.md (section, the examples of #33 now
  without element-id-naming findings, a `show --conventions` example, all
  three pinned), reference.md (also the JSON field), commands.md (also the
  guide topics), contract.md, library.md, ops.md (the join id),
  validators.md (the engine defaults turn the rule on: the snippet of its
  advisory validators passes `conventions` and `notes`, pinned and run for
  c7 and c8), migrating.md,
  testing.md, README, SKILL.md (run `bpmn show <file> --conventions` before
  the first change in a repository with a `.bpmnlintrc`; the `conventions:`
  line and `W_ID_PREFIX_STALE`).
- **Tests**: `test/conventions-lint.test.ts` (the real rule on every id of a
  new file under 8 settings and of 6 file styles under 8 more, also of
  elements created and then retyped or given another trigger with the flows
  named after them, a split's gateways retyped in the same batch, the join
  after an explicit split id in another case, 0 findings; a
  control with findings; the table, the notes, also for `toString`, a
  prefix outside ASCII and a qualified prefix too long under `required`);
  `test/conventions-declared.test.ts` (drift, what the rule does not name
  in a file with one `Lane_`, hashes or only covered ids, single words,
  qualifier, kind word, suffix and join (also after an explicit split id
  and in a file of bare ids), message flows and new pools' processes over
  many writes, an element created and retyped in one batch, the
  `conventions:` line of `new`, scoped flows, renames into the
  declared form (also of a flow 0.6 named in a file of another flow form,
  #31's recognition), a host table, W_ID_PREFIX_STALE alone and in a batch
  (also for a type switched off), the flows that follow a regenerated id,
  the split's join, an id freed and claimed again, the
  result line and what it leaves out, the view with its reasons, ignored
  prefixes, unqualified triggers and flow heads); `test/bpmnlint.test.ts` (#33's expectations
  updated; the lookup and its switches, the notes in validate / write /
  `new` / stdin, every fixture byte for byte without the rule, the CLI:
  `new` byte-identical in an automation repository and its own errors
  before E_LINT_CONFIG, `show --conventions` with a broken `.bpmnlintrc` and
  a rule name with a typo).

Evidence:

- `npm run gate`: 2072 tests (+246 opt-in; 2008 on main), isomorphism check,
  layout regression 444 (budget 444), fuzz 12 x 15 with 0 errors.
- Against main (with #35, #31, #32 and #33), a build of each: every test
  fixture (49) and `new` without one, under six setups (no `.bpmnlintrc`;
  automation with element-id-naming off; the rule at severity 0 with
  options; a `.bpmnlintrc` without the rule; recommended-for-modeling;
  automation with the rule on and `--no-lint-config`), through `show`,
  `validate`, 20 kinds of `add`, `connect`, `retype`, `set`, `remove`,
  `move`, `layout`, `apply` and `new`: 16,302 command pairs, stdout,
  stderr, exit code and every file in the directory identical (`bpmn show
  --conventions` aside, which is new).
- The whole entry grows 899.2 / 285.2 -> 925.7 / 294.5 KB (minified / gzip;
  the guide's text 7.2, `src/idstyle.ts` 7.0, `src/conventions.ts` 6.4, the
  rest 5.9 KB minified); that does not fit main's budget of 910 / 289 (#33's
  size + about 1 %), so it is raised to 935 / 298, the measured size + 1.0 /
  1.2 %. `applyToXml` only 641.2 / 203.8 -> 653.3 / 208.0 KB (the style 7.0,
  `src/document.ts` 1.6, `src/ops/set.ts` 1.5, `src/ops/flows.ts` 0.7 KB,
  the rest; the conventions module and the plugin's helpers are not in it);
  that does not fit main's budget of 643 / 204 either (#35 lowered it to its
  size), so it is raised to 660 / 210, the measured size + 1.0 %.
- Runtime without a `.bpmnlintrc`, or with the rule off: unchanged (the CLI's
  `add` on orders.bpmn 97 -> 97 ms, gallery.bpmn 151 -> 151 ms, main -> #34,
  interleaved medians of 15). With an automation `.bpmnlintrc`: the table
  takes 1.6 ms (3.3 ms the first time) once per loaded configuration (the
  plugin load is #33's); learning the style twice takes gallery.bpmn's 140
  ids from 0.7 to 1.5 ms (the check whether an id follows the conventions is
  one prefix test per element); a write compares each new id under a
  declared prefix with the file's own style once, and W_ID_PREFIX_STALE is
  built once per retyped element after the batch. The CLI's `add` 133 -> 139
  ms (orders.bpmn) and 191 -> 194 ms (gallery.bpmn), `validate` 100 -> 102 ms
  / 128 -> 131 ms.

Open after #34:

- Topic and message names: Miragon/bpmnlint-rules#68.
- DI ids (`bpmndi:*`) follow their element, also where the rule names a DI
  type.
- `mutateDoc` accepts a split's `branches` without `nodes` silently (the CLI
  refuses them): a library input check, not #34. Fixed in
  `fix/batch-alias-retype-split-input` (above).
- The `conventions:` line compares with the file's own style, which needs
  two ids per rule: a file that follows the rule gets it for its first ids
  and for a kind it has no id of yet. Leaving such ids out would need the
  learned style to say where it has no evidence of its own.

Left for later (low findings of the second review, not fixed in #34):

- A glued collision suffix after a body that ends in a number reads as another number (`serviceTask_step1` + `2` = `serviceTask_step12`, which then pushes the real "Step 12" to `serviceTask_step122`); unique and passes the rule, needs a letter word before the number (`step1No2`) with derivedBases / idNamesEnds following it.
- W_ID_PREFIX_STALE keeps the old id's body as it is: an id that never passed the declared case (`serviceTask_shipGoods` under PascalCase) gets a suggestion the rule still rejects, and a prefix without separator matched by accident (`user` on `userTask_checkOrder`) a garbled one (`manualTask_Task_checkOrder`); fire only for ids that fully passed the rule, or re-case the body.
- Pre-existing (also on main): an op that touches a sequence flow without id crashes with E_INTERNAL (`idNamesEnds` on `undefined`); the change report names a created flow by the id its spliced flow just freed (`ChangeSet.rename` renames every entry with that id); a batch alias used after `retype` of its element is E_NOT_FOUND (swapType makes a new element; fixed in `fix/batch-alias-retype-split-input`, above). Separate issue.

Left for later (low findings of the review after the rebase onto main, not fixed in #34):

- Ids the batch built from a regenerated element's id other than flows keep its old stem: an unnamed element after it (`task_AfterSTCheck` after `UTCheck`), a boundary event on it (`event_TimerOnSTCheck`). Only the flows named after it follow; the rest would need the requests (context, anchor) of what the batch created.
- Message flows that follow the file's own `stemTo` / `stemSnake` form copy the ends' id stems as they are, so one id can mix cases (`mf_askQuestion_to_getQuestion` in a snake file under camelCase). The rule does not check message flow ids; re-casing the stems needs the form learner (`flowForms`) to read the re-cased ids as that form too, or the file's form flips.
- A new pool's process takes `Process_<Name>` as specified, also where the file's processes show a convention of their own (`process_customer`, `process_shop`: `Process_BankAccount`, `process_bankAccount` without a `.bpmnlintrc`). Following the file's process ids where at least two share a prefix would keep such files consistent; the rule does not check processes.
- The batch alias after a type-changing `retype` (above, also on main): a fix (rebind the alias to the element `swapType` makes) changes the output without a `.bpmnlintrc`, so it belongs in a PR of its own. Fixed in `fix/batch-alias-retype-split-input` (above).

## The project's bpmnlint configuration (2026-10-13, `feat/33-bpmnlint`, issue #33)

A team that runs bpmnlint in CI and in a pre-commit hook (`bpmnlint:recommended`,
camunda-compat, `@miragon/rules`, a plugin of its own) got its findings only
after the agent's loop: a change could be valid for bpmn-cli and still fail
the lint gate. Now `bpmn validate` and every write run the nearest
`.bpmnlintrc` ([docs/bpmnlint.md](docs/bpmnlint.md)). The user's decisions
hold: built on Miragon/bpmnlint-rules (`bpmnlint` 11.15.0 and
`@miragon/bpmnlint-plugin-rules` 0.12.0, exact runtime dependencies), the
findings a change adds are reported and never block (library hosts may opt
into blocking, `lintBlocks`), validate exits 2 on bpmnlint errors, no
`.bpmnlintrc` loads nothing, Node 22.12+, the lookup stops at the repository
root (outside a repository it looks only in the model's directory).

- **Core** (`src/bpmnlint.ts`, browser-safe: bpmnlint is injected as `{
  Linter, resolver }`): `resolveBpmnlintConfig` flattens `extends` like
  bpmnlint's Linter but leaves out and lists what it cannot resolve (a name
  bpmnlint cannot parse costs only that entry; async resolvers are awaited;
  an `extends` cycle is walked once, one `W_LINT_UNAVAILABLE` names the
  configs that close it, where a cycle with fan-out ran out of memory
  before; a moddle value that is neither a path nor an object is listed);
  `bpmnlintValidator` lints with a new Linter per run (stateful rules) on the
  XML parsed with the `.bpmnlintrc`'s moddle extensions only, keys findings
  without array indices (an earlier sibling removed changes nothing), turns a
  throwing rule or factory into one `W_LINT_FAILED` (nothing on stderr; an
  async check that rejects and a factory that returns a promise too, never
  an unhandled rejection), reports the lint parse's import warnings
  bpmn-cli's reader does not (`import-warning`, with a hint; design-iq's
  decision link has its own), and
  checks the list rules (`no-implicit-end`, `no-implicit-start`,
  `no-disconnected`, `event-based-gateway`, which counts the outgoing list)
  against the flows: a finding the flows contradict (a file without incoming
  / outgoing lists) is left out of a write and carries a hint in validate. A
  moddle module path the host resolved nothing for is `W_LINT_UNAVAILABLE`,
  not dropped. `BPMNLINT_COVERS`: `W_NO_START`, `W_NO_END`, `W_DEAD_END` are
  dropped where the rule reports on the same element, the finding takes
  their hint.
- **Node** (`src/node/bpmnlint.ts`): the lookup is `findUp`
  (`src/node/find-up.ts`, from #30's closed branch; `gitRoot` added); bpmnlint and the plugin load with `createRequire` (the plugin's ESM
  build fails in plain Node), Linter and NodeResolver from the plugin's own
  bpmnlint, a load failure is one `W_LINT_UNAVAILABLE` and the write goes
  ahead; the chain asks the bundled resolver, then the camunda-compat 2.61.1
  the plugin installs (decision Q1: every camunda-compat config offline),
  then the repository's `node_modules` (only with `lintProjectCode`, which
  the CLI passes; only inside a git repository of the user running
  bpmn-cli, checked by owner as git checks it (`repoOff`: lstat of the
  directory, of the `.git` itself and of a `.git` file's gitdir; root's
  files only for root, the SUDO_UID sudo sets under sudo; git's
  `safe.directory` is not read; a `.git` file that names no git directory
  is no repository, and the message says so; where there are no uids
  (Windows) only a repository inside the home directory and below no
  filesystem root counts, so a planted `C:\.git` with `C:\node_modules`
  runs nothing), so a planted `/tmp/.bpmnlintrc` and
  `/tmp/node_modules`, with or without a `/tmp/.git` (also a link to `/` or
  a hard link to a file of root), run no plugin; entry modules inside the
  repository root only; a package whose config came from there gives its
  rules from there); moddle paths are read as JSON, never executed. The
  owner gates only this tier (decision after the third review): the lookup
  goes up to the root of any git repository, whoever owns it (a `.git`
  file that names no git directory makes none, as for git; a `.git` that
  is no regular file or is over 1 MiB is not read, so a planted FIFO
  cannot block it). Root over another uid's checkout (a CI `container:`
  job, `docker run -v`, `sudo`) and on Windows a repository outside the
  home directory (`C:\dev`) get the repository's `.bpmnlintrc` with the
  bundled and shipped rules, and a project plugin there is left out with
  the visible `W_LINT_UNAVAILABLE` that names the reason and the way out;
  gating the lookup had made lint vanish silently there. A planted
  `/tmp/.git` with `/tmp/.bpmnlintrc` now applies to models below `/tmp`
  that lie in no repository of their own, but only with bpmn-cli's rules
  (advisory) and moddle JSON read from inside `/tmp`. Outside a repository
  the lookup takes only the model's own directory; a library host without
  `lintProjectCode` is told when the setting would not help (no repository,
  another user's), and is not told to install a package it would not run.
  A string `moddleExtensions` is one `W_LINT_UNAVAILABLE`, not one per
  character. A write's validator line says `N left out (W_LINT_UNAVAILABLE;
  ...)`, since a write only counts those.
  `projectBpmnlintSettings` (for #34) uses the same lookup, flags and errors,
  so `--no-lint-config` switches off what #34 reads too (decision Q5). `bpmnlintEngine()` for library hosts; the chain
  itself is not exported (`loadBpmnlint(...).engine.resolver` is it).
- **Validator hook** (`src/validators.ts`, `src/pipeline.ts`):
  `NamedValidator.blocks: false` (advisory: introduced errors among the
  warnings with `severity: 'error'`, old errors only counted, `blocks: false`
  in the report); two validators of one name compare in order; `new` lists
  an advisory validator's findings of the new model; a resolved lint warning
  a resolved validator finding covers is listed once (a host validator with
  `covers`: `resolved:` no longer lists `W_DEAD_END` next to the finding
  that covers it). docs/validators.md has all of it (Advisory validators).
- **Output** (`src/report.ts`): `warning [bpmnlint error] <rule> <id>` for an
  error a write added, `[bpmnlint error] <rule> <id>` in validate; an
  advisory validator's findings group by code and message (decision Q3); its
  line adds `(N added, M resolved, K already in the file)`, and `--summary`
  counts K in its `warnings:` line; validate folds three or more findings of
  a rule with one hint into one line that lists the ids with the message it
  shows (a real dead end among list findings keeps its line;
  `W_LINT_UNAVAILABLE`, `W_LINT_FAILED` and `import-warning` never fold;
  gallery.bpmn: 142 findings in 16 lines; `--json` lists all).
- **CLI**: `--lint-config <path>` / `--no-lint-config` on validate and every
  mutating command; a write looks up from the file it writes (`-o`), a
  model from stdin without `-o` from the working directory (a removed
  working directory: no `lintFrom`, absolute paths still run). Exit codes
  are set with `process.exitCode` (validate's 2 and 5, a write's `--strict`
  5, every error), and the CLI exits once stdout and stderr took what was
  written (`exitWhenWritten`): `process.exit` right away cut piped output
  off at 64 KB on macOS, which a `.bpmnlintrc` made common (`validate
  --json` exits 2 on its errors), and waiting for the event loop let a
  project plugin's timer keep the process alive. `EPIPE` on stdout or
  stderr (`| head`) is ignored, so the exit code stays and no trace is
  printed (the audit's open `EPIPE`, now also on the success path).
- **Pre-existing, fixed on the way** (the third review found them): stdin is
  read as a stream (once commander's `node:process` import touched
  `process.stdin`, a pipe was non-blocking and `readFileSync(0)` failed with
  `EAGAIN` whenever its writer was slower than the start: `curl ... | bpmn
  validate -`); `writeAtomic` turns a failed write into `E_IO` (`-o` naming
  a directory: "it is a directory", exit 4, was `E_INTERNAL` 70) and leaves
  no temp file.
- **Docs and codes**: `W_LINT_UNAVAILABLE`, `W_LINT_FAILED`, `E_LINT_CONFIG`;
  guide section and topic `bpmnlint` (not `lint`, which names bpmn-cli's own
  `W_*` checks); docs/bpmnlint.md, and the advisory validators with the
  library example of bpmnlint in docs/validators.md; SKILL.md tells the
  agent to fix added findings in the same batch and to pass
  `--no-lint-config` in a repository or folder the user does not trust (a
  project plugin runs under the skill's pre-approved `bpmn` command); the
  short guide's CONTRACT says bpmnlint only reports.
- **Node floor**: `engines.node` `>=22.12.0` (commander 15 and vitest 5 need
  it), a CI job builds and tests on 22.12, every Node 20 mention is updated.
- **Tests and tools**: `test/bpmnlint.test.ts` (54 cases: a model outside a
  repository, a `.git` of another uid (its `.bpmnlintrc` applies, its plugin
  does not run), also a planted link to `/`, a hard link to a gitfile and
  to `/etc/hosts` (skipped as root and on Windows), a `.git` file without
  its git directory, a system without uids (Windows, simulated; also a
  repository outside the home directory), async rules, extends cycles with
  fan-out; the CLI cases run a tsc build of `src/` under plain node, also
  root over another uid's checkout (a preload makes `process.getuid()` 0:
  exit 2 on a bundled rule, the plugin named), a broken install, a hoisted
  old bpmnlint, JSON beyond 64 KB through a pipe, a pipe closed after the
  first chunk, a plugin that leaves a timer running, a removed working
  directory and the `-o` lookup); `test/cli.test.ts` a slow stdin writer
  and `-o` naming a directory; `test/global-setup.ts` stops the run when a
  `.bpmnlintrc` lies above the temporary directory or the repository; fuzz,
  bench (feature detected) and the layout regression pass
  `--no-lint-config`.

Rebased onto main after #35 (design profile removed), #31 (id cutting) and
#32 (flow ids kept), squashed into one commit (the branch before:
`pr39-before-rebase`):

- #35's removal is final: no `--profile`, `profile` / `contentRepo`, design
  validator or `docs/design-iq.md` came back. What #33 said about the design
  profile went: `--profile none` keeping bpmnlint (docs/bpmnlint.md, the
  guide's BPMNLINT section), the E_VALIDATION hint and catalogue text about
  `--profile none`, the design line of the validator-findings note in the
  guide's OUTPUT. The resolved-once behaviour stays as a rule of the hook
  (`covers`), and its test uses the host validator `gate` of
  test/validators.test.ts instead of the design profile.
- The advisory validators (`blocks`, the same-name pairing, `covers`
  passing its hint, `advisoryValidators` for `renderSummary`) are in
  docs/validators.md, with the bpmnlint example that was in
  docs/design-iq.md (test/bpmnlint.test.ts reads it there); docs/library.md
  links to them.
- The decision-link hint of an `import-warning` no longer names
  `W_DESIGN_DECISION_LINK` (gone with #35); it says what the link is.
- #32 stays as it is: `BPMN_KEEP_FLOW_IDS` / `envSwitch` in src/cli.ts next
  to `lintOptions` / `workingDir`, `keepFlowIds` and the lint options in
  `mutationOptions`; vitest has `setupFiles` (test/setup.ts) and
  `globalSetup` (test/global-setup.ts); the layout regression passes
  `--no-lint-config` and `CLI_ENV`, the fuzz and bench executors both.
  The hints and catalogue entries #33 added name the file first or name no
  command.

Evidence:

- `npm run gate` (on main after #35, #31 and #32): 2008 tests (+246
  opt-in), isomorphism check, layout regression 444 (budget 444), fuzz 12 x
  15 0 errors. The whole entry grows 880.9 / 278.6 (main) -> 899.2 / 285.2
  KB (+18.3 / +6.6 KB, as before the rebase: the validator about 8 KB with
  its hints, the guide's bpmnlint text and codes about 8 KB, bpmn-moddle
  10.3 and the advisory output of the report the rest). Main's budget of
  883 / 279 cannot hold that; it is raised to 910 / 289, the measured size
  + about 1 %, as main keeps its budgets close. `applyToXml` only 640.4 /
  203.5 -> 641.2 / 203.8 KB, within main's 643 / 204 (unchanged). The guide
  adds 124 to 153 KB (38 to 47 KB gzip) to `applyToXml` (docs/library.md
  said 116 to 140; main itself measures 121 to 146 with this lock file).
- Runtime without a `.bpmnlintrc`: unchanged (one stat per directory up to
  the repository root, or up to `/` outside one). The repository check of a
  loaded `.bpmnlintrc` (the walk to `.git` and one stat) costs under 0.01 ms. With one (recommended, `@miragon/rules`
  automation, camunda-compat 7-24, the camunda moddle): the CLI's validate
  76 -> 103 ms (orders.bpmn), 92 -> 131 ms (gallery.bpmn), a write 101 ->
  138 ms / 154 -> 198 ms (loading bpmnlint and the plugin is about 25 ms of
  it); in process, warm, `mutateFile` +7.5 ms, `checkFile` +4 / +12 ms.
- Findings equal bpmnlint's own Linter on orders.bpmn and gallery.bpmn
  (test).

Open after #33:

- Upstream, for Miragon/bpmnlint-rules (not filed): the ESM build does not
  load in plain Node; the bundle has only camunda-compat 7-24 / 8-10; the
  peer range should be `bpmnlint >=11.14` (an older hoisted bpmnlint cannot
  load the plugin); the element-id-naming doc comment names
  `miragon/element-id-naming`; the README's JSONC `.bpmnlintrc` examples are
  rejected by `npx bpmnlint`.
- `bpmn layout` drops a group's BPMNShape (gallery.bpmn's
  `Group_FirstTasks`): a separate bug, not #33. Fixed in
  `fix/full-redraw-keeps-groups` (see "Group boxes over a full redraw").
- `src/node/find-up.ts` and `test/find-up.test.ts` came from #30's branch
  (`fix/30-designiq-yml`, PR #36, closed unmerged once #35 removed the
  design profile): they are new files of this branch, and only the
  `.bpmnlintrc` lookup uses them. #34 builds on `projectBpmnlintSettings`
  and `bpmnlintEngine().plugin.naming`.

Left for later (low findings of the third review, not fixed in #33):

- `loadBpmnlint` caches what a `.bpmnlintrc` could not resolve: a long-running host keeps saying "is not installed" after the install, until it restarts or the file changes (documented now; a fix keys the cache on the involved package.json / descriptor mtimes, or does not cache project-side failures).
- A whole-model `W_LINT_FAILED` (bpmnlint could not lint the model, e.g. moddle descriptors BpmnModdle rejects) is the same before and after, so a write only counts it and its validator line does not say that no rule ran (validate lists it; its hint and the catalogue are corrected); descriptor objects are not checked up front.
- List-rule findings a write leaves out on a file without incoming / outgoing lists are not counted: the write's validator line can read `0 error(s)` while `bpmn validate` exits 2 (a `N left out (incoming / outgoing lists)` note needs a per-run count from the validator).
- The lookup walks the path as written: a model reached through a symlinked directory from outside the repository (`mlink -> repo/models`, `bpmn validate mlink/x.bpmn`) gets no repository `.bpmnlintrc`, while git, which starts from the physical directory, finds the repository; a realpath start would flip the opposite case (an in-repository link to a directory outside it), so pick one rule and document it.

## Flow ids kept on request (2026-10-13, `feat/32-keep-flow-ids`, issue #32)

A splice, a bridge, a move or `set <flow> source=` / `target=` renames a
flow whose id names its old ends. Where flow ids are API (bpmn-to-code
writes them into the generated process API, process tests name them), that
rename breaks code far from the model. The library could keep them
(`Doc.followFlowEnds = false`), but the CLI had no switch, and nothing said
which ids no longer name their ends. The decisions: one name at every
layer; flag > `BPMN_KEEP_FLOW_IDS` > library option / `Doc` field > default
(rename); no project config file (#34 reads id conventions from the
`.bpmnlintrc` and adds none); a strict environment value; the warning only
from the change that makes a flow stale.

- **Switch** (`src/cli.ts`): `--keep-flow-ids` / `--no-keep-flow-ids` on
  every mutating command and `apply` (`withMutationOptions`), else
  `BPMN_KEEP_FLOW_IDS` (`envSwitch`: unset or empty = default; 1 / true /
  yes / on and 0 / false / no / off in any case; anything else is `E_USAGE`
  with a hint). Only `mutationOptions` reads it, so `show` and `validate`
  never fail on it, and a flag decides without reading it. `src/cli.ts` is
  still the only module that reads the environment.
- **Library**: `MutationOptions.keepFlowIds` and `EditOptions.keepFlowIds`.
  `mutate()` sets `Doc.followFlowEnds` for the call and puts the caller's
  value back in `finally` (an explicit option wins; undefined: the field).
  `Doc.followFlowEnds = false` no longer keeps every id: a flow the same
  call created follows its ends (migrating.md, library.md).
- **One test for a rename and a stale id** (`ops/flows.ts idNamesEnds`,
  extracted from `followEnds`). With ids kept, `followEnds` records a flow
  whose id named its old ends (`Doc.recordKeptFlow`; the first ends stay
  while the flow has the id it kept, so a flow the batch renamed with `set
  id=` takes that id and a later splice records the ends that id named)
  instead of renaming it, but only a flow the document had before the batch
  (`Doc.flowsBefore`, the sequence flows as elements, with their ends, when
  `runBatch`, or a `runOp` outside a batch, starts: a flow an earlier op or
  the op itself created is nobody's API and still follows;
  `BatchContext.created` holds ids, which a later rename changes).
  `runBatch` turns the kept flows into `W_FLOW_ID_STALE` once, after
  `stillHolds`, against each flow's final ends (`reportStaleFlows`,
  `staleFlowWarning`): one per flow, none for a flow a later op removed or
  put back between its old ends, and none for a flow that ends where it did
  when the batch began (a flow that was stale before: moving a node a splice
  put in away and back, `move X --after C` then `move X --after A`, runs it
  through the ends its id names and back, which recorded it again). `runOp`
  on its own (no batch) reports its own. The
  message names the old and the new ends; the hint is `bpmn set <file>
  <flowId> id=<suggested>`, where the suggestion is what `IdStyle.next`
  gives the new ends against the document's ids plus the hints before it in
  the same report (`reportStaleFlows` keeps a copy of the registry): two
  flows that end up between the same ends get the id and its `_2`, so every
  hint can be followed. The document claims none. In every flow form it is
  the id the default rename gives (`test/conventions-ids.test.ts`).
- **Move puts the out-flow back** (`ops/move.ts`, `Doc.keepsFlowId`, the
  `reuse` of `createSequenceFlow` / `placeNode`): with ids kept, a moved
  node's one out-flow, which the detach takes out, is put back as the first
  flow the placement creates out of that node (a splice's node -> old
  target, a prepend's node -> anchor, the append of the next node of the
  chain, which a gateway always gets: a gateway followed by another node of
  the chain keeps it for that append, so `move Gateway_Ok Activity_Book`
  keeps Flow_OkToBook between them and the gateway's splice makes a new
  flow), with its id, documentation and extensions. Its name, condition
  and annotations stay with the bridge (`detachNode` carries them), and it
  is no longer a default flow; a node that is not bridged (`detachWithBridge`
  and `detachNode` now return whether they bridged) drops name and
  condition, and once the flow is put back to another node
  `W_LABEL_DROPPED` / `W_CONDITION_DROPPED` name it (before, they were gone
  without a word); between its old ends once the chain is placed it gets
  them back, and its default marker (`giveBack`), also when a later node of
  the chain takes it back there (`giveBackLate` withdraws the warnings:
  `move A B --after X` with A not bridged splices A -> B in as A -> Done,
  B's splice after A ends it at B again). A default the move gives the node
  (`"default"` on a prepend, batch and library only) wins over the marker
  (the change entry adds `no longer the default flow of <node>`), and a flow
  it made the default flow gets no condition (`W_CONDITION_DROPPED`; it had
  kept it, a default flow with a condition). A `flowId` for the flow a
  prepend creates (node -> anchor, batch and library only) names a new flow
  instead (`createSequenceFlow` ignores `reuse` with an id). The result
  lists the put-back flow as changed (`B -> A (was -> C)`), not as removed
  and created. The chain runs through these flows, so `move B C` keeps B -> C
  between B and C, unless B has several out-flows (then it is removed with
  B's other flows). When the detach of a node takes out the flow from the
  node moved before it (the node is not bridged: an end event, a join;
  `move C Done --after B` on a line, which changes nothing), that flow is
  filed under the node before, and the append puts it back with its name,
  condition and default marker (it used to come back as `Flow_CToDone_2`).
  What nothing puts back stays removed: the out-flow of the last node
  appended after a gateway or a node without successor, the other flows of
  a node that is not bridged (several in- or out-flows, or none in or none
  out; its single out-flow and the flow from the node before it are put
  back), and with `--in` the group's out-flow. Default mode never reuses
  (no output change). The incremental layout reroutes a put-back flow like
  any flow whose ends changed, also into a collapsed sub-process's plane.
- **Id style read before the ops** (`ops/index.ts readIdStyle`): `runBatch`
  and `runOp` on its own read `Doc.idStyle` before the first op. It was
  learned lazily when the first new id was needed, from the ids, names,
  types and flow ends then in the file, so whatever ran before changed it: a
  first op that removed flows (also a single `move`, whose detach removes
  them), `set <flow> id=`, `set <node> name=` or `retype` could make it learn
  another style (prefix `F` -> `Flow`, `idPair` -> `named`, `UserTask_` ->
  `ServiceTask_`): new ids in that style, and a flow whose id named its old
  ends was neither renamed nor reported. This changes default-mode output
  against 0.6 in those batches and commands (migrating.md).
- **Report**: it is an op warning, so it is in `warnings.added` of the
  change that made the flow stale only; it counts for `--strict` (exit 5),
  `bpmn validate` never lists it (without the old ends a lint could only
  guess), and it never floods (`report.ts NEVER_FLOOD`: each line carries its
  own command). There is no `renamed` key when ids are kept.
- **Hints name the file**: the `W_OPTION_IGNORED` hint of `add --flow-id`
  on a splice, both `E_INVALID_RETYPE` hints, the `E_CROSS_SCOPE` hint, the
  hints of `E_INVALID_TRIGGER` (retype, set), `W_FLOW_DROPPED`, the lane
  conflict of `add lane`, a blocked `attachedToRef`, a default flow's
  condition, a call activity's `calledElement`, a boundary event's `place`,
  the notes of a self loop and a split whose branches all end, and the
  catalogue entries `E_DANGLING_REF`, `E_FLOW_LINKS`, `E_CROSS_SCOPE`,
  `E_INVALID_HOST`, `E_LANE_CONFLICT`, `W_NOT_IN_LANE`, `W_UNREACHABLE`,
  `W_C7_DEPLOY_HISTORY_TTL` named a command without `<file>`. A test now
  checks every command with arguments in the catalogue and in the strings
  under `src/` (a small scanner in the test reads the string literals and
  templates, so comments and regular expressions are left out and escaped
  quotes hide nothing; not TypeScript's compiler API, which typescript 7,
  Dependabot #28, no longer exports; a command with an option first is a
  name, not one to paste).
- **Test isolation**: `test/setup.ts` (vitest `setupFiles`) deletes
  `BPMN_KEEP_FLOW_IDS` before every test file, so the CLIs the tests spawn
  rename as by default; `CLI_ENV` in `tools/fuzz/lib/setup.mjs` is the
  environment of the fuzzer, the benchmark, `tools/layout-regress.mjs` and
  the demo.
- **Docs**: the guide (catalogue `W_FLOW_ID_STALE` after `W_ID_SUFFIXED`,
  the common options, CONTRACT, OUTPUT, ops JSON, the `--flow` rule,
  `kinds --section ids`; `guide --short` one line more, 4,389 of 5,120
  bytes), docs/contract.md (the limitation says how to keep ids),
  commands.md, reference.md (Ids and a new Environment table), library.md,
  ops.md, testing.md, migrating.md (Changes from 0.6), the skill (when to
  keep flow ids; `BPMN_KEEP_FLOW_IDS` in the `env` of the Claude Code
  settings, because an inline variable in front of `bpmn` is not covered by
  the pre-approved `Bash(bpmn *)`) and recipes.md. `E_USAGE` (catalogue,
  exit code 1 in the guide and reference.md, the skill's error table) names
  a bad `BPMN_KEEP_FLOW_IDS`, the first variable that can fail a command.

Evidence: `npm run gate` passes with 1,942 tests (+246 opt-in; 28 new:
`test/keep-flow-ids.test.ts` for every op that changes the ends of a flow,
the negatives, a batch, a flow the batch renames with `set id=`, a flow an
op creates (also `runOp` on its own), a move that puts back the node's
out-flow and a group move (spliced and appended; a second node that is not
bridged: an end event, a shared end, a join; a gateway first), a moved node
that is not bridged with a labelled, conditional out-flow (also first in a
chain whose next node takes the flow back, and as a prepend made the
default flow, next to a default the prepend gave), a later change
that leaves a stale flow where it was, the library precedence and the
report; `test/conventions-ids.test.ts` for every flow form, two flows with
the same new ends (hints `Flow_OkToJoin` / `Flow_OkToJoin_2`) and the style
read before a batch that removes first; `test/cli.test.ts` for the flag, the
variable and its bad values on the built CLI; `test/isomorphic.test.ts` in
the browser bundle; the doc pins in `test/batch.test.ts`, whose string
scanner checks itself and passes with typescript 7.0.2 installed); the
layout regression stays at 444 and the gate's fuzz campaign is unchanged
(173 ok, 7 refused, 0 errors). With `BPMN_KEEP_FLOW_IDS=maybe` set in the
shell the CLI tests still pass. Default mode does the same work as before
(`idNamesEnds` is the old check); against origin/main it differs only where
the style read applies (seeded batches at the `runOps` level: 27 of 2,000
differ, none once main's `Doc.idStyle` is read before the ops too). With ids
kept, a batch takes one set of the document's sequence flows and runs
`idNamesEnds` and `IdStyle.next` once per stale flow at its end: 60 splices
in one batch, ops alone 96.5 ms following vs 94.2 ms kept, `applyToXml`
without layout 120.7 vs 121.6 ms (noise). A `runOp` outside a batch takes
the same set once per op (only with ids kept; every CLI and pipeline path
runs a batch): 60 single splices on a 200-flow chain, 125.0 ms following vs
119.7 ms kept (noise). Bundle: whole entry 872.5 -> 880.9 KB minified (275.7
-> 278.6 gzip), `applyToXml` only 636.0 -> 640.4 KB (201.9 -> 203.5), within
main's budgets (883 / 279 and 643 / 204 KB, unchanged; the whole entry's
gzip is 0.4 KB below its budget). Seeded random batches after the third
review: with ids kept, 1,400 batches (4,901 ops, 1,919 moves, each also op
by op) keep every invariant (no flow gone without `removed:`, no file flow
renamed, hints free and followable, the same DI edge id, no new validation
error) except the chain in Left for later and one hint case older than this
round. The check that a move never replaces a moved node's out-flow with a
new flow out of it failed in 12 of them before and fails in that 1 now, and
the 2 repeated stale warnings are gone. Default mode is byte-identical to
the state before the third review in 3,258 comparisons (600 batches with and
without layout, and each op alone).

Rebased onto main after #35 (the design profile removed) and #31 (ids cut
at whole words): `--keep-flow-ids` and `keepFlowIds` follow #35's removal
of `--profile`, `profile` and `contentRepo` (none is added back;
library.md points at validators.md); `idNamesEnds` carries #31's forms of
`derivedBases` (in a file of another flow form also the `named` id, and the
ids 0.6 cut); the catalogue keeps #31's `W_ID_SUFFIXED` with
`W_FLOW_ID_STALE` after it, and `kinds --section ids` #31's length and
collisions with the renames of both. The test count, `guide --short`, the
bundle, the layout regression and the fuzz campaign above are measured on
the rebased tree (main alone: 1,914 tests, 4,282 bytes, 872.5 / 275.7 and
636.0 / 201.9 KB, score 444, 173 ok, 7 refused, 0 errors); the timings,
the comparison with the old main and the random batches were measured
before the rebase.

Left out, for later:

- `bpmn set <flow> id=`, the hint's command, does not move a derived DI edge
  id the way the automatic rename does (`BPMNEdge_<old>` stays): a cosmetic
  mismatch, a follow-up of its own. Fixed in
  `fix/di-ids-within-64-follow-renames` (see the section at the top), for
  shapes too.
- There is no repository default in a project file; the flag and the
  variable set it. A result does not say why ids were kept (flag or
  variable): for the variable it does since 2026-10-13 (see the section at
  the top); a flag is the caller's own.
- `add --flow-id` on a splice with ids kept gives two rename hints for one
  flow: `W_OPTION_IGNORED` with the given id, `W_FLOW_ID_STALE` with the
  speaking one.
- An end renamed earlier in the same change (`set <end> id=`, or `name=` on
  an end without a speaking id) hides the next end change of its flows:
  `idNamesEnds` labels the end as it is then, so `Flow_CheckToOk` after `set
  Activity_Check id=Activity_Verify` no longer names its ends and gets
  neither a rename nor `W_FLOW_ID_STALE`, the same in both modes. A fix
  would record each end's id and name at batch start (`flowsNow`) and accept
  those too.
- The flow a splice creates (new node -> old successor) has no alias:
  `flowAs` on a splicing `add` names the kept flow into the node. The docs
  say so; an `outAs` key would be new syntax.
- With ids kept and no layout (`--no-layout`, or a second `BPMNDiagram` the
  incremental layout leaves alone), a put-back flow keeps its BPMNEdge with
  the old waypoints and the result has no `run bpmn layout` note (default
  mode removes that flow's edge and says so); the next incremental write
  leaves it stale too. Default mode keeps bridged and spliced edges stale
  the same way; a fix would drop the edge of a flow whose ends changed, or
  reroute edges that no longer touch their ends. Both done since
  2026-10-13 ("Stale edges of flows whose ends changed" at the top).
- In a file of mixed id styles, following `W_FLOW_ID_STALE` hints can tip
  the learned style (`IdStyle` takes the first prefix seen on a tie: a move
  declares a put-back `F3` before `G1`), so the next read no longer sees the
  followed ids as naming their ends: a later end change neither renames nor
  reports them. The drift is older than #32 (origin/main switches `fX` to
  `Flow_X` after a few adds to polish-rename.bpmn); a fix belongs in
  `idNamesEnds`, accepting the forms of every flow prefix in use. Fixed
  since 2026-10-13 (see "A file's flow form stays put" at the top).

## Ids up to 64 characters, cut at whole words (2026-10-13, `fix/31-flow-id-cut`, issue #31)

A splice renamed `Flow_ConsignationsSynchronisierenToConsignationsAktualisiert`
to `Flow_ConsignationSynchronisierenToConsignationsProtokollieren`: a letter
short, although the full id has 62 characters. Two defects: every generated
id was capped at 61 (`MAX_BASE = MAX_ID - 3`, room for a collision suffix
`_99` on every id, needed or not), and `fitPair` shared the room by
characters and cut the head of an end with `cutAt`, whose fallback for a
first word longer than the room cut inside a word that could go whole.

- **The cap** (`src/idstyle.ts`): `MAX_BASE` is gone; `derived` and `wanted`
  take a `max` (default `MAX_ID`), so the cap no longer cuts an id within 64
  characters (a name's 40-character slug, `MAX_SLUG`, is unchanged).
  `next()` cuts a base again only when base and suffix pass 64: a flow
  shares what is left between its ends (`wanted(req, 64 - suffix)`), an
  anchor-qualified id keeps the anchor's kind, the suffix separator stays
  (`2` for stemTo / scopedTo). `joinId` cuts at `MAX_ID - 5`; `joinIdFor`
  (`src/ops/split.ts`) cuts a suffixed join so that `_join_2` stays within 64.
- **Whole words** (`fitPair`, `endForms`; `idWords`, `keptTail` in
  `src/ids.ts`; `cutAt` now keeps whole `idWords` too, one definition of a
  word, so a slug that begins with `_` is no longer cut to nothing): each
  end lists its forms (`endForms`), giving up its last word one at a time,
  never its first word, its Join / number tail, its last word with a letter
  before that tail (`Flow_2LieferantenbestellungsuebeTo...`, 0.6:
  `Flow_2To...`; `Flow_LieferantenbestellungenJoinTo...`, never a bare
  `Flow_JoinTo...`) or a word between two numbers (no `Stufe23`, nor
  `stufe_2_2` for `stufe_2_pruefung_2`, which read like a suffixed id and
  made `next()` skip `_2`); a number the given-up word leaves at the end of
  the id goes too where it reads like a collision suffix (`closingNumber`:
  a separated `_4` where the suffix is `_2`, any number before a glued `2`
  in stemTo / scopedTo; a stemSnake `..._to_lieferantenbestellungen` for
  `Task_lieferantenbestellungen_4_augen_ab`, never `..._4`), and stays
  elsewhere (`Flow_Phase1To...` and `Flow_Phase2To...`, which an earlier cut
  of this branch made one `Flow_PhaseTo...` and a `_2`; a default target
  `...ToLieferantenbestellungen4`). Ends that begin with the same word
  keep their last word and give up the word before it, down to the first
  one (`Flow_SynchronisierenToLieferantenbestellungenProtokollieren`). Of the
  pairs of forms that fit, fitPair takes the one with the most words, then
  the most characters, then the more even one, then the one where the
  source gave up more: a short word goes before a long one
  (`Flow_SynchronisierenToRechnungLieferantenbestellungen`, not
  `Flow_SynchronisierenAktualisierenToRechnung`), and
  `Flow_NeueToZahlungseingaengePruefenUndAbgleichen` keeps its five words. A
  word is cut inside only when even the shortest forms do not fit: in the
  longer end, where the other fits whole and it keeps 8 characters
  (`Flow_LieferantenbestellungsueberToZahlungseingangsbestaetigungen`), else
  in both (`sharePair`); `cutInside` keeps the Join / number tail where the
  head keeps a letter and does not run into it
  (`Flow_3Zahlungseingangsbest2024To...`; before: `Flow_32024To...`, the word
  between the numbers dropped). A camelCase end that loses its first word
  starts as camelSlug writes it, from the label's words where it has them
  (`Flow_urlPDFVersendenTo...`, not `urlpdf`, also where camelSlug cut the
  name at 40). `endForms` lists only the forms that can fit (and the
  shortest), so ends of any length are cut fast (`derivedBases` on ends of
  1,600 words: 256 ms of CPU before, 5 ms). `cutAt` keeps a letter too:
  where the whole words that fit have none or end in a number the kept one
  would run into, it cuts the next word inside (`orderFulfilmentProcessTask_2URLAPI...abgleic2`,
  0.6: `..._22`; `Flow_10Warenwirtschaftssyst10To...`, 0.6: `Flow_1010To...`);
  `cutAt(slug, max, true)` cuts as 0.6 did (`legacyCutWords`, 0.6's loop:
  a slug that begins with `_` and whose first word does not fit is cut to
  nothing), for recognising its ids.
- **Flows named by their ends' ids** (idPair `Flow_<sourceId>_<targetId>`,
  as design-iq writes them, and idSnake): each end keeps its prefix, the
  words after it share the room, and "ends that begin alike" compares those
  words, not the prefixes
  (`Flow_Task_lieferantenbestellungen_pruefen_Task_zahlungseingaenge`; 0.6:
  `Flow_Task_pruefen_Task_zahlungseingaenge_abgleichen_und`). Below a room
  of 16 (two long prefixes, also from a suffix) the whole ids share it, cut
  by fitPair like any ends, so the words of a prefix can go too
  (`Flow_intermediate_protokollieren_intermediateCatchEvent_gebucht` for two
  `intermediateThrowEvent_` / `intermediateCatchEvent_` ids).
- **Scoped flows** (`Flow_KotO_ValidateToReserve`): the two end words share
  the room after the scope like any ends, so the target is no longer cut
  away (`Flow_KotO_WarenwirtschaftssystemToKundenstammdatenaktualisierung`;
  0.6: `Flow_KotO_WarenwirtschaftssystemabgleichTo`, which `SCOPED_TO` no
  longer reads, so enough of them flipped the file's form); an end word is
  the first word with a letter of the id (`Augen` for
  `serviceTask_KotO_4AugenPruefen`, 0.6: `To4`, a second one `To42`).
- **Long prefixes**: a file prefix that leaves an element's body fewer than
  8 of the 64 characters gives way to the bpmn-cli prefix of the kind in
  the file's case (`activity_auftrag`; 0.6 kept a body of 8 and went past
  64), `withWord` cuts body and anchor word as one where the word leaves the
  body fewer than 8; a flow prefix (with a scopedTo flow's scope) that
  leaves its ends fewer than 16 gives way to a named flow with `Flow_` in
  every flow form (a scoped one named by its end words:
  `Flow_Validate_To_Ship` for a 57-character scope; before: stemTo
  `<prefix>_To`, scopedTo `Flow_<scope>_To`, both ends empty and past 64),
  and `pairEnds` never passes fitPair a negative room.
  A glued flow named by its ends with a suffix
  (`flowVertragsunterlagenarchivieToKundenstammdatenaktualisierung_2`,
  `GLUED_SUFFIXED`) lends no prefix in `learn`: 0.6 read it as the prefix
  `flowVertrags...` and a number, and three of them made that the flow
  prefix (80-character ids, splices not followed). In a file of `flow12`
  ids it still counts for their form, as 0.6 counted it (an earlier cut
  of this branch dropped it from the count, and such a file switched to
  `Flow_` a few edits sooner, its glued flows no longer followed).
- **Cut flows vote for their form** (`cutOfForm` in `learn`): a flow whose
  id matches no form uncut votes for a form built from its ends' ids
  (stemTo, idPair, stemSnake, idSnake) when it is one of the cuts
  `derivedBases` lists for that form (also 0.6's), with or without a
  suffix; cheap tests first (the word between the ends, a stemTo source in
  lower case, the start of a stem form's source). Before, enough cut flows
  flipped an idPair / idSnake / stemSnake file to `named`: the 7th
  long-named splice in an idPair file renamed nothing, and new flows
  switched convention. In a file whose flows read as any other form than
  `named`, `derivedBases` also lists the `named` bases (uncut, cut for a
  suffix, and as 0.6 cut them, also again for `_100`; with the form's
  prefix and the file's most used flow prefix, `namedPrefixes`, which 0.6
  took), so the `named` flows bpmn-cli gave it before still follow their
  ends: 0.6's in an idPair / idSnake file it read as `named`
  (`Flow_PackOrderToArchiveOrder`, renamed to
  `Flow_Activity_PackOrder_Activity_WeighParcel`), 0.6's cut ones to a
  suffixed end (`Flow_lieferantenbestellungsueberToLieferantenbestellungsuebe2`),
  and a flow to a join, named by the join's label (`CheckOrderJoin`). An
  id an author wrote in that form follows too (nothing tells it apart;
  `ID_CONVENTIONS.renames` and docs/reference.md say so): of 537 files on
  disk one flow changes, in a stemTo file whose start event has a
  snake_case id, renamed where 0.6 kept it. Cost: `IdStyle.infer` on 300
  flows of which 250 are cut, 2 to 6 ms of CPU (idPair) and 3 to 11 ms
  (idSnake); a file of named flows is unchanged.
- **Flows written by 0.6** (`derivedBases`, used by `followEnds`): the uncut
  id when it has at most 60 characters, else also the ids at 64 to 60 (a
  suffix of up to 4 characters, `_100`), the id 0.6 cut (`legacyFitPair`,
  the old algorithm with 0.6's `cutAt` and scoped end words, kept only for
  this) and that id cut again to 60, as 0.6 did for a suffix from `_100`,
  so a flow 0.6 cut inside a word still follows its ends; and the id 0.6
  wanted before its cap, with the file's head also where it now gives way
  to `Flow_` (a 65-character `Flow_<41-character scope>_ValidateToShipping`
  follows its ends as in 0.6).
- DI ids keep `MAX_DI` 61 and go through `cutAt`, so only its letter guard
  changes them: a DI id 0.6 cut to a bare number or to two numbers in a row
  is not recognised by `edgeStyleOf` and keeps its id when its flow is
  renamed. Fixed in `fix/di-ids-within-64-follow-renames` (`diStyleOf`
  also compares the 0.6 cut; see the section at the top).

Ids differ from 0.6 for the same edit where an id has 62 to 64 characters or
has to be cut; one pinned id changed: the long-names test's flow keeps the
most characters among its cuts of seven words,
`Flow_PruefenObDieEingereichtenUnterlagenToBenachrichtigungUeber` (0.6:
`...EingereichtenToBenachrichtigungUeberDen`, 7 characters shorter). Runtime: a splice write
with long names is unchanged (4.6 to 4.7 ms median, as in 0.6), the
layout-regression score (444) and the gate's fuzz campaign are identical; on
long name pairs `derivedBase` takes about 10 instead of 7 microseconds and
`derivedBases` about 50 instead of 12 (a few calls per renamed flow; in a
file of another flow form than `named` about three times that for its
`named` bases, while a long-named splice write in an idPair file stays at
2 to 3 ms median, as before).
Bundle (on top of #35): whole entry 865.8 / 273.2 -> 872.5 / 275.7 KB,
`applyToXml` only 630.6 / 199.9 -> 636.0 / 201.9 KB. The budgets #35 set
stay (883 / 279 and 643 / 204, `tools/iso/budget.json` unchanged): the
change fits them, `applyToXml` 7.0 / 2.1 KB below and the whole entry
10.5 / 3.3 KB below, so nothing needs raising (before #35 this branch had
raised the gzip budget of `applyToXml` from 206 to 207 KB);
`docs/library.md` updated.
Tests: `#31` cases in `test/step3-ids-report.test.ts` (the issue's ids,
camelCase, a seeded check of 2,000 name pairs whose cut ends have no room
for their next word, a cut inside a word in one end, fitPair's tie, tail
and first-word rules, the cut with the most words and characters, ends
with numbers (`Phase1To...` / `Phase2To...`, no suffix skipped after
`stufe_2_pruefung_2`), never a bare `JoinTo`, a camelCase end without its
first word, also from a name cut at 40, `cutAt`'s letter guard, 2,000
random idPair / idSnake flows, a 0.6 flow, also with `_100` and a leading
separator, suffixes up to `_101` and none skipped, stemTo `2`, a suffix on
an id that names the anchor's kind, a 58-character file prefix, long flow
prefixes and a long scope in every flow form, an idPair file through seven
long-named splices, a stemTo file's `named` join flow, flows 0.6 named in
files that now read as idPair, idSnake and stemTo (also cut to an end with
a suffix) and an author's id in that form, a 65-character scoped flow
whose head now gives way to `Flow_`, ends of 1,600 words,
element ids of 62 to 64 characters with the `--if-absent` hint and a data
object, joins), a
design-iq splice, scoped flows with long and number-led end words and a
glued file with suffixed flows, also one they keep on `flowAToB`, in
`test/conventions-ids.test.ts`, the
issue's commands in `test/cli.test.ts`, doc pins in `test/batch.test.ts`
and `test/conventions-ids.test.ts`. Left for later: a stop word left at the end of a cut
(`Flow_Task_lieferung_versenden_und_Task_rechnung_eingegangen_und`: the
most words win), the engine's `BPMNShape_<id>` / `BPMNEdge_<id>` over 64
characters in a fresh drawing, the DI cap (both fixed in
`fix/di-ids-within-64-follow-renames`, see the section at the top; `MAX_DI`
stays 61), a data object whose `Object`
word a reference id of 63 or 64 characters cuts away again (it takes `_2`,
as 0.6 did just below its cap), a cut inside a word where two one-word ends
do not fit beside each other (one end loses its last letters,
`Flow_Task_lieferantenbestellungsuebersich_Task_zahlungseingaenge`), a
suffix glued to an end that ends in a digit (stemTo / scopedTo
`...Pdf10` + `2`, as in 0.6), bpmn-cli's own glued flows without a suffix,
which count against a numbered file's form without voting for it, scoped
flows 0.6 cut to an empty end word (`Flow_KotO_...To`), which no longer
match their form and can flip a 0.6 file's form (these two fixed since
2026-10-13, "A file's flow form stays put" at the top), an end whose leading
number fills a small room (`10202422024Rechnung` in 11 characters keeps no
letter), an element prefix of 52 to 55 characters that a suffix leaves a
body under 8 (the fallback to the bpmn-cli prefix counts no suffix:
`<prefix>_2024_100`, a body without a letter), a target that already ends
in a number before its number tail (`x_2_2`: its re-cut for `_2` gives the
base again, so `_2` is skipped), and a count before a dropped word kept at
the end of a target that has no separated suffix
(`...ToLieferantenbestellungen4` for `Lieferantenbestellungen 4 Augen ab`:
only a suffix's look is checked, not whether the number counts the next
word), and the fallback for a long head, which looks at the head's length
alone: a scope of 41 or more characters (a flow prefix of 46, an element
prefix of 56) gives `Flow_Pack_To_Reserve` (`activity_gh`) also where the
id with the file's head would fit within 64 (0.6:
`Flow_<scope>_PackToReserve`, 60 characters).

## The design profile removed (2026-10-13, `feat/35-remove-design-profile`, issue #35)

The decision on #30: bpmn-cli does not couple to design-iq, and design-iq's
own validator is the only place its rules live. design-iq's live host
already embeds the core with `profile: 'none'` and passes its own
`checkModel` through the validator hook (design-iq's ADR 0009,
Miragon/design-iq#244). A checkout of a content repository has its own check
(`npx @miragon/design-iq-validator --root .`, which the repository's
`CLAUDE.md` asks for after every model edit). The copy drifted: the rename
to `designiq.yml` turned it off without a message (#30), and the analysis
for #30 found about 15 edge differences to `checkModel`. This replaces the
issue's earlier plan, a project-validator mechanism in bpmn-cli with an
adapter shipped by design-iq: that would be new coupling for one consumer
that already has its own check.

- **Removed** (no replacement in bpmn-cli):
  - the rules: `src/platform/design.ts` (`designFindings`,
    `designValidator`, `undeclaredPrefixes`, `DESIGN_VALIDATOR`) and the
    `E_DESIGN_*` / `W_DESIGN_*` codes;
  - the profile and the repository lookup: `src/platform/repo.ts`
    (`resolveProfile`, `profileValidators`, `modelsFolderOf`,
    `PROFILE_CHOICES`, `CONTENT_CONFIG_FILE`, `ContentRepo`, `ProfileChoice`,
    `ProfileInfo`), `src/node/repo.ts` (`findContentRepo`,
    `contentModelIds`, `contentRepoOf`, `resolveFileProfile`,
    `ContentRepoOnDisk`) and the lookup in `src/node/files.ts`
    (`fileContext` only names the file the validators see);
  - the options: `--profile` on the mutating commands and on `validate` (now
    an unknown option: `E_USAGE`, exit 1, the hint any unknown option gets),
    and `profile` / `contentRepo` in `MutationOptions`, `CheckOptions`,
    `EditOptions`, `ValidateXmlOptions` and the file helpers;
  - the output: `profile` in the `validate` result (`ValidationReport`,
    `CheckResult`), `profiles` in `bpmn kinds --json` and `kinds --section
    profiles`;
  - the guide: the DESIGN-IQ section, the `design` topic, `PROFILE_DOCS`,
    the `--profile` common option and the catalogue entries. `E_VALIDATION`,
    `W_PREEXISTING_ERROR` and a line of the COMMANDS section (the result
    format of the mutating commands, `bpmn guide commands`) name "a host's
    validator"; a validator's `E_VALIDATION` hint no longer mentions
    `--profile none`. The fix of `W_PREEXISTING_ERROR` says that a host
    validator's error is listed by the host's own check or by `validateXml`
    with `validators`, and the COMMANDS line shows a finding as `[<name>]
    <code> <element>: <message>` (a host's codes are its own, not `E_...`);
  - the docs: `docs/design-iq.md` became `docs/validators.md` (the hook
    only, with a product-neutral example run against the sources), the
    verdict suite of `docs/testing.md` and the skill's line on content
    repositories are gone, and `docs/migrating.md` ("Changes from 0.6")
    lists every breaking change with what to do instead.
- **Stays**: the validator hook (`validators`, `NamedValidator`,
  `ValidatorFinding` with `ruleId` and `key`, the before and after runs,
  `W_PREEXISTING_ERROR`, `E_VALIDATOR_FAILED`, `covers`, `ctx.file`); sticky
  support (a `bpmiq:sticky` follows its node: file format compatibility, the
  namespace is frozen); decision links read and written in every spelling
  (`src/ops/decision.ts` unchanged, also the unprefixed `calledDecision=` for
  `platform: none`); the platform profiles (Camunda 7 / 8, `--platform`).
- **Instead**: in a design-iq content repository an agent runs
  `npx @miragon/design-iq-validator --root .` after its edits; a library
  host that wants a check inside the write passes its own validator through
  `validators`. The design-iq side (drop `profile: 'none'` with the bump) is
  Miragon/design-iq#248.
- **Tests**: `test/design-profile.test.ts` is deleted: its 36 rule cases and
  12 explicit cases only tested design-iq's rules or the repository lookup,
  and its opt-in suite compared the copy with design-iq's validator (48
  passing tests and 1 skipped suite fewer). The generic hook coverage runs
  through two host validators in `test/validators.test.ts` (15 -> 18
  cases): `gate()` reads the parsed document (unreachable and dead-end
  errors that cover the lint warnings, start-event errors counted one by
  one, a size warning with a `key` and no element), `shapes` reads the XML.
  Ported to them: a refused change and the same change without the
  validator, `--force`, a pre-existing error through a rename, one start
  event per process and a node with its flows in one transaction, findings
  counted one by one, warnings reported once (the `key` identity), the same
  bytes with and without a validator, the check of what would be written
  (`--no-layout`), `ruleId` findings, the check of `validate` (every
  finding, `covers`) and the validators seeing the file's own diagram. The
  CLI cases: "`--profile` is an unknown option like any other" (the same
  stderr as `--bogus none`), and a structural error through the CLI: `bpmn
  apply` refuses it with the error list under the message and in `--json`
  `error.errors` (exit 2, nothing written), and after `--force` (no `.bak`
  without `--backup`) `bpmn validate` reports it and exits 2. The deleted
  design-profile tests were the only CLI runs of these. `test/step2-integration.test.ts` and
  `test/isomorphic.test.ts` keep their case counts with host validators
  (`ctx.file` of `--out`, of `checkFile` and of the `file` option; `bpmn
  validate --json` equals `validateXml` and has no `profile`; no profile
  chunk loads, and the split bundle reports a host validator's error, its
  `W_PREEXISTING_ERROR` after an edit and the lint warning it covers like
  Node); `test/decision-link.test.ts` drops `profile: 'none'`.
  Deleted with the profile: the guide's DESIGN-IQ recipe case and the
  `--profile bogus` / `profile: 'strict'` cases.
- **Closed**: #30 (decided: no coupling) and PR #36 (the `designiq.yml`
  lookup fix, option a of #30), obsolete since the lookup is gone.
- **Release**: one minor release with a `BREAKING CHANGE` footer, no
  deprecation release (design-iq is the only known library host and does
  not use the profile; CLI scripts drop `--profile`).
- `npm run gate`: 1,888 tests (+246 opt-in), isomorphism check,
  layout regression 444 (budget 444), fuzz 12 x 15 0 errors (4 group
  warnings in one walk). The bundles shrink and the
  budgets go down with the code (`tools/iso/budget.json`, measured + about
  2 %): `applyToXml` only 642.6 / 204.0 -> 630.6 / 199.9 KB, budget 650 /
  206 -> 643 / 204; the whole entry 887.2 / 280.3 -> 865.8 / 273.2 KB,
  budget 899 / 284 -> 883 / 279 (the table in `docs/library.md` too). The
  Camunda 7 / 8 chunks do not change. Importing one guide export adds 116
  to 140 KB minified (35 to 43 KB gzip) to `applyToXml`; `docs/library.md`
  said 118 to 141, measured at #13 (on main it was 123 to 149).

Open after #35:

- Once the release is out: the design-iq PR for Miragon/design-iq#248 (the
  version bump, `profile: 'none'` dropped).

## Incremental layout of edits to hand-drawn models, stage B (2026-10-12, `feat/layout-room-making`, issue #18)

Option B of issue #18 on top of stage A: the crossing-aware row choice with
room-making (2) and the local repair after placement (3). Stage A had made a
batch place like single commands; what was left was the single-command base
rate: a new branch or boundary path crossed a bypass or loop-back line in
about one run in five (boundary path 23 %, new branch at a split 20 %, a
decision spliced into a branch 38 % on the private corpus). The user's
decisions hold: elements by id only, new ids speak, a hand-made drawing is
kept (no full redraw as a fix).

- **Row choice** (`diagram/place.ts` `rowCandidates`, `cheapest`,
  `chainCost`, `linesUnder`, `rowsAbove`, `topCandidates`):
  - the cost of a candidate row now counts the rest of the chain on that row
    (`chainCost`): the line the following new nodes take crosses an existing
    line (a crossing, 300) or an existing line runs through the room they
    take (`LINE_HIT`, 400: it would be routed around them, mostly with a
    crossing). A node without any successor yet keeps room for one event
    (`chainExtent`): the next command mostly ends the branch there, so a
    batch and the same ops sent one by one choose the same row;
  - the first row below is opened with the space tool not only when shapes
    take it, but also when it lies on a line or a line runs between the
    anchor and it: everything at or below the topmost thing in the way moves
    down, the horizontal segments of the lines running under the anchor
    (bypass and loop-back lines) and the shapes they dock on included
    (`linesUnder`; the space tool shifts interior waypoints, so the line
    stays orthogonal). An opened row costs 100 + 3 per moved shape (at most
    40) + 0.2 per px: less than one crossing (before: 150 + 10 per shape, so
    a crossing won over an opened row with 15 shapes below; the issue saw
    220 against a crossing of 300 in the fixture's log, and the crossing was
    not counted on the chain at all);
  - rows above the anchor are candidates too: for a new branch when the
    anchor has no branch above it, for the first node of a boundary path when
    the event sits on the bottom border with no other drawn path: the event
    moves to a free spot on the host's top border (`topSpot`, `seatOnTop`;
    its label is placed again at the end, `PlaceCtx.relabel`). A row above
    costs `TOP_ROW` (160) more, so a clean row below wins; when the first row
    above sticks out of the lane, pool or sub-process, room is made at the
    top of that frame first (like `place --side top`), costed like an opened
    row. Open question 2 decided: automatic placement tries the top border
    on its own;
  - the trial route of a candidate starts from the anchor where the room
    making puts it (`shiftedBox`), and from the top spot for a path above.
- **Local repair** (`diagram/incremental.ts repairCrossings`, step 10 of
  the contract): for every crossing between a connection drawn in this run
  and an existing one, at most 8 trials per write:
  - the new connection is routed again with the whole drawing in place (the
    hand drawing stays), else the existing one with the new shapes as
    obstacles;
  - a crossing left: the branch or exception path the new connection belongs
    to (`PlaceCtx.heads`, found back through the nodes placed in this run)
    starts at its next row candidate (`PlaceCtx.skip`): steps 6 to 9 run
    again from a checkpoint taken before step 6 (`checkpoint` / `restore`:
    plane membership, every shape's bounds and label, every connection's
    waypoints, label and ends, the placement state and the run's sets and
    notes), at most twice (`CHAIN_RETRIES`); skipped when the run created a
    plane or adopted an engine block. The DI the measurement created for the
    new elements is handed to the redrawn ones (`takeDi` / `giveDi`), so no
    element gets a second DI element;
  - a trial is kept only under the guard of `compact`: it adds no hard
    layout problem and lowers the score (the planes are written to the DI
    and measured after each trial). An existing connection kept rerouted is
    in `layout.rerouted` with a note (`Flow_X routed again: it crossed the
    new Flow_Y`), a chain placed again in a note (`Activity_X placed at
    another row: at the first one its path crossed a line`).
- **Associations broken during placement** are routed again at once, like
  sequence flows (`routeNow`; message flows still wait for the end): a batch
  saw a data association its placement broke in its old place and chose
  another row than single commands (one corpus run in each of two edits).
- **Audit #63 fixed** (`diagram/space.ts borderPad`, `fitInFrame`): a frame
  grows until a shape keeps 10 px from the frame's own boundary events on
  that border (half the event + 10 px), and the row choice estimates that
  growth: a new branch inside a transaction no longer lands on its cancel
  event. #13 (a splice into a loop-back flow) and #74 (a task placed left of
  its rejoin target) are the splice and prepend paths, not the row choice:
  unchanged.

Evidence (private corpora local, counts only):

- The issue's probe on the private corpus (267 files with a diagram, 3,362
  incremental runs; the stage A build measured again), runs adding a
  crossing, batch / single commands:

  | edit | runs | stage A | stage B |
  | --- | ---: | --- | --- |
  | decision after a task | 265 | 52 / 64 | 5 / 5 |
  | the same + reminder path | 265 | 60 / 75 | 12 / 12 |
  | decision into a branch of a split | 161 | 54 / 61 | 11 / 12 |
  | the same + reminder path | 161 | 47 / 60 | 12 / 13 |
  | "no" to the sibling branch's node | 161 | 37 / 39 | 30 / 32 |
  | timer path on a task | 265 | 44 / 61 | 3 / 6 |
  | `split` after a task (one op) | 265 | 53 | 5 |
  | new branch at a split (one batch) | 169 | 33 | 9 |
  | skip with a merge | 97 | 3 / 3 | 3 / 3 |

  The acceptance targets of the issue (single commands): boundary path 2.3 %
  (target <= 10 %, before 23 %), new branch at a split 5.3 % (<= 10 %, before
  19.5 %), decision spliced into a branch 7.5 % (<= 20 %, before 38 %). A
  batch adds crossings in no more runs than its single commands, for every
  edit. Backward flows unchanged (15 / 15, 0, 8, ...). Hard defects without
  a group: 0 of 3,362 runs. The repair kept a reroute in 49 runs and a chain
  at its next row in 38; a boundary path went above its host in 383 of about
  1,380 runs with one (stage A added a crossing there in 137 of them, another
  problem in 28, none in 218: there the rows below were mostly farther
  away or their chain ran through a line).
- Bench on the scenarios and the 60 Modeler models (stage A -> stage B):
  runs adding crossings E1 13 -> 9, E2 26 -> 11, E4 15 -> 2, E7 58 -> 39, E8
  30 -> 13, E9 31 -> 14 (all edits 205 -> 120); runs adding backward flows 9
  -> 10 (E7 6 -> 7: one Modeler model where E4's timer path went above its
  host and E6's rename then widened the host, which slides the event right of
  the path's end); the median share of existing shapes moved > 5 px of E1 /
  E2 / E4 unchanged (25 % / 0 % / 0 %), E8 / E9 61 % -> 63 % / 64 %; the
  tail grew (0.5.0 -> stage B): E2 mean 6.2 % -> 9.8 %, p90 23 % -> 39 %,
  max 61 % -> 100 %; E4 runs moving any shape 34 -> 44, p75 0 % -> 11 %
  (room made at the top of a pool moves its whole content down as one
  block: in one Modeler model all 23 shapes move 125 px, relative to each
  other none); mean harness delta of all edits 0.1 -> -0.8. No semantic failure, run adding a
  hard defect or global hard count more: `RESULT: no regression`. The soft
  budget is lowered to the new counts (E8 / E9 crossings 9 / 9 of 76, backward
  flows 1 / 1).
- The eval fixture: the four batches plus the timer reminder path score 0
  (stage A: 5, 0, 0, 5), batch and single commands give the same shapes for
  all eleven op sets of stage A; the reminder path goes above the approval on
  its own where below it crosses the "no" flow (`place --side bottom` takes
  it back).
- Write time: on two CLI-built models with 120 and 300 nodes (local, the
  audit's generator) a write of each probe edit takes 100 to 120 ms and 230
  to 330 ms before and after (these edits add no crossing there, so nothing
  is repaired; the machine was loaded by parallel runs, the differences are
  within its noise). On the corpus the 3,379 probe runs took 219 s before and
  226 s after (+3 %; median 40 -> 42 ms, max 485 -> 510 ms); a write that
  repairs (about 3 % of the runs) takes up to three times as long (10 -> 28 ms
  on a small model).
- Fuzz, 80 walks x 25 steps (incremental and auto, the default corpus and
  the 60 Modeler models): 0 errors, the same warnings as stage A.
- `npm run gate` (on the first stage A build, before the fixes below):
  1,912 tests (+247 opt-in), isomorphism check, layout regression 444
  (budget 444), fuzz 12 x 15 0 errors. The bundle budgets
  are raised for this code (`tools/iso/budget.json`, measured + about 2 %):
  `applyToXml` only 627.9 / 199.1 KB (stage A) -> 637.5 / 202.4 KB, budget
  630 / 201 -> 650 / 206; the whole entry 871.5 / 275.0 -> 881.6 / 278.5
  KB, budget 878 / 277 -> 899 / 284 (the README table is updated; it still
  showed the sizes before stage A).
  `test/layout-room-making.test.ts` (9 tests, 8 fail on stage A; synthetic
  fixtures in `test/fixtures/layout-room/`).

Open after stage B:

- "no" to the sibling branch's existing node still crosses in about one run
  in five (30 / 161): the crossing is the new flow into a drawn node, no row
  is chosen for it, and rerouting it rarely lowers the score.
- A boundary path goes above its host in about a quarter of the runs with
  one (when every row below crosses a line or lies far below): the drawing's
  convention changes there; `place --side bottom` takes one back.
- An opened row moves everything below the line in the pool's band (like the
  space tool); the penalty caps the moved shapes at 40, so a large pool moves
  for one crossing avoided.
- A host that grows to fit a new name slides its boundary events along the
  border; an exception path placed right above / below the event can then
  run backwards (bench E7, one run).
- Rerouting broken data associations during placement can add a crossing
  between two existing associations (seen on `artifacts__05-data-pool-lanes`);
  the repair looks at new-vs-existing crossings only.

### Stage B, fixes after the verification (2026-10-12)

The verification of stage B passed ten criteria, rated two partial and
failed one (the eval not re-run); it found one high, two medium and six low
findings. Stage B is rebased onto the fixed stage A (`4966084`). Each fix has
a test in `test/layout-room-making.test.ts` (the later blocks; synthetic
fixtures `rework-line-over-host`, `timer-on-subprocess`, `claims-two-lanes`,
`shared-reject-line` in `test/fixtures/layout-room/`) that fails on the
stage B build:

- **High: a path added to a boundary event on its host's top border tore
  the hand-drawn row.** The plugin's own recovery (`place --side top`, then
  `add ... --after <event>`) put the reminder below the host, and the room
  making took the event's bottom (inside the host's row) as its floor: the
  host row's flows and the events on them counted as lines under the
  anchor, so the start and end events dropped about 218 px while the tasks
  stayed (`place.ts placeAfter`). Now the floor is the host's bottom, and
  the path of an event on the top border runs above its host (its rows
  above are candidates, rows below cost `TOP_ROW` more). The eval model:
  nothing moves, score 0 -> 0 (before 0 -> 5 with a crossing, also on stage
  A); the verifier's 9-op batch (a second path connected later): 0 -> 0.
- **Medium: the top-border spot ignored lines.** A rework line 10 px above
  the host ran through the spot: the event sat on it, the line was routed
  again below the row and crossed another one (synthetic, 1 -> 6). `topSpot`
  now keeps clear of every line (but the event's own) and of connection
  labels; that model: 1 -> 0, the event stays below.
- **Medium: the repair traded a crossing with a new flow for one between
  two drawn lines** (2 of 3,379 corpus runs; the score fell, so the guard
  kept it). A trial now also may not add a crossing between two
  connections drawn before the write (counted together, so a chain drawn
  again may cross another pair of them, not more; hard problems still per
  problem). The corpus run: 12 -> 17 with one crossing of the new flow
  instead of 12 -> 11 with one between two drawn lines (stage A: 12 -> 4,
  where the opened row moved the merge and its lines for nothing: the
  "no" flow descends through the opened row).
- **Low: an event drawn by hand moved to the top border** when its path was
  added. Only an event the CLI placed moves now: placed in this write, or
  sitting where `placeBoundary` puts a new event (`boundarySpot`, the spot
  computation split out of it), so the same ops as single commands still
  take the top border.
- **Low: a rerouted line ran along a new end event's border** (no
  `through`, also on stage A). A line touching a node placed as the
  continuation of a chain (`PlaceCtx.continued`: on its anchor's row, no
  row choice) is routed again, at the end and right when a batch places
  the node (`incremental.ts grazes`). Not for every new node: a merge a
  single command splices first and a later `connect` moves would otherwise
  reroute a line in single commands that the batch never touches (the
  stage A parity test of the merge batch in a pool with lanes).
- **Low: the `routeNow` association change had no test** that fails without
  it: an annotation above the eval's row on "Notify requester"; the splice
  breaks the association, and the batch places the reminder path like
  single commands only when it is routed at once.
- **Low: writes that repair took longer on large models.** A reroute that
  still crosses the line it is tried for, or (an existing connection) newly
  crosses another drawn line, is not measured (each measurement writes and
  measures the whole drawing; debug line `still crossing, not measured`).
  The probe edits on the two 300-node models, single-threaded, one after
  another: stage A 30.4 s, stage B before 34.8 s (+14 %), now 32.5 s (+7 %);
  `splitBranch` 483 / 710 / 596 ms, `decisionBatch` 564 / 722 / 623 ms.
- **Low: the locality claim** ("E1 / E2 / E4 unchanged") held for the
  median only; the evidence above now gives the tail.
- **Low: `fitInFrame`'s JSDoc** stood above `borderPad`'s: moved.

Evidence on the fixed build: the issue's probe on the private corpus (3,403
records, 3,362 incremental runs): runs adding a crossing exactly as before
the fixes for every edit (boundary path 6 / 265 = 2.3 %, new branch at a
split 9 / 169 = 5.3 %, decision spliced into a branch 12 / 161 = 7.5 %); a
batch never adds a crossing in more runs than its single commands; hard
defects without a group 0; reroutes kept 49 -> 37 and chains placed again
38 -> 30 (the guard undoes the trades). `bench --compare` against stage A
and against 0.5.0: no regression, crossings per edit as before the fixes
(all edits 205 -> 120 against stage A, 302 -> 120 against 0.5.0), mean
harness delta -0.8 -> -0.7. The `edit-hand-drawn-model` eval, 2 runs per
arm on this build (`claude plugin eval plugins/bpmn-cli --case
edit-hand-drawn-model --runs 2`, $1.03): WITH 1.00 / 1.00 (every grader
passed, both drawings score 0 in `bpmn metrics`), WITHOUT 0.64 / 0.73 (mean
0.68, delta +0.32). No WITH run edited DI by hand: both built the change
with `bpmn apply` batches of `add` ops, read the rendered PNG and
validated. Both WITHOUT runs rewrote the file with a Python script,
`dc:Bounds` and waypoints included (`no-xml-in-shell`, `validated`,
`speaking-new-ids` failed). Bundle: whole entry 887.2 /
280.3 KB, `applyToXml` only 642.6 / 204.0 KB (budgets unchanged, 899 / 284
and 650 / 206). `npm run gate`: 1,933 tests (+247 opt-in), isomorphism
check, layout regression 444 (budget 444), fuzz 12 x 15 0 errors (4 group
warnings in one walk on one of the new fixtures, which the campaign's
seeded corpus now picks; the same campaign run against the stage B build
before the fixes and against stage A gives the same 4).

Open after the fixes, besides the list above:

- An opened row whose chain still crosses a line (a line descending from the
  anchor's row through it) moves the shapes below for nothing; its cost
  counts the crossing, so it wins only when every other row crosses too.
- With an annotation associated across the row (drawn above it, on a node
  below it), a few batches on the eval's model place a node differently from
  single commands: a synthetic sweep of 27 annotation spots x 5 op sets, 4
  of 135 on this build, 4 others on stage A.

## Incremental layout of edits to hand-drawn models, stage A (2026-10-12, `feat/layout-batch-parity`, issue #18)

Issue #18 measured that an agent's change to a hand-drawn model sent as one
`apply` batch came out far worse than the same ops sent as single commands
(on the plugin eval's model 0 -> 9..19 against 0 -> 0..3), that agents had no
command to put a boundary event on the top border, and that `E_NO_ROOM`
named no command that works. Stage A is the issue's recommended first PR:
batch parity (1), the boundary side control (4), `E_NO_ROOM` with a command
(5) and the bench edits (6). The user's decisions hold: elements by id only,
new ids speak, a hand-made drawing is kept (no full redraw as a fix).

- **A batch places like single commands** (`diagram/place.ts`,
  `diagram/incremental.ts`, `pipeline.ts`):
  - the new nodes are placed in op order (the ids the ops created, passed as
    `IncrementalOptions.created`; the model lists an inserted node next to
    its anchor, so a merge spliced after the approval used to be placed
    before it, on the main row);
  - `chainReaches` follows every successor through new nodes and
    `spliceTarget` continues the splice of a node placed before S in this
    run (`PlaceCtx.spliced`): a decision with a new "no" branch, or a
    `split`, inside the chain keeps the splice (before: the chain had to be
    straight, so the task went to a new branch row below);
  - exception paths (new nodes after a new boundary event) wait for the
    normal flow's new nodes, and boundary events for the normal flow too,
    whatever the op order;
  - while more nodes follow, the sequence flows of each placed node are
    routed right away, the flows the placement broke too, and the spacing is
    measured again (`routeNow`, through `PlaceCtx.afterNode`): the next
    placement sees them like the next single command would. At the end such
    a flow is routed again only when it broke since (`ctx.routedNow`), and
    an existing one counts as rerouted;
  - a branch row still keeps room for the chain of new nodes after it, now
    free of shapes only (labels and lines there are dealt with when the chain
    is placed): with labels and lines counted, a "no" label made the
    reminder path take another column than single commands; without the
    room at all, a branch's end event landed on a line (bench E2, a
    Modeler model with a group: 8 -> 49).
- **A connect into a merge that would enter it backwards** (open question 4,
  decided yes): a join drawn before the ops (a gateway with two or more
  incoming flows and one outgoing flow to S) that a new flow would enter
  backwards, from a node it does not lead back to (no loop return), is
  placed again right of its rightmost source, before S, like a splice
  (`incremental.ts pullJoins`, `PlaceCtx.joins`); its sources and S in its
  pool / sub-process, S right of the sources. The eval's merge as single
  commands: 0 -> 3 (backward flow) before, 0 -> 0 now, the same shapes as the
  batch.
- **`place <boundaryEventId> --side top|bottom`** (op key `side`;
  `diagram/ops.ts boundarySide`): the event moves to that border of its
  host (the spot nearest its column that no other boundary event and no
  docking connection takes; `E_NO_ROOM` when none is left), its exception
  path drawn on the old side (the nodes only it leads to, beyond that
  border) is mirrored about the host's centre row (above the interior of
  the host's lane, pool or sub-process the space tool first makes the room
  at the top of that frame), the others give way (`makeRoom`), its flows
  are routed again. On the 112 scenarios with a timer path on the median
  task, `--side top` succeeds on all (26 with a lane, pool or sub-process
  above that needed the room), adding no hard defect. Only the boundary event, no row
  or column (`E_USAGE` otherwise); `place` of a boundary event with a row /
  column is still `E_WRONG_KIND`, its hint names `--side`. Open question 3
  decided for `place --side` (the issue's first option).
- **`E_NO_ROOM` carries one command** (`diagram/ops.ts withRoomHint`,
  `roomCandidates`; `cli.ts withFile`): when `place` / `align` refuse, a dry
  run on the drawing as the op found it tries `space --after` the column
  reference by 1 to 3 columns (`before`: after the reference's drawn
  predecessors), `space --below` the row reference by 1 or 2 rows, and for a
  row request the space right of the shape left of the moved ones, each
  followed by the op; of those that let it succeed, the one with the
  fewest layout problems goes into `details.ops` (the batch op) and, when
  the op saw the file's own drawing, `details.command` (`bpmn space <file>
  --after Gateway_1hd8x2m --by 2col`, the CLI fills in the file, quoted
  when needed), and the hint says what it carries (see "fixes after the
  verification" below); without one the hint names the shapes to move
  first. Both refusals of the eval (`place Activity_ApprovePurchase
  Gateway_PurchaseApproved --row-of Gateway_1hd8x2m --after
  Gateway_1hd8x2m` on the drawings 0.5.0 left after the merge batch and the
  "no"-to-the-existing-node batch with the reminder path,
  `test/fixtures/layout-batch/`) succeed after the command (score 19 -> 7
  and 11 -> 5).
- **Bench E8 / E9** (`tools/bench/gen-edits.mjs`): E8 splices a decision
  into a branch of an existing split with a new "no" branch in one batch,
  E9 adds a non-interrupting timer reminder path on the new task; bpmn-cli
  arms only, not part of E7. Every record carries `soft.addedKinds`
  (crossings, backward flows; `lib/measure.mjs softDelta`), `bench
  --compare` shows the runs adding them per edit and fails when the runs of
  E8 / E9 on the scenarios exceed `tools/bench/soft-budget.json` (E8: 16
  crossings / 1 backward flow of 76 runs, E9: 17 / 1; on 0.5.0 58 / 60 each).
  Open question 5 decided: gated for E8 / E9, reported for the others.

Evidence (private corpora local, counts only):

- The eval fixture, score before -> after, batch / single commands:

  | edit | 0.5.0 | now |
  | --- | --- | --- |
  | decision + "no" to the existing node | 0 -> 11 / 0 -> 0 | 0 -> 0 / 0 -> 0 |
  | decision + new "no" branch | 0 -> 9 / 0 -> 0 | 0 -> 0 / 0 -> 0 |
  | `split` | 0 -> 9 / 0 -> 0 | 0 -> 0 / 0 -> 0 |
  | merge gateway | 0 -> 19 / 0 -> 3 | 0 -> 0 / 0 -> 0 |
  | each + the timer reminder path | 11, 9, 8, 19 / 5, 0, 0, 8 | 5, 0, 0, 5 / 5, 0, 0, 5 |

  Every batch gives the same shapes as its single commands (with the
  reminder path too) and adds no backward flow. The 5 left with the
  reminder path ("no" to the existing node, merge) is one crossing between
  the reminder path and the "no" flow, in the batch and in single commands
  alike; `place Event_ApprovalOverdue --side top` takes the path above the
  approval: score 0 for all four, batch and single commands.
- The issue's probe on the private corpus (267 files with a diagram, 3,362
  incremental runs), runs adding a crossing / a backward flow:

  | edit | runs | 0.5.0 batch | now batch | single commands |
  | --- | ---: | --- | --- | --- |
  | decision after a task | 265 | 70 / 33 | 52 / 15 | 64 / 15 |
  | the same + reminder path | 265 | 223 / 33 | 60 / 15 | 75 / 15 |
  | decision into a branch of a split | 161 | 116 / 129 | 54 / 0 | 61 / 0 |
  | the same + reminder path | 161 | 117 / 129 | 47 / 0 | 60 / 0 |
  | "no" to the sibling branch's node | 161 | 126 / 147 | 37 / 15 | 39 / 15 |
  | timer path on a task | 265 | 53 / 0 | 44 / 0 | 61 / 0 |
  | `split` after a task (one op) | 265 | 60 / 8 | 53 / 8 | |
  | new branch at a split | 169 | 35 / 0 | 33 / 0 | |
  | skip with a merge | 97 | 2 / 1 | 3 / 1 | 3 / 1 |

  A batch adds crossings in no more runs than the same ops as single
  commands, a branch splice in a batch adds no backward flow (before 129 of
  161). Single commands are unchanged except the merge (backward flows into
  a merge an earlier command spliced). Hard defects without a group: 0 of
  3,362 runs (every hard problem added involves a group, as before).
- Bench on the scenarios and the 60 Modeler models (0.5.0 -> now): E8 runs
  adding crossings 78 -> 30, backward flows 89 -> 1, mean harness delta 8.9 ->
  2.4; E9 80 -> 31, 89 -> 1, 10.2 -> 2.3; the median share of moved shapes of
  E8 / E9 0 % -> 61 % (the splice shifts the rest of the row, as single
  commands do; 0.5.0 put the new nodes on a new row below), of E1 / E2 / E4
  unchanged (25 % / 0 % / 0 %); E2 mean harness delta 1.6 -> 2.0 (one Modeler
  model, 8 -> 40: the new branch inside a group frame, group overlaps only),
  E7 -1.1 -> -0.9. No semantic failure, run adding a hard defect or global
  hard count more; `RESULT: no regression`. The one E8 / E9 backward flow
  (a scenario with lanes) comes from single commands too.
- `npm run gate`: 1,900 tests (+247 opt-in), isomorphism check, layout
  regression 444 (budget 444), fuzz 12 x 15 0 errors (the one hard-overlap
  warning of `gallery__04-subprocess` is the same on 0.5.0).

Open after stage A:

- Steps 2 and 3 of the issue (stage B): a crossing-aware row choice that
  opens a row below the anchor and tries the host's top border for a
  boundary path on its own (open question 2: today only on request,
  `--side`), and a local repair pass. The single-command base rate stays (a
  new branch or boundary path crosses a bypass or loop-back flow in about
  one run in five); the fixture's two reminder-path batches keep their
  crossing until then (stage B: 0).
- The `edit-hand-drawn-model` eval was not re-run (2 runs per arm); the
  skill now says that one batch places like single commands and names
  `place --side top` for a crossing reminder path.
- A merge pulled right moves what lies right of its new column (the space
  tool, like a splice); a merge whose successor lies left of its sources is
  not pulled.

### Stage A, fixes after the verification (2026-10-12)

The verification of stage A passed six criteria and rated four partial.
Each finding below has a test in `test/layout-batch-parity.test.ts` (last
block) that fails on the stage A build:

- **Splices into two branches of one gateway in one batch** (a task into
  "yes" and a merge into "no", two tasks, the eval's merge batch in a pool
  with lanes: 18 against 5 as single commands, before 8 on 0.5.0). The
  first node's anchor counted as a branching node only when another branch
  was drawn; in a batch that branch leads to a node a later op spliced, not
  yet placed, so the node went to the anchor's row (in another lane: a new
  row of its lane). Now a branch drawn before the ops counts too
  (`place.ts placeAfter`). And a merge placed in this run that a later
  node's flow would enter backwards is placed again right of its
  predecessors (`place.ts pullPlacedJoins`, the batch form of `pullJoins`):
  the merge batch with the merge added first gives the shapes of single
  commands as well. On the eval model and the pool with lanes, all five
  variants: same shapes and score as single commands, no backward flow.
- **`place --side` back to the bottom in a pool with lanes** refused with
  `E_LEAVES_CONTAINER` whose hint named the shape's own lane as the lane it
  would land in (`lanes__complaint-t1`, `-t2`, `subproc__s15`): the way
  back took a node of another lane above the host as part of the exception
  path. The path is now the nodes in the host's own lane / pool /
  sub-process (`ops.ts exceptionPath`); below a lane with a lane underneath
  the lane grows at its bottom first (like the top); the hint of a shape
  that would land below its lane in no lane says so. A third boundary event
  drawn over a corner (`artifacts__10-three-boundaries`) found no spot on
  the way back: a spot reaching over a corner of the border is the fallback
  (its centre on the border's line). The verifier's runs, there and back:
  of the 146 existing boundary events of the scenarios and the Modeler
  models refusals 4 -> 0 and runs adding a hard problem 1 -> 0; of the 56
  new boundary paths on a sub-process refusals 4 -> 0 (a crowded border
  now takes a corner spot; the move is on request, its quality line says
  what it costs).
- **`place --side` and an annotation on a flow** (`artifacts__16`): the move
  rerouted a loop flow, and the association to it ran straight through two
  shapes (hard `through`). An association docked on a flow now ends at the
  nearest point of the flow a straight line reaches without cutting a
  shape, else it is routed around the shapes to the middle of the flow's
  nearest segment (`reroute.ts flowDock`); it is rerouted when its end left
  the flow, after the flows (`routeRank`). That run: 37 -> 0 instead of
  37 -> 26 with two `through`.
- **`E_NO_ROOM`** took the first space-tool run that fits (`1col`; the
  eval's two refusals score 8 and 7 after it, `2col` 7 and 5): now the run
  with the fewest layout problems (`2col` for both). After other ops of a
  batch the command for the file was checked on another drawing and could
  name ids only the refused batch has (`--after Activity_NewGate`): now
  `details.command` only when the refused op saw the file's own drawing
  (`runFormatOps(..., asFile)`, the first op of a batch of format ops only),
  else the hint names only the batch op to put before the place op.

Not changed: the timer reminder path of the fixture's "no to the existing
node" and merge batches still crosses the "no" flow, in the batch and in
single commands alike (score 5); `--side top` takes it above (score 0), and
stage B (`feat/layout-room-making`) tries the host's top border on its own
(both 0). The bench's one Modeler model whose E2 branch lands inside a group
frame (harness 8 -> 40, group overlaps only) is unchanged.

Evidence: the issue's probe on the private corpus gives the same records
as stage A (3,403); the verifier's adversarial runs (657, scenarios and
Modeler models, batch / single, `--side` there and back) add no hard
problem; `bench --compare` against 0.5.0: no regression (E8 / E9 crossings
78 -> 30 / 80 -> 31, backward flows 89 -> 1 each, harness 8.9 -> 2.3 / 10.2
-> 2.3; E1 / E2 / E4 moved share unchanged); 311 batches twice in two
processes give the same bytes. `npm run gate`: 1,909 tests (+247 opt-in),
layout regression 444 (budget 444), fuzz 12 x 15 0 errors (the same hard-
overlap warning of `gallery__04-subprocess` as 0.5.0). The
`applyToXml`-only bundle grew by this code from 627.9 to 631.4 KB minified:
its budget is 635 KB now (`tools/iso/budget.json`; gzip 200.2 of 201 KB).

## `bpmn render`, fixes after the verification (2026-10-11, `feat/render`, issue #12)

The verification of stages 1 to 3 (a fresh clone, every acceptance
criterion, hostile inputs, a side-by-side review against `tools/render.sh`)
passed eight criteria and found one high, three medium and five low
findings. All are fixed, each with a test that fails before
(`test/render-fixes.test.ts`, 11 tests); two existing tests changed with the
behaviour (the gallery's empty collapsed sub-process plane is now
`E_NO_MATCH` for `--scope`; the label test names the lines of the two-pass
rule). Where the issue left a question open, the decision taken is named.

- **`--tiles` is bounded (high).** A drawing spanning 1e9 px aborted the
  process with a V8 out-of-memory error (exit 134): the tile grid had no
  cap. Now coordinates beyond ±1,000,000 px never reach it (broken geometry,
  below), each axis is cut only over the stretches that hold something
  (gaps of half a tile and more are skipped), and the cutting stops as soon
  as either axis needs more than `MAX_TILES` (40) pieces. Decision for "too
  many tiles": the drawing is written as one image with a note
  (`--tiles: the drawing needs more than 40 tiles ...`, and the labels note
  names `--around`, `--path`, `--scope`), not an error, so `--tiles` never
  fails where the plain render works. 400 shapes spread over ±1,000,000 px
  at `--max-size 50 --scale 10` finish well under a second.
- **No blank tiles (medium).** A tile is kept only when it holds a shape, a
  label (a flow's, a message's, a pool's or lane's name where it is drawn)
  or a numbered problem; a connection passing through no longer keeps one
  (the old test was the connection's bounding box). A start event and a
  task 50,000 px apart with one flow: 676 tiles (625 blank, ~3.2 M image
  tokens, 27 s) before, 2 tiles now (3 when the flow has a label), and a
  note says empty parts are left out. Bands are numbered among the tiles
  kept, so the note counts them (`3 tiles (2500 bands)` was the highest band
  number).
- **Broken geometry (medium).** A shape or connection with a coordinate
  that is not a number or lies beyond ±1,000,000 px, or with a negative
  size, is not drawn, nor are such label bounds; notes name them with the
  repair (`bpmn layout <file>` draws them again; a label:
  `bpmn label <file> <id> --side below`). A NaN waypoint gave
  `width="NaN"` and a blank PNG with exit 0; now the start event and the
  task are drawn and the flow is named. A plane on which nothing can be
  drawn is `E_RENDER`. Non-finite shape bounds stay "no shape" as before
  (`plane.ts`). Decision for the limit: 1,000,000 px (500 screens of 2000
  px); none of the 155 repository and 394 corpus files comes near it (no
  such note on any of them). Every hostile file of the verification (34,
  plus the two sparse 50,000 px files) renders with `--tiles --problems`,
  exit 0.
- **External labels like bpmn-js 18 (medium).** bpmn-js lays an external
  label out at max(90, the DI label width) in 11 px, then renders it in a
  box as wide as the widest line of that (rounded up), which can break it
  once more; the renderer did one pass at 90 px. It now does both. The
  verification's reference renders now match: gallery
  `Event_CompensationEnd` and lanes__complaint-t1 `Gateway_Kulanz` on one line,
  artifacts__09 `Event_Rollback` as `Roll` / `back` / `bookings`,
  controlflow__s19 `Gateway_Long` / `Flow_3` / `Flow_6` with 7 / 5 / 6
  lines. Lines that differ from before: 16 of 1,313 external labels in 8
  of the 155 repository files, 332 of 3,769 in 141 of the 394 corpus
  files. **Metrics unchanged**, by decision: `metrics.ts` does not use
  `text.ts`; `labelClash` judges a label by its DI label bounds and a coarse
  text estimate of its own (`glyph`: 6 px a character, at most 90 px wide,
  14 px a line), which neither the old nor the new renderer rule enters, and
  `text.ts` otherwise serves the incremental engine's activity sizing
  (embedded labels, which bpmn-js lays out once). The regression budget
  stays 444 of 444. Bringing `glyph` to the renderer's rule would change
  `labelClash` counts and needs its own regression measurement: a possible
  follow-up.
- **Message flows show their message (low).** With a `messageRef`: the 21 x
  14 envelope halfway along the flow, outlined (`messageVisibleKind`
  defaults to "initiating" in the DI schema), filled for "non_initiating",
  and the message's name in 12 px wrapped at 150 px. A probe of bpmn-js
  18.31 in Chrome showed where it puts the name on import: its left edge at
  the middle, its top 10 px below (it measures the envelope and the text as
  0 x 0 then; only a redraw after an edit centres the name below the
  envelope). The renderer draws the import placement, which is what a viewer
  or modeler shows when it opens the file and what `tools/render.sh` shows.
  8 of 155 repository and 6 of 394 corpus files have such flows.
- **`render -o x.jpg` (low)** is `E_USAGE` (a name not ending in `.png` /
  `.svg`), unless `--format` says what to write, like `--render`.
- **A file without a diagram (low).** Decision: `--problems` lists what
  `bpmn metrics` reports for the file, consistent with "every metrics
  problem, in metrics order": `test/fixtures/views/claims.bpmn` lists its 37
  `missing` problems (none in the image) instead of 9 problems of the
  in-memory drawing, and a note says the problems are the file's. The
  in-memory drawing's problems are not the file's to fix; after `bpmn layout
  <file>` saves a drawing, `--problems` lists that drawing's.
- **`--scope` on an empty plane (low)** is `E_NO_MATCH` like the other
  empty crops; a `--scope` that is a plane (a collapsed sub-process, a
  process without a pool) now names that plane's flow nodes in `crop: ...:
  N nodes` (it said 0 nodes).
- **Notes (low).** A scale in a note and in the `wrote` line is rounded
  down to two decimals (`scaleText`): 0.7458 reads `0.74 ... (below 0.75)`,
  not `0.75 ... (below 0.75)`; the band count, see above.
- **The stage-3 eval** stays as run; `plugins/bpmn-cli/evals/README.md`
  now states its limitation: `tidy-after-edit` cannot separate the skill's
  look step from the CLI's own guide (the baseline has the same `bpmn` and
  `guide --short` names `render`).

| | before | after |
| --- | --- | --- |
| repository, 155 files, `--tiles --problems` at 2000 px | 4 files tiled, at most 2 tiles | the same; 0 errors |
| private corpus, 394 files (counts only) | 22 files tiled, at most 3 tiles | the same; 0 errors |
| core bundle, entry plus shared chunk | 985.7 KB minified, 305.8 KB gzip | 992.0 KB (+6.3), 307.9 KB gzip; since before stage 1 945.9 -> 992.0 KB (+46.1 KB of the issue's 50); the `applyToXml`-only bundle unchanged |
| gate | 1854 tests | 1865 tests (+247 opt-in), iso check, budget 444 of 444, fuzz 0 errors |

## `bpmn render`, stage 3 (2026-10-11, `feat/render`, issue #12)

Adoption in the Claude Code plugin; no change to the CLI or the library.
Lead decisions that apply: the skill passes an explicit `-o` into a
`.bpmn-render/` folder of the working directory (scratch, may be deleted
or ignored; the CLI's own default, the temp directory, lies outside the
working directory, where Claude Code may ask before a Read).

- **The look step** (`plugins/bpmn-cli/skills/bpmn/SKILL.md`, core loop
  step 4 of 6): after a change that drew something, `bpmn render <file>
  --problems -o .bpmn-render/<name>.png` or `--render .bpmn-render/<name>.png`
  on the change, Read the PNG, fix the numbered problems by their ids with
  the format commands, render again at most twice, `--around` / `--path` on a
  large model. The description says "render" too (for "show me the diagram").
  `reference/formatting.md` has a new section 2 "Look at it": the crops,
  `--highlight`, the `wrote` line and the token budget, `--max-size`, the
  0.75 note and `--tiles`, `--problems`, planes, `--render`; its batch
  example renders. `.bpmn-render/` is in this repository's `.gitignore`.
- **Size**: `claude --plugin-dir plugins/bpmn-cli plugin details bpmn-cli`
  before / after: always-on ~482 / ~484 tokens, on invoke ~6k / ~6.4k
  (SKILL.md 16,080 -> 16,966 bytes). `claude plugin validate --strict`
  passes for the plugin and the marketplace.
- **Tests** (`test/plugin.test.ts`, 4 new, each fails before; the gate
  passes with 1854 tests): the render block of
  SKILL.md runs on the recipes' model and writes a real PNG of the size the
  `wrote` line names, within 2000 px, into `.bpmn-render/`; every `bpmn
  render` and `--render` the skill shows writes into `.bpmn-render/`; the
  formatting examples (with their renders) run as before. The test's
  esbuild bundle of the CLI now sits at `<tmp>/pkg/cli/cli.mjs` with links
  `<tmp>/assets` and `<tmp>/node_modules`, so it finds the font
  (`../../assets` from the bundle) and `@resvg/resvg-wasm`.
- **Eval case `tidy-after-edit`** (`plugins/bpmn-cli/evals/`): a
  hand-drawn invoice approval (synthetic, speaking ids) whose gateway label
  sits on "Approve invoice" and whose rejection branch crosses the reminder
  path of a timer (`bpmn metrics`: `labelClash`, `crossings`); the user asks
  for an email step "Inform requester" in the rejection branch and to clean
  up the drawing, keeping the main line. Graders: the new task between the
  right two nodes; the label clear and no crossing (DI conditions, since
  graders cannot run commands; `test/plugin.test.ts` asserts that they
  agree with `bpmn metrics --json` on the fixture, the CLI solution and
  seven other states: only the edit, only one of the two fixes, the label
  below / left / right, the solution followed by `compact`); the main line
  in place; 12 nodes, 10 flows; validated; no hand-written XML;
  `render-read` (a Read of a `.png`) and `skill-used` as with-only
  indicators.

The eval, run once (`claude plugin eval plugins/bpmn-cli --case
tidy-after-edit --runs 2 --scaffold --allow-tools Bash Write Edit`, the
CLI of this branch on `PATH` from a copy in the user cache directory as
`evals/README.md` describes; 111 s, $1.41 in all):

| | with the plugin | without (baseline) |
| --- | --- | --- |
| score as run (2 runs) | 0.95 (1.0, 0.9) | 0.95 (1.0, 0.9) |
| score with the corrected `no-crossing` grader | 1.0 (1.0, 1.0) | 0.95 (1.0, 0.9) |
| failed graders | `no-crossing` once: a false negative, see below | `no-xml-in-shell` once (`sed -n '/<bpmn:process/,...'` to diff the process before / after) |
| layout problems left (`bpmn metrics --json` on each kept workspace) | 0, 0 | 0, 0 |
| look step: renders read | 2 / 2 runs (2 and 6 PNG reads, about 440-530 image tokens each) | 2 / 2 runs (2 reads each) |
| turns, cost, time per run | 15 / 21, $0.32 / $0.45, 39 / 63 s | 11 / 13, $0.31 / $0.33, 48 / 49 s |

- All four runs ended with the same drawing idea, made with the CLI: the
  task with `bpmn add`, the rejection branch in a row below the reminder
  path (`place`, three of them then `compact`), the gateway label above the
  gateway. One run with the plugin iterated with dry runs and six renders.
  The baseline found `bpmn` on `PATH` (`which bpmn`), read `bpmn guide
  --short`, which names `bpmn render` since stage 2, and rendered to
  `$TMPDIR` and read the PNGs too. So this case measures the CLI's look
  affordance in both arms; it cannot separate the skill's look step from
  the CLI's own guide.
- The first `no-crossing` grader wanted the rejection branch at y >= 420
  once the reminder task had moved up to 241-340; one run left them at 300
  and 400 (metrics: no crossing). The grader now takes the reminder's row
  in steps of 100 px (rows at least 100 px apart, as the CLI draws them),
  and the agreement test has the solution plus `compact` as a variant;
  applied to the four kept results it passes all four. Not re-run (one
  eval run per stage).
- One run with the plugin prefixed its first render with `mkdir -p
  .bpmn-render;`, which the render does itself and which is not
  pre-approved (a user would be asked); the look step now says the
  directory is created. Both runs with the plugin also chained `bpmn`
  commands with `;` against the skill's "one command per line" rule.

## `bpmn render`, stage 2 (2026-10-11, `feat/render`, issue #12)

The agent features of the issue's phased plan, on top of stage 1 (below).
Lead decisions that apply: highlights are a halo; collapsed sub-process
planes stay separate images (`--plane`); elements are named by id only.

- **Crops** (`src/diagram/render.ts`, `RenderOptions` `around` / `path` /
  `scope` / `ids`; one per call, two are `E_USAGE`): `--around <id>
  [--depth n] [--inner]` draws exactly the nodes of `show --around`
  (`aroundView` itself, not a copy), `--path <from> <to> [--via ...]` the
  nodes and flows of `pathOf` (the format selector), `--scope <id>` a pool,
  lane or expanded sub-process and every shape whose centre lies inside it
  (a collapsed sub-process: its plane; a process: its pool, else its plane;
  anything else `E_WRONG_KIND`), ids exactly these. A crop draws the
  connections between its elements in full, for around / path also the data
  and annotations attached to them; a connection to an element it leaves
  out is drawn faded in full with its label (`data-faded`; the view fits
  only its first 40 px), because a 40 px stub hid crossings and label
  clashes the badges pointed at; pools, lanes, groups and the expanded
  sub-processes around drawn shapes are context (`data-context`), clipped.
  Without `--plane` the plane of the crop's first element is drawn; crop
  elements on other planes are named in a note; nothing drawn is
  `E_NO_MATCH`. `nodes` lists the crop's flow nodes drawn.
- **Halos** (`highlight`): a list (orange; unknown ids `E_NOT_FOUND`, ids
  outside the image named in a note) or `{ created, changed, moved }`
  (green, orange, a lighter blue; created wins over changed over moved; a
  pool / lane / expanded sub-process that only moved or grew gets none:
  after an incremental insert every lane "moved" and the image was all
  blue). Drawn under the element; labels get a tint.
- **Numbered problems** (`problems: true` or a list): `locateProblems(defs,
  problems)` in `src/diagram/metrics.ts` adds `at: { plane, x, y }` per
  problem from its kind, ids and detail with the checks' own tests (the
  crossing point, the overlap's centre, the middle of the segment inside the
  shape, the shared run, the node outside its lane, the first waypoint
  outside the frame, ...). It is a separate pass on purpose: a first version
  computed locations inside `layoutProblems` (opt-in thunks) and grew the
  `applyToXml`-only bundle by 2.5 KB, because every mutation runs the
  metrics; now that bundle is byte-identical and `metrics` / mutation
  results carry no coordinates. The render lists every metrics problem in
  metrics order with the same ids (with a crop: those naming an element it
  draws; a given list: exactly those, numbered in its order), each as a red
  badge (constant 18 px) on its location when that is on the plane and in
  the image, moved aside within the problem's bounding box when it would
  cover an earlier badge; the rest is listed `(not in the image)`.
- **Tiles** (`tiles`): when the image would draw labels below 0.75, it is
  cut into tiles at `scale` (default 1) within `--max-size`: between the
  plane's columns (`planeColumns` in `src/diagram/view.ts`, the c<n> of
  `show --layout`), in the middle of the gaps, as even as the gaps allow,
  and into bands between rows of shapes when too tall; empty tiles are left
  out; a readable image stays one (a note). `tiles` / PNG `images` carry
  `columns` and `band`; a badge is in one tile (`tile`).
- **`focus`** (what `--render` uses): the plane of the first focus element;
  when the whole plane would be unreadable, the region around the focus
  elements and their neighbours (plus 40 px), with a note.
- **The command**: `bpmn render <file> [ids...] --around / --depth /
  --inner / --path / --via / --scope / --highlight <id,...> (repeatable) /
  --problems / --tiles`; extra result lines `crop: around X (depth 2): 7
  nodes`, `halos: ...`, `problems (numbered in the image):` with
  `<n> <kind> [<ids>] <detail>`, one `wrote` line per tile (`tile 2/3
  c9-c17`, files `<name>-1.png`, ...) and the total; `--tiles` with `-o -`,
  `--depth` / `--inner` without `--around`, `--via` without `--path` and a
  `--path` without exactly two ids are `E_USAGE`. JSON adds `problems`,
  `nodes`, `images`.
- **`--render <file.png|.svg>` on every mutating command**
  (`withMutationOptions`; validated before anything runs): after the write
  (also with `--dry-run`) the result is drawn with `changeHighlight(report)`
  (created, changed incl. colours, moved: placed / moved / rerouted /
  reshaped / labels), the problems the change added (`layout.metrics.added`,
  matched to their locations by `problemKey`) and `focus` on the touched
  elements. Text: a `render:` block after the report; JSON: `render`. A
  failed render (`E_RENDER`, `E_IO`) is reported in that block and the
  command still exits 0: the change stands.
- **Fuzz**: the walk renders every written step (`tools/fuzz/lib/walk.mjs`,
  `loadRender` in `setup.mjs`: `renderPng(xml, { problems: true, tiles: true
  })`); a throw, an image over 2000 px or another number of problems than the
  metrics (import warnings aside) is a `render` error; `--no-render` skips
  it; `minimize.mjs` replays with the render oracle and its `run.sh` ends
  with the render command. The gate's campaign renders.
- **Docs**: README (`render` section, synopsis, common options, library
  API, sizes, changes), the guide (section LOOKING AT THE DRAWING, topic
  `render`, a line in `guide --short`, the command entry, `--render` in
  the common options), `E_NO_MATCH` / `E_WRONG_KIND` in the catalogue,
  docs/testing.md.
- **Tests** (`test/render-agent.test.ts`, 21 tests, about 5 s, each fails
  before): locations inside the elements' box for every problem of every
  scenario and fixture (`layoutProblems` unchanged), `--problems` in metrics
  order with every badge inside its elements, `--around` against
  `aroundView` for every 4th node of every scenario and the median of all
  1,880 depth-2 crops, `--path` / `--scope` / ids, planes and notes, the
  errors, halos and `changeHighlight`, tiles (every column in exactly one
  tile, bands, PNG per tile), focus, the command flags and file names,
  `--render` (text, JSON, the region of a large drawing, a failed render),
  the fuzz oracle. New synthetic fixture `test/fixtures/render/long.bpmn`
  (28 nodes in a row, 3,940 px wide; built with the CLI).

Measured on this build:

| | |
| --- | --- |
| core bundle, whole entry | 966.4 -> 985.7 KB minified (+19.3 KB: renderer +11.9, `locateProblems` +3.5, guide text +4.0, `planeColumns` +0.3); since before stage 1 945.9 -> 985.7 KB (+39.8 KB of the issue's 50); gzip 298.9 -> 305.8 KB |
| core bundle, `applyToXml` only | 768,734 bytes, byte-identical to stage 1 |
| time | `bpmn render agent__o2c --problems` 0.20 s wall (an `--around` crop the same); `add ... --render x.png` 0.28 s, without 0.12 s |
| `tools/scenarios` | `--around` depth 2 for each of the 1,880 drawn flow nodes: median 368 image tokens (acceptance: at most 1,000), p90 1,518, max 3,515; every problem located inside its elements' box; the listed problems equal `metrics` for every file |
| `test/fixtures/render/long.bpmn` | whole at 2000 px: scale 0.51 (unreadable); `--tiles`: 2 tiles c0-c12 / c13-c25, 1,413 image tokens in all |
| private corpus (394 files, counts only) | 1,116 problems, 1,111 located (the 5 `missing` have no place), 0 outside their elements' box, 1,099 badges on the first plane; 5,698 `--around` depth-2 crops, 0 errors, median 257 image tokens (p90 1,069, max 3,622; 652 over 1,000); the 22 files below the 0.75 label scale all tile into 2-3 tiles (median 2), each at most 1,743 px, 3,593 image tokens per file median (max 5,997) |

Still open after stage 2 (and the issue's acceptance list): the plugin
skill's look step with `test/plugin.test.ts` running its example and the
eval case (both done in stage 3, above), and the reviewer's 20-scenario
side-by-side with `tools/render.sh`.

## `bpmn render`, stage 1 (2026-10-11, `feat/render`, issue #12)

The agent can look at the diagram now. Stage 1 of the issue's phased plan:
the renderer, the command, the budget and the PNG rasteriser. Decisions of
the lead on the issue's open questions: `@resvg/resvg-wasm` is a regular
dependency loaded lazily in the node layer, with the Arimo Latin TTF
(OFL-1.1) and its licence in the package; without `-o` the image goes to
`<tmpdir>/bpmn-cli/<name>.png`; `--max-size` defaults to 2000 px;
collapsed sub-process planes are listed, `--plane <id>` draws one;
highlights (stage 2) as a halo; design-iq is out of scope.

- **The renderer** (`src/diagram/render.ts`, core, browser-safe):
  `renderSvg(xml, { plane, scale, maxSize })` draws one diagram plane from
  its DI, close to bpmn-js: every element kind of the issue's acceptance
  list (event triggers with interrupting / non-interrupting styles,
  gateway markers, task types, loop / multi-instance / compensation /
  ad-hoc markers, expanded / collapsed / event sub-processes,
  transactions, call activities, pools (black box, vertical) and lanes with
  their names, data objects / stores / inputs / outputs, annotations and
  associations, groups, message flows, default / conditional markers,
  `bioc:` / `color:` colours; colour values are checked before they go into
  the SVG). The glyphs are our own, drawn from the notation (no bpmn-js
  code or PathMap). External labels follow bpmn-js exactly: centred on the
  DI label bounds, top at their y, 90 px wrap in 11 px Arial with the line
  breaking of `src/diagram/text.ts` (which now returns the lines:
  `wrapLines`; `innerLines` counts them), 13.2 px lines; without bounds
  below the shape or 15 px above the middle of a flow's middle segment.
  Arrow heads are paths, not SVG markers, and everything outside the view is
  culled (a marker-carrying path outside the view made resvg trap in the
  issue's prototype). A file without any diagram is laid out in memory (a
  note says so); elements of the plane without a shape are named in a note;
  the other planes are listed; the long edge is capped at `maxSize`, and a
  scale below `MIN_LABEL_SCALE` (0.75) adds the note naming `--around`,
  `--path` and `--tiles` (stage 2 adds them).
- **PNG** (`src/node/render.ts`, `@miragon/bpmn-cli/node`):
  `renderPng(xml, opts)` -> `{ images: [{ png, width, height, tokens }],
  scale, plane, planes, notes }` (the issue's API shape; one image until
  `--tiles`). resvg-wasm 2.6.2 is imported on the first call, the wasm read
  from its package, the font from `assets/fonts` (no system font: the
  image is the same everywhere). Every rasteriser failure, including a wasm
  trap, is `E_RENDER` (exit 4) and the next render still works.
- **The command**: `bpmn render <file> [-o <path|->] [--format png|svg]
  [--plane <id>] [--max-size <px>] [--scale <n>] [--json]`; the result line
  `wrote <path>  WxH px  ~N image tokens  scale S  plane <id>`, the other
  planes and the notes; `-o -` writes the image to stdout (a PNG only when
  stdout is no terminal) and the report to stderr.
- **Tests** (`test/render.test.ts`, each fails before): every file of
  `tools/scenarios` and `test/fixtures` (and each other plane) renders to SVG
  and PNG within 2000 px with the same bytes twice (4.5 s for 153 files in
  one worker); text pixels with the bundled font only; `E_RENDER` for a
  488-byte SVG that makes resvg trap and for malformed SVG; the bpmn-js label
  positions; colours and unsafe colour values; planes and notes; the budget
  note; the in-memory layout; the renderer absent from an
  `applyToXml`-only bundle; the command. `test/isomorphic.test.ts` compares
  `renderSvg` in the browser bundle with Node; `tools/iso/check.mjs`'s
  strict consumer uses `renderSvg` and `renderPng`. The synthetic
  `test/fixtures/render/gallery.bpmn` has every element kind (for the
  reviewer's side-by-side with `tools/render.sh`).

Measured on this build:

| | |
| --- | --- |
| core bundle, whole entry | 945.9 -> 966.4 KB minified (+20.4 KB: the renderer 18.9 KB, the guide text for `render` 1.5 KB), 291.7 -> 298.9 KB gzip (+7.2 KB) |
| core bundle, `applyToXml` only | 768,736 -> 768,734 bytes minified (the `text.ts` change is 2 bytes smaller), gzip 238,454 -> 238,443 |
| install | +2.53 MB (`@resvg/resvg-wasm`: 2.48 MB wasm), +27 KB font, licence and note in `assets/fonts`; no install scripts |
| time | `bpmn render` of `agent__o2c` 0.27 s wall (CLI start, parse, SVG, wasm load, PNG); in-process 3 ms SVG + 16 ms PNG per scenario on average |
| `tools/scenarios` (115 files) | all render; image tokens at the default 2000 px p50 820 / p90 2,291 / max 4,115; natural long edge p50 1,269 / p90 2,157 / max 2,852 px, 23 over 2000; 3 below the 0.75 label scale; 8 files with 10 other planes, all render; 2 without a diagram (laid out in memory) |
| private corpus (396 files, counts only) | 394 render (2 files of the manifest are missing on disk), 0 errors; tokens p50 634 / p90 1,896 / max 4,801; natural long edge over 2000 px: 66, below the 0.75 label scale: 22; 22 files with 30 other planes, all render; 24 without a diagram, 2 with elements without a shape |

Stage 2 (above) added crops, halos, numbered problems, tiles, `--render` and
the fuzz step's rendering; stage 3 is open.

## Profile rules on demand (2026-10-11, `feat/lazy-profiles`, issue #13)

Between 0.3.0 and 0.4.0 the browser bundle grew by about a third, and every
host loaded both rule sets for every document. Option (a) of issue #13 is
implemented: the Camunda 7 and Camunda 8 rules load the first time a
document of that platform is validated. Decisions taken for the issue's
open questions: (1) the building blocks stay synchronous with a preload, as
the issue suggests; (2) it is done now; (3) `loadProfile(platform)` is
documented for hosts that prefetch when they open a C7 / C8 file; (4) a
chunk that fails to load is the new `E_PROFILE_LOAD` (category io), the
code the issue proposes.

- **Loader** (`src/platform/profile.ts`): the only importer of `c7.ts` /
  `c8.ts`, with `import()` (LOADERS); `feel.ts` and `schema-text.ts` come
  with `c8.ts`. `loadProfile(platform)` loads one rule set (one promise per
  platform; `'none'` resolves at once; a failed load is forgotten, so the
  next call imports the chunk again: in Node that loads it, a browser may
  keep the failed module fetch until the page reloads, Chrome does, and the
  `import()` specifier is a static string the host's bundler rewrites, so it
  cannot vary; the hint and the catalogue say so), `loadProfiles(platforms?)`
  several (default both). `runProfile` and `validateDoc(doc, { platform })`
  are still synchronous and throw `E_PROFILE_NOT_LOADED` (category usage,
  `details.platform`) when the resolved platform's rules are not loaded.
  Vendor descriptors, the zeebe lookups, detection and the design profile
  stay in the core: the ops and design-iq's save gate need them on every
  platform.
- **Rule kit** (`src/platform/rule-kit.ts`): the rule modules import
  nothing of the core at runtime (type imports only). They declare the
  helpers they use as module variables and export `useKit(kit)`; the loader
  calls it with `RULE_KIT` right after the import (`c8.ts` passes it on to
  `schema-text.ts`). Why: a module the core and a rule module both import
  is put by Rollup / Vite into the host's entry chunk, and the rule chunk
  then imports the entry chunk back; a host whose entry module awaits a
  C7 / C8 call or `loadProfile` at top level waited for itself forever (an
  earlier version of this change did; 0.4.0, without the split, did not).
  Now the C7 chunk imports nothing and the C8 chunk (with `feel` and
  `schema-text`) neither. Nothing of the kit may be used while a rule
  module is evaluated (only inside functions): the bindings are assigned
  after the import. A helper a new rule needs goes into `RULE_KIT`.
- **Pipeline** (`src/pipeline.ts`): `mutate()` awaits `ensureProfile`
  before anything runs and again after the ops (they can turn a plain file
  into a C7 / C8 file: the first `camunda:` / `zeebe:` content), `checkDoc()`
  before it validates. A load failure rejects before a result exists. The
  in-memory API, the file helpers and the CLI are unchanged.
- **Check** (`tools/iso/check.mjs`): names the on-demand chunks (Camunda 7
  rules, Camunda 8 rules, bpmn-auto-layout), fails when
  `dist/platform/{c7,c8,feel,schema-text}.js` is in the initial chunks of
  the whole entry or of the applyToXml-only entry (naming the module), fails
  when a rule module imports (also through another rule module) a module
  the entry loads (naming both: the hang above; esbuild alone never shows
  it, it puts shared modules into chunks of their own, so the check reads
  the module graph), and enforces `tools/iso/budget.json` (measured + about
  2 %: whole entry 830 / 261 KB, applyToXml only 630 / 201, C7 chunk 58 /
  18, C8 chunk 80 / 24; raising one is an explicit diff). Merged with
  `bpmn render` (#12) the whole entry is 860.7 / 271.3 KB (`renderSvg` and
  `locateProblems`, +46 KB; `applyToXml` only does not change), so its
  budget is 878 / 277 KB. `--table` prints
  the README table; `tools/iso/bundle.mjs` returns each chunk's text, the
  module graph and the entry chunk: the output whose metafile `entryPoint`
  is the requested entry (esbuild gives every `import()` target an
  `entryPoint`, so the earlier `chunks.find((c) => c.entry)` was right
  only because esbuild writes the entry first).
- **Tests**: `test/isomorphic.test.ts` bundles `src/index.ts` as an ESM
  split bundle, writes a fresh copy per case, loads it with Node's own
  loader (a CommonJS helper; vitest's `import()` would transform the chunks
  and cache a failed load) and records which chunk is evaluated: plain,
  design and `platform: 'none'` load nothing, a C7 file only the C7 rules,
  a C8 file only the C8 rules; a batch that turns a plain file into a C7 /
  C8 file loads them after the ops and reports 0.4.0's added findings
  (pinned); `E_PROFILE_NOT_LOADED`, the cache, and a missing chunk
  (`E_PROFILE_LOAD` with the page-reload hint, then a later call that
  imports it again). It also checks that exactly the requested entry is the
  entry chunk and that the rule modules import nothing the entry loads
  (both fail on the earlier version of this change). Without the load
  after the ops two of them fail. The ten test files that call
  `runProfile` / `validateDoc(doc, { platform })` directly start with `await
  loadProfiles()`; there is no global vitest setup, so the pipeline tests
  run the on-demand path.

Evidence (private corpus local, counts only):
- Sizes (`check.mjs`, KB = 1024 bytes, minified / gzip, initial chunks):
  whole entry 945.9 / 291.7 -> 814.7 / 255.1 (-131.2 / -36.6);
  `applyToXml` only 750.7 / 232.9 -> 618.2 / 195.8 (-132.5 / -37.1); on
  demand: C7 rules 56.3 / 17.0, C8 rules 78.8 / 23.1, bpmn-auto-layout
  82.1 / 28.0. The rule kit costs the rule chunks about 0.5 KB minified
  and saves the entry about 1.3 KB gzip (fewer names exported across
  chunks).
- A Vite 7.3.6 host whose entry module awaits the calls at top level, run
  in headless Chrome (scratch project, not in the repository): plain,
  design and `platform: 'none'` fetch only the entry chunk; C7, a plain ->
  C7 batch and `loadProfile('c7')` fetch only the C7 chunk; C8, a plain ->
  C8 batch and `loadProfile('c8')` only the C8 chunk; all resolve, and the
  added findings match 0.4.0. In Vite's chunk graph the C7 and C8 chunks
  import nothing. The same page built against the earlier version of this
  change stays pending for C7, C8 and the prefetch (the rule chunk imported
  the entry chunk).
- A blocked C8 chunk: `E_PROFILE_LOAD` in Chrome; after unblocking, a call
  in the same page fails again without a request (the browser keeps the
  failed fetch), as the hint now says.
- The CLI's output is byte-identical to a 0.4.0 build (stdout, stderr, exit
  code): `validate --json` on the 153 `.bpmn` files of `test/fixtures` and
  `tools/scenarios` (112 plain, 7 C7, 34 C8); 52 steps of `new` / `apply` /
  `set` / `ext` / `validate` sessions, text and `--json`, with the file
  identical after every step (plain, plain -> C7 through `set
  camunda:assignee`, plain -> C8 through `ext add zeebe:taskDefinition`,
  C7, C8, `--platform` overrides); `validate --json` on the 394 private
  corpus files (216 C7, 68 C8, 110 plain). After the rule kit, again
  against 0.4.0 (stdout, stderr, exit code, written file): 1,224 of 1,224
  commands on those 153 files (`validate --json` auto / c7 / c8 / none,
  `set name`, `set camunda:assignee`, `ext add zeebe:taskDefinition`, a
  mixed `apply`) and 396 of 396 on 50 private corpus files (20 C7, 20 C8,
  10 plain).
- gate: 1,820 tests + 247 opt-in, isomorphism check (89 modules, within
  the budgets, the rule modules import nothing the entry loads), layout
  regression 444 (budget 444), fuzz 12 x 15 0 / 0.

Still open (follow-ups):
- **bpmn-auto-layout under top-level await**: its on-demand chunk imports
  `bpmn-moddle` (and `min-dash`), which Rollup / Vite put into the host's
  entry chunk, so a host whose entry module awaits an `engine: 'auto'`
  call at top level hangs, in 0.4.0 as on this branch (checked in Chrome).
  A third-party module cannot take a kit; the README says to call it from
  a function. The check does not cover it (`rules: []`).
- **`guide.ts`**: it is tree-shaken from `applyToXml`, but importing any one
  of `guideShort`, `ERROR_CATALOGUE`, `kindsJson`, `kindsText` or
  `guideText` adds 118 to 141 KB minified / 35 to 42 KB gzip (constants
  computed at module scope keep the whole module). Split it per section or
  behind a `./guide` subpath (an issue of its own).
- The descriptors (about 25 KB minified, 3 KB gzip) stay in the core: the
  ops need them on every platform, and loading them on demand would put an
  async step before every op batch (option c' of #13).

## Step 3 follow-ups (2026-10-10, `step3/followups`)

A second verifier round on `step3/round1` found six more issues, and the
Claude Code plugin evals (agents using the plugin on real tasks) four
more; all ten are fixed on `step3/followups` (built on `step3/round1`),
each with a test that fails on round 1. The user's decisions hold: ids
only, speaking ids in the file's style, an explicit `--id` wins.

- **Anchor names with numbers** (`src/idstyle.ts speakingStem`, `hasWord`):
  a stem with many digits counted as a machine id, so the flows and tasks
  at the split after "Check 2024" were named by a kind word
  (`Flow_Check2024ToGateway`, `Activity_AfterGateway`). A stem with a word
  (a run of four letters with one that is no hex digit) speaks now:
  `Flow_Check2024ToAfterCheck2024`, `Activity_ServiceTaskAfterCheck2024`;
  `sid-...`, UUIDs and hex stay machine ids.
- **Data objects** (`idstyle.ts kindTypeNames`, `ops/artifacts.ts
  backingRequest`): in a file with type-named prefixes the reference and its
  `bpmn:DataObject` both wanted `dataObject_invoice` (the second took `_2`
  and a `W_ID_SUFFIXED`). The reference's type-named prefix is its own type
  now (`dataObjectReference_invoice` + `dataObject_invoice`; data stores
  alike); where a file names both with one prefix the backing element says
  what it is (`data_invoiceObject`), never a suffix.
- **DI ids** (`diagram/write.ts styledId`, `edgeStyleOf`): a DI id derived
  from a long element id (`Edge_<flowId>`, `BPMNShape_<id>`, `<id>_di`,
  planes, diagrams, the edge of a flow renamed after its ends) is cut at a
  word boundary to stay within 64 characters.
- **Camunda 8 values** (`platform/c8.ts dateTimeRangeProblem`,
  `cronProblem`, `platform/schema-text.ts` kind `boolean`): a date that does
  not exist (2030-02-30, 2031-02-29, 25:00, an offset over 18 hours) in a
  timer, a cycle's start or a due date, a cron field out of Spring's range
  (hour 25, month 13, day-of-week 8, a step of 0, a reversed range, `?`
  outside the day fields, an unknown name; Quartz `L` / `W` / `#` pass) and
  an xsd:boolean attribute that is not true / false / 1 / 0
  (`cancelActivity="maybe"`, `isExpanded="TRUE"` on a shape; bpmn-moddle
  reads it as false) are `W_C8_DEPLOY_TIMER` / `W_C8_DEPLOY_USER_TASK` /
  `W_C8_DEPLOY_SCHEMA` with the reason. 27 models deployed to Camunda
  8.9.22 (`test/step3-followups-c8.test.ts`), every verdict holds.
- **Duplicate ids** (`validate.ts checkDuplicateIds`): bpmn-moddle keeps the
  first element and drops the later one with an import warning, so
  `validate` said "valid". It is `E_DUPLICATE_ID` now, on every platform,
  naming the element it could not read and its line.
- **split** (`ops/split.ts`): a join needs two branches that reach it. When
  the other branches end in end events the one that continues runs on to
  the old successor directly (no pass-through gateway; `joinAs` is a usage
  error then); the note marks terminating ends `(end event)`.
- **space --by** (`ops/types.ts parseSpaceAmount`, `diagram/ops.ts
  spaceOp`): `<n>col`, `<n>column(s)`, `<n>row(s)`, `<n>px` besides
  `column`, `row` and pixels; the result notes the distance (`inserted 320
  px (2 columns of 160 px) right of X`), and a few pixels say how to ask
  for columns (`--by 2` is 2 px).
- **E_NOT_FOUND** (`document.ts suggest`): ids with the query's prefix
  first; the same prefix with one body inside the other is a candidate (the
  eval's `Flow_GatewayPurchaseApprovedToOrderGoods` suggests
  `Flow_PurchaseApprovedToOrderGoods`, not `Gateway_PurchaseApproved`).
- **Usage hints** (`cli.ts positionalHint`, `batch.ts shapeHint`): an
  unknown option that is a positional argument or a key gets the command
  rewritten (`add f.bpmn --kind userTask --name "Check it"` -> `bpmn add
  f.bpmn userTask "Check it"`; `set f.bpmn X --name Y` -> `name=Y`); a
  `route` op with `flowId` and a `set` op with its properties at the top
  level get the op rewritten. Wrong shapes are still refused.
- **Batch splices** (`diagram/place.ts spliceTarget`, `chainReaches`): the
  incremental layout placed a node as a splice only when its own flow had
  ended at the successor before the ops; in one batch that splices a task
  and then a gateway after it, the task's successor is the new gateway, so
  both went to a new branch row below (backward flow, crossing). A straight
  chain of new nodes is spliced as a whole now: the eval's model gets the
  same geometry as with two commands (score 0; before 9).
- **Labels inside pools** (`layout/place.ts framedSize`, `nodeLabels`;
  `layout/engine.ts` pool sizing, `declutterLabels`): a full layout made
  pools and lanes as wide as the shapes, so an end event's label at the
  right edge stuck out of the pool (the eval's order-to-cash model). Pools
  and lanes hold the labels right of their content, the last lane the
  labels below it, and a label the engine moves aside takes a free spot
  inside its frame first. Sub-processes are not resized for labels (that
  moved collaboration annotations on two corpus files).

Evidence (private corpora local, counts only; round 1 -> this branch):
gate 1,786 tests + 247 opt-in, isomorphism check (88 modules), layout
regression 444 (budget 444), fuzz 12 x 15 0 / 0; Camunda 8 engine suites
519 / 519; the new rules report nothing on the 38 real Camunda 8 files (the
agreement 38 / 38 holds) nor on 394 corpus files; the verifier's id probes
(96 files still on disk, 1,513 edits): `W_ID_SUFFIXED` 193 -> 142
(annotation + data 51 -> 0), flows with a kind word for an end 53 -> 10
(ends at unnamed gateways with hashed ids), ends that read alike 10 -> 7,
ids over 64 characters 8 -> 0 (longest 61); roundtrip on the 291 real
files unchanged (no-op identical 262 / 278 in layout auto, 278 / 278 with
`--no-layout`, rename 2 lines, insert 56 lines median); full layouts of 509
files: `labelOutsideFrame` 188 -> 160, score 2,653 -> 2,599; bundle 945.9 /
291.7 KB (whole entry, minified / gzip), `applyToXml` 750.7 / 232.9 KB.
Details: [docs/audit-2026-10.md](docs/audit-2026-10.md#step-3-follow-ups-2026-10-10).

Still open from these: a label left of a sub-process's content can stick
out of it (sizing sub-processes for labels moved other things), labels
above a gateway are not counted into a pool's height; new flows that end at
an existing unnamed gateway with a hashed id still read `...ToGateway` (the
documented fallback); two unnamed tasks after one unnamed gateway still
differ only by `_2` (documented), and in some camelCase files the flow to
the second reads `afterXToAfterX_2` (7 in the probes).

## Step 3 round 1 fixes (2026-10-10)

An independent verifier re-checked `step3/round1` (gate, dogfooding on large
real models, the corpora, the four engines). Its findings were fixed on
three branches built in parallel on round 1, `step3/fix-ids`,
`step3/fix-c8` and `step3/fix-views`, and merged on `step3/round1` together
with the leftover of the ids branch and the integration below. The user's
decisions hold throughout: elements are addressed by id only (names
repeat), new ids speak in the file's prefix, separator and case (never a
random, hash or numbered id), an explicit `--id` wins. With #53 fixed the
audit stands at 49 fixed, 5 partly fixed, 23 open of 77. Tables and
evidence (counts only):
[docs/audit-2026-10.md](docs/audit-2026-10.md#step-3-round-1-fixes-2026-10-10).

### Ids and report (`step3/fix-ids`)

The verifier's findings on ids and on the report (one medium, seven low).
Every fix has a test in `test/step3-ids-report.test.ts` that fails on
round 1.

- **Flows at unnamed elements** (`src/idstyle.ts labelOf`): an unnamed flow
  end is named by the speaking part of its own id, its kind and place
  (`Gateway_AfterCheck` -> `AfterCheck`; the join of the split after Check
  -> `CheckJoin`, `joinLabel`), not by a kind word, so the flows at two
  unnamed gateways differ without `_2` (`Flow_CheckToAfterCheck`,
  `Flow_AfterCheckToCheckJoin`, `Flow_FixJoinToCheckJoin`; round 1:
  `Flow_CheckToGateway`, `Flow_GatewayToJoin_2`, `Flow_JoinToJoin`). A flow
  renamed after its new ends (`followEnds`) gets the same rule; a flow an
  earlier build named with a kind word (`Flow_CheckToGateway`) still counts
  as named after its ends (`formerLabels`). Existing ids stay.
- **The context once** (`contextOf`, used by add, split, artifacts, lanes and
  the redraw's id-less elements): after / before an unnamed anchor placed
  the same way, the nearest named anchor (`Event_EndAfterCheck` after
  `Gateway_AfterCheck`; never `AfterAfter...`). An unnamed gateway or
  activity whose id is taken, or whose body another id has (the unnamed
  gateway it follows), first spells out its kind (`IdStyle.spelledBase`:
  `Gateway_ParallelAfterCheck`, `Activity_ServiceTaskAfterCheck`; not where
  the prefix says the kind, `Task_`, `parallelGateway_`); the merged build
  then names the anchor (see "The fixes together"), and only then `_2`.
- **Length** (`src/ids.ts cutAt`, `MAX_ID` = 64): bodies are cut at a word
  boundary (a name at 40 characters as before, now at a word; a join's
  `Join` and a number at the end are kept), the two ends of a flow share
  the room (`fitPair`), a suffix never makes an id longer than 64;
  `derivedBases` still recognises a flow a file got before the cap.
- **Transliteration** (`transliterate`): the letters NFKD does not reduce to
  a base letter are spelled out (`ø` -> `oe`, `å` -> `aa`, `æ` -> `ae`, `œ`
  -> `oe`, `ł` -> `l`, `đ` / `ð` -> `d`, `þ` -> `th`, `ı` -> `i`); a name
  without a letter (`123`, `✓✓✓`, `审批 订单`) names nothing
  (`hasIdWords`): the element gets the id of an unnamed one.
- **`bpmn new`** (`Doc.create`): `--name` or a speaking `--id` names the
  definitions (`Definitions_OrderToCash`, `Definitions_Billing`); without
  either they stay `Process_1` / `Definitions_1`. Round 1 wrote
  `Definitions_1` also with `--name` (this handover said otherwise).
- **Warnings delta** (`src/pipeline.ts validationDelta`, `src/result.ts
  ChangeSet.rename`, `src/ops/index.ts runBatch`): (a) the platform
  profile's findings the file had (`W_C7_*` / `W_C8_*`) count among "already
  in the file", so `preexistingCount` is what `bpmn validate` lists (a lint
  warning such a finding says again counts once, as there); (b) a group
  warning (`W_DUPLICATE_NAME`) stays the old one while its group only
  shrinks, list warnings (`W_BRANCH_NAME`, `W_IMPLICIT_SPLIT` / `_JOIN`)
  while their elements are among the old ones; (c) a bridge that takes the
  id of the flow the change removed is a takeover (`Rename.takeover`): the
  bridged flow's old id is removed, the taken id changed, no `renamed`;
  (d) op warnings about the model's state (`W_LANES_WITHOUT_POOL`,
  `W_IMPLICIT_SPLIT`, `W_IMPLICIT_JOIN`) are checked against the batch's
  final state (`stillHolds`); (e) a document created in memory has an empty
  platform baseline, so `new --target camunda8` lists
  `W_C8_DEPLOY_START_EVENT` (not `W_NO_START`), which the next edit
  resolves.

### Camunda 8 (`step3/fix-c8`)

The independent verifier found the profile's deploy recall at 0.74 on 200
adversarial models (W_C8_DEPLOY_* only; precision 0.94), false deploy
findings for white-space values and a lower-case date-time, no way to
address the message an op creates in a batch, a `zeebe:subscription` on the
event (where Camunda 8 ignores it), and `kinds --help` without the
zeebeElements section. Fixed, each rule checked on Camunda 8.9.22:

- **FEEL is parsed** (`src/platform/feel.ts`, no dependency, about 23 KB /
  7 KB gzip with the schema-text rules): a tokenizer and a recursive-descent
  reading of the grammar Camunda 8.9 parses at deploy, written from 766
  deployed expressions (`test/fixtures/c8/feel-verdicts.json`: 762 of them,
  synthetic, with the verdict; the check agrees on every one). `feelProblem`
  (c8.ts) keeps the JUEL messages and then runs it. Camunda's parser is
  lenient where a plain grammar is not (`x andy` is `x and y`, `ifx then 1
  else 2` an if, `x instanceof` is `x in stanceof`); the check splits a
  keyword glued to a name the same way. Messages name the FEEL spelling
  (`<> (FEEL: != ...)`, `if ... then without else`). Now also checked: a
  signal name and a published message name starting with `=`, the
  `zeebe:adHoc` expressions, an ad-hoc sub-process's completion condition
  (`set <id> completion=` sets it).
- **Schema rules from the file's text** (`src/platform/schema-text.ts`,
  W_C8_DEPLOY_SCHEMA): child elements out of the XSD's order (from
  bpmn-moddle's property order, with the places the XSD has a choice or
  orders differently as one slot), IDREFs that name no id (lane
  `flowNodeRef`, `default`, `dataObjectRef`, data associations, IO sets),
  ids that are no NCName (`a:b` in the model, with `set id=`; ones
  bpmn-moddle drops on import, `F:1`, from the text). Issues of an element an
  edit removed are dropped; the text is read once per document text.
- **Values**: `PT1.5H` is refused (a fraction on seconds only), a lower-case
  `t` / `z` in a date-time deploys; a job type, message / signal name, error
  / escalation code, process / decision id, result variable, listener type,
  linked resource type or published correlation key of white space deploys
  (only empty is refused: `missing()` in c8.ts), an empty priority deploys,
  an empty link name is refused.
- **`refAs`** on add / connect / set / retype binds the bpmn:Message /
  Error / Signal / Escalation the element references after the op
  (`bindRefAs`, ops/events.ts; E_USAGE when none or several); in the alias
  table, `--summary` and `aliases`.
- **The message a catching element waits for**: `ext add <event|receiveTask>
  zeebe:subscription` and `set <event|receiveTask|message>
  zeebe:correlationKey=` write the message's `zeebe:subscription`, with a
  note naming the other elements that share the message (redirect, not a
  refusal: the target is unambiguous, the result says where it went); an
  element without a message is E_WRONG_HOST with the `set message=` to run
  first. Camunda 7 has no such element (its descriptor has no message
  correlation key), so nothing changed there.
- `kinds --help` lists the sections from the section table; a test checks
  that every `kinds --section` the guide names exists.

Evidence on the branch (outside the repository; counts only): 126 probe models of this
round agree with the engine (before: 22 disagreed); the verifier's 200
adversarial models deployed again: W_C8_DEPLOY_* precision 0.938 -> 1.000,
recall 0.741 -> 0.951 (the 4 left get a structural error, so any finding:
recall 0.815 -> 1.000, precision 0.846 -> 0.910; the 8 left are structural
rules stricter than Camunda 8, a start event with an incoming flow and
similar, and an id with an umlaut bpmn-moddle cannot read); the 38 real
Camunda 8 files: the profile agrees with the engine on 38 / 38, 0 of 97
distinct real FEEL values flagged; the C8 edit battery (8 edit types, 304
edits): 0 regressions, 299 / 299 agree; its message edit with `refAs` or
the redirect instead of an id guess: 74 / 76 written (the 2 others keep an
existing message's other key: E_DUPLICATE_EXTENSION), 0 regressions, 0
misplaced subscriptions; the C8 engine suites 460 / 460. Tests:
`test/step3-c8-fixes.test.ts`.

### Views and layout (`step3/fix-views`)

The verifier's findings on the reading views and the format ops, and two
items the ids package left open (#14 for `move`, #53).

- **`show <id> --context`** (`src/context.ts elementContext`, `format.ts
  renderContext`): `caught by:` lists every boundary event of every
  sub-process around the element (message, timer, signal, conditional,
  error, escalation, compensation; inner first, non-interrupting marked;
  the element's own boundary events stay `boundary:`, the event
  sub-processes that catch it `event sub-processes:`, both of every kind);
  `message:` (id, name, Camunda 8 correlation key; `ElementContext.message`)
  on message events and send / receive tasks, which also list the message
  flows of their message drawn to their pool (`DetailMessageFlow.at`,
  `(at pool P)`); a message flow: `message:`, `in: collaboration`, `from:` /
  `to:` with their pools (`ContextLink.pool`); a message, signal, error or
  escalation: `used by:` (`usedBy`). `view.ts`: `correlationKeyOf`,
  `messageFlowEntry`. On 394 files the median stays 430 bytes (middle
  activity, p90 916; every node 441, before 424; message nodes 501).
- **Format ops never take a shape out of its sub-process**
  (`diagram/ops.ts`): `checkFrames` takes the references: a sub-process
  grows towards a reference inside it, never out to one outside it
  (`E_LEAVES_CONTAINER`); `alignOp` leaves out (note `left out <id>
  (sub-process <id>): ...`) a member only a selector named
  (`resolveSelection` returns `picked`); `makeRoom` refuses (`E_NO_ROOM`)
  when making room would take a shape out of a sub-process, lane or pool
  that held it. On 396 files: 0 runs adding `outside*` (19 before), more ops
  succeed (6,412 / 7,467, before 6,057); with `--path` / `--branch` sets
  (align, tidy, place; 6,295 runs) 0 add `outside*` (1 before).
- **`move` into a cross-lane flow** (#14 for move; `src/ops/lanes.ts`
  `inheritedLane` / `laneInheritedWarning` / `crossLaneNote`, shared with
  `add`): a node without a lane at its new place gets add's lane
  (`W_LANE_INHERITED`); a node in a lane keeps it, with a note when the flow
  runs between two other lanes, and is drawn on a row of that lane
  (`diagram/place.ts placeAfter`: after a branching anchor, the target's row
  in another lane than the node's own is replaced by a free row of its lane,
  `rowInLane`; before, the anchor's lane stretched over to the target's row,
  +125 px for the next lane, +265 px two lanes away; `add --lane` the same).
- **A plain `remove` of a join** (#53, `ops/remove.ts isMerge` /
  `refuseSynchronisingJoin`): a merge that does not synchronise is bridged
  from every predecessor like `--bridge-all`; a parallel / inclusive /
  complex join is `E_AMBIGUOUS_BRIDGE` with the two exact commands. The
  verifier's one Camunda 7 deploy regression (a plain remove in its
  battery) deploys now; on the battery's 66 merges: 62 bridged, all deploy
  on the three engines, 4 joins refused, 0 `W_UNREACHABLE` (before: 43
  refused by the engines, 379 `W_UNREACHABLE`). With #53 fixed the audit
  stands at 49 fixed, 5 partly fixed, 23 open of 77.

Tests: `test/views-context.test.ts`, `test/format-frames.test.ts`,
`test/move-lanes.test.ts`, `test/remove-join.test.ts` (each fails on
`step3/round1`); `test/diagram-format.test.ts` expects `E_LEAVES_CONTAINER`
for the column outside a sub-process (was `E_NO_ROOM`), the sub-process test
of `test/ops-mutate.test.ts` removes without bridging.

Evidence on the branch (private corpora local, counts only): `npm run gate` passes with
1,635 tests + 159 opt-in, the isomorphism check (86 modules, 904 / 277 KB
minified / gzip), layout regression 115 files score 444 (budget 444) and
fuzz 12 x 15 (0 errors, 0 warnings); the layout bench (175 models, 935
edits, 525 global runs) against `step3/round1`: no regression, every
figure equal (2 semantic failures in both, 0 runs adding hard defects).

### The fixes together (`step3/round1`)

Merged in the order ids, Camunda 8, views (merge commits). Git merged the
code of all three without conflict except one import line of
`src/ops/add.ts` (`bindRefAs` of the Camunda 8 branch next to the lane
helpers of the views branch); the docs were merged by hand. Then, each with
a test that fails on the merge before it:

- **Unnamed elements in a row** (the ids branch's leftover; `src/idstyle.ts
  anchorContext`, `IdRequest.anchorKind`, `IdStyle.qualifiedBase`,
  `fitPair`). In a file whose task prefix says the kind (`Task_`, `task_`,
  the older Camunda Modeler's files) a task after an unnamed gateway had
  the gateway's body (`Task_AfterCheck` after `ExclusiveGateway_AfterCheck`:
  `SequenceFlow_AfterCheckToAfterCheck`) and the next one `_2`. Now the
  context of an element after an unnamed anchor carries the anchor's kind,
  and where the id would repeat the anchor's (the base or its body taken,
  the spelled-out kind taken or not possible) the element names that
  anchor: `Task_AfterCheckGateway` ("after the Check gateway"), then
  `Task_AfterCheckGatewayTask`; in the default style
  `Activity_ServiceTaskAfterCheck`, then `Activity_AfterCheckServiceTask`
  (round 1 and the ids branch: `Activity_AfterCheck`, the gateway's body).
  Two unnamed tasks right after the same unnamed gateway take `_2` on the
  form that names the gateway (`Task_AfterCheckGateway_2`), never the
  gateway's body. The two ends of a flow that begin with the same word
  (the elements after one anchor) keep their last word when the 64
  character cap cuts them (`cutKeepingLast`), so a long anchor name no
  longer makes `flow_afterXToAfterX`. `W_ID_SUFFIXED` is a signal again: a
  name the file already has, a second flow between the same pair, or
  unnamed elements that only an index tells apart.
- **`--summary`** (`src/report.ts mutationSummary`): an element the change
  created is listed once, under `created` (before, a batch in lanes listed
  every new node under `changed` too, for the lane it got, and a message
  `refAs` named and an `ext` op then completed). The full result keeps those
  change entries.
- Checked together (`test/step3-fixes-integration.test.ts`): the message of
  `refAs` in the aliases and `--summary` next to speaking ids; the
  subscription redirect of a receive task in the warnings delta (the deploy
  finding resolved once, nothing added, the note in the result); a plain
  remove of a merge renames the bridged flows after their new ends
  (`renamed`), a parallel join is refused with both commands; `move` out of
  a sub-process into a cross-lane flow takes add's lane
  (`W_LANE_INHERITED`) and renames the split flow after its new ends.

### Evidence on the merged build

Private corpora used locally, outside the repository; counts only.

- **Gate**: `npm run typecheck` clean; `npm run gate` 1,729 tests + 219
  opt-in (engine tests), isomorphism check (88 modules), layout regression
  115 files score 444 (budget 444), fuzz 12 x 15: 0 errors, 0 warnings.
- **Engines**: the Camunda 7 live-engine suites 804 / 804 (Camunda 7.24.0,
  CIB seven 2.2.0, Operaton 2.1.5); the Camunda 8 suites 460 / 460 (Camunda
  8.9.22).
- **Camunda 7 real-file battery** (50 files, 48 deployable on all three
  engines before; 8 edit types: rename, an external task with an input
  parameter, a plain remove, a boundary timer path, a split with a JUEL
  condition, retype, compact, `remove --bridge-all` of a join): 373 edits,
  all written, 0 regressions on any of the three engines (round 1: 1, the
  plain remove the views branch fixed).
- **Camunda 8 corpus** (38 real files, 4 refused by Camunda 8.9.22): the
  profile agrees with the engine on 38 / 38, 0 false deploy findings.
- **Roundtrip** (`tools/roundtrip.mjs`; 289 of the 291 real files are
  still on disk, 276 with a rename target): a no-op is byte-identical in
  260 / 276 in layout auto (260 / 263 of the files with a diagram, 98.9 %;
  the 13 without one are drawn) and 276 / 276 with `--no-layout`; a rename
  changes 2 lines (median, p90, max); an insert 56 lines in the median, a
  region of 83.2 %. Round 1 gives the same figures on the same files.
- **Ids** (the ids branch's probe set: 15 edits on each of 271 real files,
  4,017 edits, 21,000 new ids, 10,144 new flows; round 1 -> `fix-ids` ->
  merged): `W_ID_SUFFIXED` 394 -> 542 -> 221, of it unnamed elements in a
  row and names without letters 11 -> 332 -> 11 (all 11 in files with the
  `scopedTo` flow form); new flows whose two ends read alike 168 -> 507 ->
  3; flows with a kind word for an end 1,879 -> 178 -> 178; ids over 64
  characters 2,533 -> 0 -> 0 (longest 110 -> 61 -> 61);
  `tools/speaking-ids.mjs` on the 289 files: 1,731 / 1,731 new ids speak,
  two edits with unnamed elements at two places share an id in 0 / 223
  file pairs. The rest of
  `W_ID_SUFFIXED`: a data object, task or pool of a name the file already
  has, a second flow between the same pair (also the bridge of a remove),
  and the `AfterToAfter` flows of the `scopedTo` files (nested splits).
- **Browser bundle**: whole entry 936.5 / 288.2 KB minified / gzip,
  `applyToXml` 742.3 / 229.7 KB (+82 KB bpmn-auto-layout on demand);
  round 1: 897 / 275 and 710 / 219 KB, most of the growth the FEEL parser
  and schema rules of the Camunda 8 fixes.
- **Docs**: `guide --short` 4,172 bytes (budget 5 KB).

### Still open after the round 1 fixes

- **Breaking for hosts** (design-iq): the mutation JSON / `EditReport` has
  `warnings: {added, resolved, preexistingCount}` and no
  `validation.warnings`; `--json` is compact; `show` puts `lane=` on each
  node and writes message flows differently; new ids speak and a flow whose
  id named its ends is renamed (`renamed` in the result).
- Ids: two branches adding an element of the same name (or an unnamed one
  at anchors of the same name) get the same id, a merge of both a
  duplicate; a flow renamed after its ends is the one exception to "ids
  never change" (`Doc.followFlowEnds = false` in the library, no CLI
  switch; since #32 `--keep-flow-ids`, see the section at the top); `bpmn new` without `--name` (and without a speaking `--id`)
  writes `Process_1` / `Definitions_1`; `move` of a node with several
  incoming flows still disconnects them (only `remove` bridges a merge),
  and removing a join together with its predecessors (the join first) is
  refused rather than bridged; a context is read from the anchor's id, so
  a cut anchor id gives a cut context
  (`Gateway_After4AugenPrinzipPruefenFreigeben2`); in files with the
  learned `scopedTo` flow form (`Flow_KotO_ValidateToReserve`: the first
  word of each end) the flows between unnamed elements after one anchor
  read `AfterToAfter` and take `2`.
- Views: no `find --attr` / `list --fields` projections, no `vars` view,
  no `render` command; the full `show` keeps vendor values but not the
  extension summary; JSON is compact but not slimmer; `--strict` still
  counts every warning, also the file's own.
- Layout: compaction closes strips only, pools side by side are not
  compacted against each other, a full redraw orders pools by its own rule;
  open bugs #13, #15, #16, #19, #25, #63–#68, #70, #76 (#40, #74 partly);
  the fuzzer still finds `place` / `align` pushing a flow through a shape
  and a boundary event added on a host inside a sub-process intruding into
  another frame (the build before step 3 does the same); format ops with
  selector sets still add overlaps or a flow through a shape on some real
  files (as many as before the round 1 fixes, which removed `outsideSub`).
- Camunda 8: FEEL syntax is checked but not its meaning (types, functions),
  variables are not followed, `zeebe:publishMessage` is reported as not
  run, event-based gateways of a file without `<bpmn:outgoing>` lists have
  no repairing command, forms / called processes / decisions are not
  checked against a deployment; some structural rules are stricter than
  Camunda 8 (a start event with an incoming flow and similar: 7 of the
  verifier's accepted models get an error), an id with an umlaut is
  unreadable for bpmn-moddle; the Camunda 7 profile does not check timer
  values (`PT2D` deploys there and fails at run time).
- `--summary` drops the notes, also the one that says where a
  subscription given to a catch event went (`changed:` names the message);
  the full result and `--json` keep it.
- The core grew by about 220 KB minified / 64 KB gzip since 0.3.0 (most of
  it the Camunda 8 profile, its descriptor and the FEEL parser): a lazily
  loaded profile per platform would be the lever.

## What step 3 round 1 changed (2026-10-10)

Four packages were built in parallel on `step3/views`, `step3/ids`,
`step3/layout` and `step3/camunda8` (each on 0.3.0) and merged on
`step3/round1`. Two decisions of the user hold for all of them: elements
are addressed **by id only** (names may repeat; there is no name-based
addressing anywhere, `--around "<name>"` is `E_NOT_FOUND`), and **new ids
speak** (`Activity_CheckInvoice`, `Gateway_InvoiceOk`,
`Flow_CheckInvoiceToBookInvoice`; never a random, modeler-hash or hash id)
while following the file's prefix, separator and case; an explicit `--id` /
`"id"` always wins. 18 audit bugs are fixed and 3 partly (#12, #14, #21,
#22, #28, #39, #41, #42, #48, #58, #60, #61, #62, #69, #71, #72, #73, #77;
#40, #53, #74 partly): 48 fixed, 6 partly fixed, 23 open of 77 (after the
round 1 fixes above 49, 5 and 23). Tables and evidence:
[docs/audit-2026-10.md](docs/audit-2026-10.md#step-3-round-1-2026-10-10-the-packages-together).

### Views and output (`step3/views`)

Goal: token-efficient reading for agents on large models and output that
does not grow with the file's old problems. Elements are addressed by id
only (names may repeat; no name-based addressing). Fixed audit bugs #21,
#22, #58, #60; details and measurements in
[docs/audit-2026-10.md](docs/audit-2026-10.md#step-3-2026-10-10-views-and-output).

- **`show --around <id> [--depth n] [--inner]`** and **`show <id>
  --context`** (`src/context.ts`: `aroundView`, `elementContext`,
  `implementationOf`; renderers `renderAround` / `renderContext` in
  `src/format.ts`; `viewDoc` / `renderShown` in `src/api.ts` are what the CLI
  and `viewXml` / `showXml` share, the option checks included). The window
  follows sequence flows both ways (boundary event <-> host, link pairs; a
  sub-process's first / last node leads out to it, `--inner` also in), lists
  per node lane, vendor values and a compact extension summary (`io: in a;
  out b`, `zeebe:taskDefinition type=...`, `type xN`), `<-` incoming flows
  from outside, the omitted counts, and the window's message flows,
  annotations and data. The context lists pool > process > sub-processes,
  the effective lane (`via` a sub-process or a boundary event's host,
  `within` parent lanes), from / to with names, own boundary events, every
  boundary event of the sub-processes around it (`caught by`; error /
  escalation only until the verifier fixes below), the event sub-processes
  of every scope around it (not the one it is in), annotations, message
  flows with partner and pool, data.
- **`show`**: `lane=<id>` per node, the lanes section is a tree of names;
  message-flow lines with endpoint names; collaboration annotations
  (`ModelView.collaboration.annotations`). **`show <id>`**: `messageFlows`,
  `annotations`, `attachedTo`, `data` (`src/view.ts`: `messageFlowsOf`,
  `annotationsOf`, `dataLinksOf`, `poolOf`).
- **Warnings as a delta** (`src/pipeline.ts validationDelta`,
  `MutationResult.delta`; `src/report.ts`): a lint warning the file had
  (code, element, related elements, followed through renames) and every
  `W_PREEXISTING_ERROR` are counted, not listed; resolved = the lint warnings
  and errors the file had that are gone, plus the platform's and validators'
  resolved ones. A document created in memory (`new`) has no delta: all its
  warnings are added. The report: `warnings: {added, resolved,
  preexistingCount}`, `validation` without `warnings` (breaking for
  consumers of the JSON / `EditReport`; `MutationResult.validation.warnings`
  is unchanged, `--strict` still counts every warning). Text: added warnings
  (`warningLines`: three or more of one code as one line), `resolved:`, one
  count line. `--summary` (`mutationSummary` / `renderSummary`).
- **Docs cost** (`src/guide.ts`): `guideShort()` (3.8 KB; test: <= 5 KB),
  `guideTopic(topic)` slices the full guide by its headings (`GUIDE_TOPICS`;
  new sections READING LARGE MODELS, OUTPUT, CAMUNDA 8), `kinds --section`
  (`kindsSections` / `kindsSectionText` / `kindsSectionJson`). Every
  `--json` is compact, `--pretty` indents.
- **stdin / stdout** (`src/cli.ts readDocArg`, `runMutation`): `-` as the
  file for every command; a mutation of stdin or `-o -` writes the XML to
  stdout and the report to stderr; `apply - -` is `E_USAGE`.
  `layoutDocToFile` (node layer) serves `layout -`.

Tests: `test/views.test.ts` (views, #21, #22, the byte budget per node),
`test/report-delta.test.ts` (delta, floods, summary), `test/cli-views.test.ts`
(the CLI: flags, compact JSON, `--summary`, stdin / stdout, `guide --short` /
topics, `kinds --section`, the CAMUNDA 8 recipe run), the isomorphism test
runs `--around` / `--context` in the browser bundle; synthetic fixture
`test/fixtures/views/claims.bpmn`. Gate on the branch: 1,354 tests + 1
opt-in, layout score 444, isomorphism and fuzz unchanged.

Evidence (private corpora, local only): `--around` (depth 2) on 278 real
files 1.2 KB median / 2.1 KB p90 vs `show` 2.3 / 7.6 KB vs PR #218's
`outline --around` 1.4 / 2.4 KB; on the 30 models with >= 30 flow nodes
1.8 KB vs 10.6 KB; 236 bytes per shown node (median); 0 failures on 383
files. A rename's text result on the 97 real files with old warnings: 523
-> 245 bytes median, JSON 2,597 -> 1,276.

Still open from this package (after the integration): `find --attr` / `list --fields` projections
and a `vars` view (where is variable X used) were not built; `render` is
not a command; the full `show`
keeps vendor values but not the extension summary of `--around` (to keep
its size); JSON is compact but not slimmer (the model view still repeats
`type` / `extensions` / `extensionElements`).

### Speaking ids and batches (`step3/ids`)

User decisions: no name-based addressing (elements are addressed by id,
names may repeat), and every new id must speak. Branch `step3/ids`; table
and evidence in
[docs/audit-2026-10.md](docs/audit-2026-10.md#step-3-2026-10-10-speaking-ids-and-batches).

- **Speaking ids** (`src/idstyle.ts`): `next(req)` always builds the id from
  words: a named element from its name, an unnamed one from a word for its
  kind and its context (`IdRequest.context`, given by the ops:
  `After <anchor>`, `Before <anchor>`, `On <host>`, `In <sub-process>`;
  `Gateway_AfterCheckInvoice`, `Event_TimerOnReview`,
  `Event_EndAfterTimerOnReview`), a flow from its ends (`flowRequest`,
  `labelOf`: the speaking part of an end's id, its name when the id says
  too little, else a kind word; `Flow_CheckInvoiceToBookInvoice`), the rest
  from its owner (the verifier's fixes after round 1 refined the unnamed
  cases, see below). The prefixes,
  the body case and the file's own flow forms are learned as in step 2;
  hashed and numbered files lend their prefix and separator to the new
  `named` flow form; `hash7` and running numbers are gone. Every collision
  suffix is recorded by `Doc.allocateId` and reported as `W_ID_SUFFIXED`
  (`Doc.reportSuffixed`, called by `runOp`, `addElement`, `connectElements`).
- **Flows follow their ends** (`ops/flows.ts followEnds`, called by
  `redirectFlow` and `spliceIntoFlow`): a flow whose id is the one the
  style gives a flow between its old ends (also with a suffix, also built
  from an end's former name) is renamed after its new ends, its derived DI
  edge id with it; the change says `renamed from ...`. `ChangeSet.rename`
  rewrites the entries of earlier ops of the batch. `Doc.followFlowEnds =
  false` keeps ids (the engine-ownership check simulates a remove).
- **Batch aliases** (`src/ops/aliases.ts`, `ops/index.ts runBatch`): `as`
  (add, connect, split, split nodes), `flowAs` (add, split nodes: the flow
  into the node), `joinAs` (split); aliases bind elements
  (`ChangeSet.bind`), are resolved per op (format ops at the end of the
  batch), checked by `parseOps` (`checkAliases`); `MutationResult.aliases`
  / the `aliases:` line. `mutateDoc` resolves typed ops the same way.
- **E_NOT_FOUND** (`Doc.suggest`, `Doc.batch`): ranked candidates (renamed
  in the batch, case / umlaut / other or no prefix, containment, typos with
  `editDistance` from `src/ids.ts`, names), the batch's own ids first and in
  the hint.
- **remove** (`ops/remove.ts`): `--with-branch` (`branchOf`: the nodes only
  the root leads to, boundary paths and compensation handlers included;
  `E_AMBIGUOUS_BRANCH` for a node several paths reach) and `--bridge-all`
  (a join from every predecessor; `E_AMBIGUOUS_BRIDGE` for a split).
- **add into a cross-lane flow** (#14, `ops/add.ts inheritedLane`): the lane
  of the row the incremental layout uses (the target's after a branching
  source), `W_LANE_INHERITED`; decided before the placement.

Tests: `test/speaking-ids.test.ts`, `test/batch-aliases.test.ts`,
`test/not-found.test.ts`, `test/remove-branch.test.ts`,
`test/lane-splice.test.ts`; expectations of hashed / numbered ids in the
older tests now name speaking ids. Tool: `tools/speaking-ids.mjs`.

Evidence (291 real files, counts only): new ids that speak 1,745 / 1,745
(0.3.0: 645 / 1,365); the prefix step 2 learned kept for 1,628 / 1,630; two
independent edits at two places share a new id in 0 / 225 file pairs (0.3.0:
9), with unnamed elements 3 / 225 (0.3.0: 9), with the same name 225 / 225
(0.3.0: 219: a name gives the id); 380 flows renamed after their ends; an
insert changes 70 lines (median; 0.3.0: 66). Gate on the branch: 1,353 tests, layout
regression 444, fuzz 0 errors; 80 x 25 fuzz walks as 0.3.0. The README's
Camunda 7 example with speaking ids deploys on the three Camunda 7 engines.

Still open from this package: two branches that add an element of the same
name produce the same id (git merges both: a duplicate id), the same for
unnamed elements at anchors of the same name; renaming a flow after its ends
changes a few more lines of an insert (the flow, its ends' mirror lists, its
DI edge); `Process_1` / `Definitions_1` of `bpmn new` without `--name` are
tool defaults, not speaking (round 1 wrote `Definitions_1` with `--name` too;
since the round 1 fixes `--name` or a speaking `--id` names the
definitions). (`move` into a cross-lane flow and a plain `remove` of a join,
open here, are fixed by the round 1 fixes below.)

### Layout ergonomics (`step3/layout`)

Formatting a kept drawing without XML, the operations the dogfooding agents
missed (branch `step3/layout`; elements are addressed by id only, names can
repeat). Details, measurements and the bug statuses:
[docs/audit-2026-10.md](docs/audit-2026-10.md#step-3-2026-10-10-layout-ergonomics).

- **`compact [<pool|lane|subProcess>...]`** (`src/diagram/compact.ts`,
  op `compact`): closes empty columns / rows and shrinks expanded
  sub-processes, pools and lanes to their content, inside out, keeping order
  and relative positions. Each strip is closed with `space.ts closeStrip`
  inside a guard (`ops.ts guard`: reroute what broke, measure, undo a strip
  that adds a hard problem or raises the score, note it). Message flows do
  not hold a strip open (their bends and labels are squeezed). Negative
  `space --by -column|-row|-<px>` closes empty space at one place.
  Real corpus: 0 hard problems added, score never raised; total area -9 %
  (hand / broader corpus), -14 % on models edited in agent sessions, up to
  -47 %; 8-31 ms median.
- **Pool order**: `order <collaborationId> <participantId...>` (ops JSON
  `pools`, black boxes included): participants and pool bands restacked,
  message flows routed again (`E_NOT_PARTICIPANT`).
- **Selectors** for place / align / color / tidy (`src/diagram/select.ts`):
  `--path <fromId> <toId> [--via <flowId...>]`, `--kind <kind>`,
  `--branch <flowId>` (`place --branch F --below X` moves a branch up to the
  join); `E_NO_MATCH` when they name nothing.
- **`show --layout`**: column indices (c0..cN) per node across the diagram,
  wide empty gaps between columns, ` … ` where a wide gap splits a row (JSON
  `columns`, `gaps`).
- **Metrics**: soft kinds `backwardFlow`, `segmentOverlap` (flows merging on
  one line before their target), `labelOutsideFrame`, `messageLabelFar`
  (`QUALITY_KEYS`, weights < 6).
- **Audit bugs fixed**: #12, #39, #41, #42, #61 (`layout.reshaped`,
  `format[].reshaped`), #62, #69, #71, #72 / #73 (reported by the new kinds),
  #77 (a splice pushes only by the missing room); #40 and #74 partly.
- **Fuzzer**: generators for compact, closing space, pool order, selectors.
- Tests: `test/step3-compact.test.ts`, `test/step3-order.test.ts`,
  `test/step3-select.test.ts`, `test/step3-view.test.ts`,
  `test/step3-audit.test.ts`, new cases in `test/diagram-metrics.test.ts`.
  Gate on the branch: 1357 tests (+39), layout regression 444, fuzz 0 errors
  and 0 warnings (before: 2), browser bundle 746 / 234 KB minified / gzip.

### The Camunda 8 profile (`step3/camunda8`)

Goal: mirror the Camunda 7 work for Camunda 8 (Zeebe), every rule checked
against Camunda 8.9.22 (REST v2). Fixes #28 (no Camunda 8 rules). Table with
the findings, the rules and the evidence:
[docs/audit-2026-10.md](docs/audit-2026-10.md#step-3-2026-10-10-camunda-8-profile).

- **Zeebe descriptor as data** (`src/platform/zeebe.ts`): `zeebe-bpmn-moddle`
  2.0.0 (pinned development dependency) is inlined as
  `src/platform/zeebe-descriptor.ts` by `tools/gen-camunda-descriptor.mjs`
  (which now writes both descriptors; `--check`; `test/isomorphic.test.ts`
  compares both with the installed packages). Never registered with
  bpmn-moddle. `zeebeType`, `zeebeAllowedOn`, `zeebeContainersOf`,
  `zeebeNestedOnly`, `zeebeAttr`; corrections where Camunda 8.9 differs
  (`zeebe:subscription` on bpmn:Message, `zeebe:properties` anywhere,
  `zeebe:publishMessage`, which the descriptor does not know).
- **Camunda 8 profile** (`src/platform/c8.ts`, wired in `profile.ts`;
  `report.ts` counts its findings like Camunda 7's; `validate.ts` drops the
  lint warnings a C8 finding repeats): 34 codes, 22 `W_C8_DEPLOY_*` (Camunda
  8 refuses the file), 11 runtime, 1 practice; hints are exact commands
  (single elements rebuilt with `--replace` and every attribute they keep).
  Checks executable processes (also ad-hoc content, which Camunda 8
  validates; a file without an executable process is refused), the root
  elements they use and the schema rules on the whole file. Timer values
  (`validDuration`, `validDateTime`, `validCycle`) and the FEEL slips
  (`feelProblem`: `&&`, `||`, `==`, `!`, `${...}`, single quotes,
  brackets, a dangling operator; FEEL is not parsed) were decided by
  deploying 60 timer values and 45 expressions.
- **Operations**: `new --target camunda8` writes
  `modeler:executionPlatformVersion="8.9.0"`; `add` / `retype` give a user
  task of a Camunda 8 file `zeebe:userTask` and a new event definition an id
  after its event (`src/ops/platform.ts`; since the integration through the
  id style: Camunda 8.9 refuses conditional, compensation and link catch
  definitions without one); `ext
  add <id> loop.zeebe:loopCharacteristics` creates the multi-instance loop;
  a zeebe element where the descriptor says it is not read is
  `W_MISPLACED_EXTENSION`; `zeebe:adHoc`, `conditionalFilter` and
  `publishMessage` are kept single (merged); `set <id> zeebe:<attr>` for an
  attribute of a zeebe element is `E_WRONG_HOST` with the `ext add` (also
  `loop.zeebe:*`, `zeebe:correlationKey` -> the message's subscription);
  `retype` names the zeebe content the new kind cannot use.
  `src/ops/covers.ts` (moved out of retype.ts, re-exported there): an
  operation warning the profile repeats item by item gives way to the
  profile findings (retype's summary, the zeebe W_MISPLACED_EXTENSION,
  `W_DECISION_RESULT_VARIABLE`).
- **View**: `show` names what a Camunda 8 node does (`job=`,
  `calledElement=`, `script=`, `form=`, `assignee=` / `candidateGroups=` /
  `candidateUsers=`, `inputCollection=` ...), a message its correlation key.
- **Docs and examples**: README "Camunda 8" (settings table, the profile,
  the evidence, a worked example that deploys and runs), the guide's CAMUNDA
  8 recipe, `bpmn kinds` section CAMUNDA 8 (`kinds --json` ->
  `zeebeElements`), every `W_C8_*` code in the catalogue. The ops example
  and the worked session are valid Camunda 8 now (FEEL condition, `P2D`:
  the old examples' `PT2D` is no ISO 8601 duration and Camunda 8 refuses
  it; a job type for every service and send task).

Tests: `test/c8-profile.test.ts` (151 models with Camunda 8's verdict, the
value checks, the validate output, the Modeler defaults; live engine opt-in
with `BPMN_C8_ENGINE=<REST v2 root>`, which also runs 7 runtime scenarios),
`test/c8-ops.test.ts` (set / ext / retype / show, the ops example, the
hints run through the CLI and, with the engine, deployed). Evidence (outside
the repository; counts only): the engine suites 332 / 332; 590 probe
deployments, the profile disagreeing only on two XSD element-order errors
and four cases the structural validation is stricter about; the 38 real
Camunda 8 files and 28 scenario files: 0 false deploy findings, 32 / 32
refused files found, following the hints made all 32 deployable (306
commands); the edit battery (7 edit types, 459 edits): 0 regressions, the
profile agrees with the engine on every result, 1,689 / 1,689 extension
blocks outside the edited elements byte for byte unchanged; the Camunda 7
live-engine suites unchanged (804 / 804).

Still open from this package: FEEL is not parsed (only the common slips); the
profile does not follow variables (an input mapping's local variable read
by a later gateway); `zeebe:publishMessage` is reported as not run by 8.9
(drop the rule when Camunda runs it); a file without `<bpmn:outgoing>`
lists cannot get them for an event-based gateway (reported, no command);
linked forms, called processes and decisions are not checked against a
deployment; the core grew by about 90 KB minified / 23 KB gzip.

### Integration (`step3/round1`)

Merged in the order views, ids, layout, camunda8 (merge commits with the
conflict resolutions), then integration commits with their tests in
`test/step3-integration.test.ts`:

- **Aliases reach every op key that names an element** (`ops/aliases.ts
  REF_KEYS`): the selectors `path`, `via`, `branch` of place / align /
  color / tidy, the `ids` of `compact`, the `pools` of `order`. A format
  op runs after the layout, outside the batch; its ids are now checked at
  the end of `runBatch` while the batch context is set, so an id an earlier
  op renamed or removed is `E_NOT_FOUND` naming the new id (a flow renamed
  after its ends) and the op, as for the semantic ops.
- **`--summary` and the JSON** (`src/report.ts`): the batch aliases, the ids
  the change renamed (`renamed`, old -> new: a flow whose id named its old
  ends; chains collapsed, elements the change created left out; text
  `renamed: <old> -> <new>`), one line per format op (`format <op> #<i>:
  ...`, JSON `format`), so a place / compact / color result is no longer
  "no changes".
- **Warnings delta and the Camunda profiles** (`validate.ts lintCoveredBy`,
  used by `withProfile` and `pipeline.ts validationDelta`): a resolved
  missing start is listed once, as the platform finding (it was listed as
  `W_NO_START` and `W_C8_DEPLOY_START_EVENT`).
- **Reading views and Camunda 8**: `show --around` / `show <id> --context`
  print a zeebe setting once, in the extension summary (`view.ts nodeProps(el,
  { zeebe: false })`: no `job=` next to `zeebe:taskDefinition type=...`);
  the full `show` keeps the short facts.
- **Camunda 8 event definition ids** (`ops/platform.ts
  definitionIdDefault`): through `Doc.allocateId` (`typeRequest` of the
  definition type, the speaking part of the event's id, else its name or a
  kind word): the file's prefix and case, never a Modeler hash
  (`ConditionalEventDefinition_StockReady` for `Event_1q2w3e4` "Stock
  ready"), a taken id `_2` with `W_ID_SUFFIXED`.
- **A layout defect the gate's fuzz campaign hit on the integrated build**
  (walk `controlflow__s04`, seed 1491033354, step 10; every package build
  gave the same defect on that walk, the walk only came up with the new
  ids): removing a node closed the strip on its row and pulled an expanded
  sub-process over a gateway of the row below (`di:frameIntrusion`).
  `diagram/incremental.ts closeRow` now undoes the close when a moved
  expanded sub-process comes within 10 px of a shape that stays.
- **Docs**: one CAMUNDA 8 guide section (the recipe of both packages; every
  `ext add` / `set` line of it runs in `test/cli-views.test.ts`), `kinds
  --section zeebeElements`, the short guide names speaking ids, aliases and
  renamed flows; guide examples with speaking ids; the README's worked
  session, `--summary` examples and Camunda 7 / 8 worked examples re-run
  with the integrated build.

### Evidence on the integrated build

Private corpora used locally, outside the repository; counts only.

- **Gate**: 1,615 tests + 159 opt-in (engine tests), isomorphism check (85
  modules), layout regression 115 files score 444 (budget 444), fuzz 12 x
  15: 0 errors, 0 warnings.
- **Engines**: the Camunda 7 live-engine suites 804 / 804 (Camunda 7.24.0,
  CIB seven 2.2.0, Operaton 2.1.5); the Camunda 8 suites 332 / 332
  (Camunda 8.9.22).
- **Roundtrip** (`tools/roundtrip.mjs`, the 291 real files, 278 with a
  rename target; 0.3.0 on the same files in brackets): a no-op is
  byte-identical in 262 / 278 in layout auto (262 / 278; 262 / 265 of the
  files with a diagram, 98.9 %: the 13 without one are drawn) and 278 / 278
  with `--no-layout` (278 / 278); a rename changes 2 lines (median, p90 and
  max with `--no-layout`; 2); an insert changes 56 lines in the median
  (54) and a region of 83.2 % (80.3 %): the flow renamed after its new
  ends.
- **Camunda 7 real-file battery** (218 files, 8 edit types, 1,512 edits):
  every edit succeeds, 0 regressions on any of the three engines, 0
  unexpected camunda changes (one file deploys after a remove, as in step 2).
- **Camunda 8**: the 66 corpus files 0 false deploy findings, 32 / 32
  refused files found; the edit battery 459 edits, 0 regressions, the
  profile agrees with the engine on 459 / 459 results, 1,689 / 1,689
  extension blocks outside the edited elements unchanged; following the
  hints (306 commands, none refused) makes 32 / 32 refused files deployable.
- **README examples**: the worked session's result deploys on Camunda 8.9;
  the Camunda 8 worked example deploys and runs both paths; the Camunda 7
  worked example deploys on the three engines.
- **Browser bundle**: whole entry 897 / 275 KB minified / gzip, `applyToXml`
  710 / 219 KB (+82 KB bpmn-auto-layout on demand); 0.3.0: 716 / 224 and
  594 / 186 KB. After the Camunda 8 fixes (below): 922 / 284 and 733 / 227 KB.

## What step 2 changed (2026-10-09): bpmn-cli as design-iq's editing engine

Goal: bpmn-cli as the editing engine inside Miragon's design-iq (PR #218 of
Miragon/design-iq, its ADR 0008), which runs the editor in the browser,
stores BPMN in git, syncs a file live by replacing one text region per save
and refuses every save its validator finds an error in. Four packages were
built in parallel and merged on `step2/integration`; 13 audit bugs are fixed
(#27, #29–#33, #43–#47, #55, #56), 2 partly (#48, #49). Tables and evidence:
[docs/audit-2026-10.md](docs/audit-2026-10.md#step-2-2026-10-09-design-iqs-editing-engine).

**The write pipeline, as it is now** (`src/pipeline.ts mutate`, in memory,
browser-safe): lossy-import guard -> the document as read is serialised once
(`asRead`, the baseline of the text step) -> layout snapshot and sticky
anchors -> error baseline, platform profile baseline, validators on the
document before the ops -> ops -> structural validation (`E_VALIDATION` for
introduced errors) -> layout (auto / incremental / full; a full redraw gives
the DI its ids back inside `layoutModel`) -> format ops -> stickies follow
their nodes -> text-preserving step (`outputText`: mirror lists the file's
way, unchanged elements keep their text) -> validators on that final text
(`E_VALIDATION` for introduced errors) -> `unchanged` (result equals the
input text). The node layer (`src/node/files.ts`) reads, looks up the
design-iq content repository, calls the pipeline and writes atomically,
skipping a write of an unchanged result over its own file.

- **Browser-safe core and in-memory API** (core package, #33, #49 partly).
  Two entries (`package.json` `exports`): `@miragon/bpmn-cli` (`src/index.ts`)
  never touches files, `process` or Node builtins; `@miragon/bpmn-cli/node`
  (`src/node/index.ts`) adds `readXml`, `readDoc`, `loadDoc`, `writeAtomic`,
  `mutateFile`, `mutateDocToFile`, `layoutFile`, `checkFile` and the content
  repository lookup (`src/node/repo.ts`: `findContentRepo`, `contentModelIds`,
  `contentRepoOf`, `resolveFileProfile`). Only `src/node/` and `src/cli.ts`
  may use Node; `tools/iso/check.mjs` in the gate fails otherwise.
  `src/api.ts`: `applyToXml(xml, ops, opts)` -> `{ xml, unchanged, result }`,
  `newXml`, `layoutXml` (= `bpmn layout`), `validateXml`, `viewXml` /
  `showXml`, `metricsXml`, `findXml`, `extensionsXml`; ops go through
  `parseOps` like `apply`; options include `profile`, `contentRepo`,
  `validators` and `file`. `mutateDoc` never writes (`out`, `dryRun`,
  `backup`, `mustNotExist` are node options); `layoutDoc` / `checkDoc` are
  the `layout` / `validate` commands on a `Doc`. What a command reports is
  `src/report.ts` (CLI and API alike). Layout debug lines: `src/debug.ts`
  (`setLayoutDebug`, `debug` option; the CLI maps `BPMN_LAYOUT_DEBUG`). The
  Camunda 7 descriptor is inlined (`src/platform/camunda-descriptor.ts`,
  `tools/gen-camunda-descriptor.mjs`; a test fails while it is stale);
  bpmn-auto-layout is imported on first use. `npm run build` also ships the
  type shims (`tools/build-types.mjs`); `moddle` is a direct dependency.
- **Text-preserving writes** (roundtrip package, #30, #31, #44–#47).
  `src/preserve.ts` (reader with positions: `src/xmltext.ts`) compares the
  file, bpmn-moddle's serialisation of the model as read and of the changed
  model: elements whose serialisation did not change keep their original
  text; changed ones keep their start tag or attribute order, new ones get
  the file's indentation, line breaks and `/>` style, CDATA stays CDATA. The
  result must read back as exactly the changed model, else it falls back to
  the plain serialisation with a note (a DOCTYPE and a forced lossy import
  always do). `src/mirror.ts`: incoming / outgoing lists are complete in
  memory (`Doc.fromXml` records them as read in `doc.source.mirror`) and
  written the file's way. Comments next to removed elements are reported as
  dropped. `MutationResult.unchanged`; `Doc.source` (`DocSource`);
  `preserveText` exported; `tools/roundtrip.mjs` (`npm run roundtrip`).
- **Edits follow the file** (conventions package, #32, #43, #47, #48 partly,
  #55, #56). `src/idstyle.ts` learns a document's id style once
  (`Doc.idStyle`, `Doc.allocateId`): prefixes per kind / family / type name,
  pascal / camel / snake / Pascal_Snake / modeler-hash / numbered bodies, flow
  forms (`Flow_0k3x9qa`, `Flow_12`, `flow_aToB`, `Flow_<from>_<to>`); flows
  and unnamed elements are hashed from stable inputs (files that number
  their flows keep numbering); umlauts become ae / oe / ue / ss. A full redraw
  keeps every DI, plane and diagram id (`diagram/write.ts` rememberDiIds /
  restoreDiIds inside `layoutModel`, both engines). design-iq stickies
  (`bpmiq:sticky`) follow their nearest flow node (`src/diagram/stickies.ts`,
  `layout.stickies`). Generated ids are not guessable: `apply` batches pass
  explicit ids for back references. (Step 3 replaced the hashes with
  speaking ids and added batch aliases, see above.)
- **Validator hook, design profile, decision link** (validation package,
  #27, #29). `src/validators.ts`: `validators` (functions `(xml, ctx) =>
  findings` or `{ name, validate }`, design-iq's `Finding` accepted) run on
  the document before the ops and on the final text; introduced errors block
  (`E_VALIDATION`, each finding with `validator`), old ones are
  `W_PREEXISTING_ERROR` (followed through renames), introduced warnings are
  reported, a throwing validator is `E_VALIDATOR_FAILED`.
  `src/platform/design.ts`: design-iq's save-gate rules (`E_DESIGN_*`,
  `W_DESIGN_*`); `--profile auto|design|none`; `auto` runs it for the models
  of a design-iq content repository (a `bpmiq.yml` above the file naming a
  models folder that contains it; in memory: when `contentRepo` is given).
  `src/platform/repo.ts` decides (browser-safe), `src/node/repo.ts` looks the
  repository up. `src/ops/decision.ts`: `set <id> calledDecision=<d>` in the
  file's spelling (design: unprefixed, C7: `camunda:decisionRef`, C8:
  `zeebe:calledDecision`).

**Verifier round** (after the integration; table in
[docs/audit-2026-10.md](docs/audit-2026-10.md#verifier-round-2026-10-09)):
`E_DESIGN_NAMESPACE` runs design-iq's namespace check on the raw text
(text, CDATA, comments and attribute values that look like `<p:name` or
` p:name="` count; a documentation `Set app:mode="prod"` is refused like
design-iq refuses it); a full redraw gives id-less elements it draws an id
in the file's style first (`src/diagram/drawn-ids.ts`; never
`bpmnElement="undefined"`); the id style learns ids without prefix
(`reviewOrder`), flows numbered without separator (`flow5`) and
`Flow_<scope>_<A>To<B>`; every write is UTF-8 and a changed result declares
UTF-8, the node layer reads a file in its declared encoding
(`src/encoding.ts`, `decodeXmlBytes`); the design profile counts flows per
id, checks every collaboration, reports an attribute written twice
(`E_DESIGN_XML`), and an id reference with whitespace around it resolves at
import (model.ts); in a process with two lane sets the profile stays
stricter than design-iq (documented); `camunda-bpmn-moddle` is a
development dependency.

**Integration decisions** (`step2/integration`): the core API runs the
roundtrip post-pass and the validators (they see the post-pass result, their
baseline is the text as read); skipping an unchanged in-place write and the
`bpmiq.yml` lookup moved to the node layer (the core takes `contentRepo` and
`file`; the node layer fills them for the file it writes, the `--out` target
included); #47 was fixed by two packages and the conventions version
(inside `layoutModel`) is kept, `src/diagram/keep-ids.ts` dropped; stickies
move before the text step, so only the moved sticky elements change; the
`unchanged`, `forced` and validator lines and the `profile` / `validators`
keys of `validate --json` live in the shared report.

Tests: `test/api.test.ts`, `test/isomorphic.test.ts`,
`test/node-files.test.ts` (encodings too), `test/drawn-ids.test.ts`, `test/roundtrip.test.ts` (fixtures
`test/fixtures/roundtrip/`), `test/conventions-ids.test.ts`,
`test/conventions-di.test.ts`, `test/conventions-stickies.test.ts`,
`test/design-profile.test.ts` (opt-in against design-iq's validator with
`BPMN_DESIGN_IQ_VALIDATOR`), `test/validators.test.ts`,
`test/decision-link.test.ts`, and `test/step2-integration.test.ts` (the
packages together).

Evidence on the integrated build (private corpora used locally, outside the
repository; counts only):

- **Gate**: 1,318 tests + 1 opt-in (972 before step 2), isomorphism check,
  layout regression 115 files score 444 (budget 444), fuzz 12 x 15: 0
  errors (2 warnings of open bugs #61 and `route`, the same with the package
  builds).
- **Roundtrip** (265 real files the CLI accepts, the audit's targets, all
  with a diagram): no-op byte-identical 262 in layout auto (the rest: the
  layout completes missing DI; a file without a diagram, 22 of the 289 real
  files the CLI accepts, is drawn on any write) and 265 with `--no-layout` (0.2.0: 40 / 42; PR #218: 169); a rename
  changes 2 lines (median, p90), region median 0 %; an insert rewrites a
  region of 77 % (median; 0.2.0: 97 %, PR #218: 86 %). Every output of 12
  edit types on 396 files equals the roundtrip package's byte for byte except
  where the id style names a new element differently. In memory
  (`applyToXml`) a no-op is `unchanged` for 260 / 263 real files (auto) and
  263 / 263 (`layout: false`).
- **Id style** (291 real files): new task ids in the file's style 264 / 270
  (0.2.0: 4), flows 226 / 226 (0.2.0: 5), a full redraw keeps 8,345 / 8,345
  DI ids, 9 / 225 file pairs share a new id (0.2.0: 225 / 225; all in files
  that number their flows, three of them without separator).
- **Design profile** vs design-iq's validator (394 files): 0 disagreements
  (65 refused, 328 accepted; 540 / 540 findings matched); of 2,231 probe edits
  the 1,117 written add no design-iq error and the 1,114 refused would.
- **Browser**: the bundle in a vm context without Node globals equals Node in
  3,491 / 3,491 calls on 394 files; 716 / 224 KB minified / gzip for the
  whole entry, 594 / 186 KB for `applyToXml` alone (+82 KB bpmn-auto-layout on
  demand).
- **Camunda 7** (Camunda 7.24.0, CIB seven 2.2.0, Operaton 2.1.5): the
  218-file battery (8 edit types, deploy before / after) 0 regressions, 0
  unexpected camunda changes; the sweep of 4,100 edits 0 regressions and
  every verdict as with 0.2.0; the chained session 0 regressions; the
  follow-up battery 202 / 202 edits deploy; the execution scenarios 65 / 65;
  the live-engine tests 804 / 804. One file (a data object after the flow
  elements, refused by Camunda 7 and Operaton) is no longer repaired as a
  side effect of an edit, since a write keeps the element order.

Still open from step 2: in layout `auto` a no-op is still written when the
layout completes missing DI (3 of the audit's 265 targets) or draws a file
without a diagram (every such file: 22 of the 289 real files the CLI
accepts, 13 of them with a node to rename; 16 of 278 files with a rename
target in all; audit P3: skip the layout when the model did not change); an insert
rewrites one text region of about 77 % of the file because it changes the
process and the DI section (a host wanting fewer conflicts needs several
regions per save); a write keeps the file's element order, so it no longer
repairs an element in a place the BPMN XSD does not allow (0.2 rewrote such a
file in bpmn-moddle's order; 1 of 218 real Camunda 7 files, refused by the
engines before and after an edit); a spliced or bridged flow keeps its id
(#48) and files that number their flows can still collide across branches (9
of 225 file pairs) (both resolved by step 3's speaking ids); in a process with two lane sets the design profile checks
the lanes design-iq does not read (stricter, documented; moot since the design profile was removed with #35); a sticky moves by its node's centre shift only; nested lanes
(`set lane=` writes the child lane only, design-iq reads top-level lanes) and
lane inheritance of a node placed next to a node in no lane; design-iq's
degree rules make compensation handlers, link events and ad-hoc content
unsavable there (the design profile reported them; removed with #35); host validators only through the library, not the CLI;
`mutateDoc` still takes typed ops unchecked (#49; `applyToXml` checks them);
bundle size (`applyToXml` 594 / 186 KB minified / gzip; ops, diagram and the
Camunda 7 profile are the largest parts: a lazy profile or a slimmer build
would be the next lever); design-iq's code conventions (audit R17: `.ts`
import specifiers, `erasableSyntaxOnly`, `node --test`) are not addressed.

## What the Camunda 7 follow-ups changed (2026-10-09, before step 2)

An independent verifier re-checked the Camunda 7 step on the three engines
and reported 15 follow-ups plus profile noise; all are fixed, together with
seven more found while integrating. Table with status and engine evidence:
[docs/audit-2026-10.md](docs/audit-2026-10.md#c7-follow-ups-2026-10-09-verifier-round).

- **Profile** (`src/platform/c7.ts`): new deploy rules
  `W_C7_DEPLOY_START_EVENT`, `W_C7_DEPLOY_LINK`, `W_C7_DEPLOY_SCHEMA`
  (attributes BPMN does not define, anywhere in the file), subscriptions
  grouped by the engine's scope, compensation `activityRef` scope, timeout
  listener id, field values; runtime `W_C7_EMPTY_CONDITION`,
  `W_C7_MULTIPLE_EVENT_DEFINITIONS` and wrong-side event-definition settings
  (`W_C7_MISPLACED_*`). Two false deploy findings removed (script-resource
  conditions, `camunda:type="shell"`). Of several event definitions the
  engines act on one and do not parse the others (`actingOrder`,
  engine-checked per event type): the deploy rules look at that one only.
  Hints rebuild one repeatable extension element by its selector instead of
  `--replace`, and use `definition[<n>].` where `definition.` is ambiguous.
- **One platform detector** (`detect.ts detectPlatformOf`) behind `validate`
  and `Doc.platform()`; an explicit `MutationOptions.platform` reaches the
  ops (`Doc.platformChoice`). Operaton's own namespace is part of the Camunda
  7 family everywhere: `isC7Uri` / `C7_URIS` / `OPERATON_URI` in
  `descriptor.ts`; `ext` applies its structure rules by local name with
  operaton containers (`ruleName` / `inFamily` in `ops/ext.ts`), `set`,
  rename, retype and resource conditions accept `operaton:`, a new process of
  an Operaton file gets `operaton:historyTimeToLive`, and the profile reads
  `operaton:*` first like Operaton (`"operaton": true`).
- **Operations**: `definition[<n>].` / `definition[<trigger>].` selectors
  (`E_AMBIGUOUS_NESTED` for a plain `definition.` on several definitions),
  `E_CROSS_SCOPE` for `activityRef`, an empty condition is refused, keyed
  `ext add` replacement reports what it drops with the `--xml` that keeps it,
  multi-line bodies print line by line, `"type": "loop.0"` in ops JSON, the
  event-gateway rule per file (engines' rule for Camunda 7, BPMN 2.0
  otherwise; explicit edges warn), duplicate single elements are a lossy
  import, `set <id> <attr>=` removes an attribute BPMN does not define, and a
  write reports a retype's stale camunda content once (through the profile).
- **Output**: `validate` counts import warnings (`--strict` fails on them),
  says "no Camunda 8 engine rules yet" for c8 files, and a boundary event on
  a compensation handler is reported once (`E_INVALID_HOST`).
- **Docs**: catalogue entries for `E_AMBIGUOUS_NESTED` and the five new
  `W_C7_*` codes (and the changed ones), README sections (set, remove,
  retype, ext, validate, set keys, Camunda 7, ops JSON, limitations), the
  guide's Camunda 7 recipe, `bpmn kinds --json` -> `nestedSelectors`.

A second verifier round fixed two regressions and two hint / precision
issues ([table](docs/audit-2026-10.md#c7-follow-ups-second-verifier-round-2026-10-09)):
the BPMN schema rules on event definitions (`checkSchemaEventDefinitions`:
conditional without condition, link without name, timer with two time
elements) run on every definition of the file, also one the engines ignore
and non-executable processes; nested extension hints address the flow node
(`ext remove <file> Event_Wait definition.0`, never the definition's own
id); start events follow the engines (an empty process / embedded
sub-process is `W_C7_DEPLOY_START_EVENT`, a transaction without start is
runtime `W_C7_TRANSACTION_NO_START`, a connected ad-hoc sub-process is
`W_C7_DEPLOY_AD_HOC_SUBPROCESS`, ad-hoc content is skipped); the second-start
hint never moves a flow into a node the kept start reaches
(`extraStartHint`). Tests: `test/c7-followups-verify.test.ts`.

Tests: `test/c7-followups-profile.test.ts`, `test/c7-followups-ops.test.ts`,
`test/c7-followups-integration.test.ts`, `test/c7-followups-verify.test.ts` (live engines opt-in with
`BPMN_C7_ENGINES` like `c7-profile`). Engine evidence (outside the
repository): 145 / 145 follow-up repro checks, the step's suites unchanged
on the integrated build (108 / 108 with three checks following the new
contract, 39 / 39, 65 / 65, extension scenarios identical), profile precision
on 218 real files 0 false positives (14 / 15 refused files found) and 5,860 /
5,860 derived files, real-file battery 202 / 202 edits deploy.

## What the Camunda 7 step changed (2026-10-09)

A second audit checked Camunda 7 support (Camunda 7.24.0, CIB seven 2.2.0,
Operaton 2.1.5; 218 real C7 / CIB seven files from private corpora). Camunda
content was preserved perfectly, but treated as untyped; 18 findings, all
fixed now. The table with each finding, its fix and the engine evidence is in
[docs/audit-2026-10.md](docs/audit-2026-10.md#camunda-7-audit-2026-10-09).

- **Descriptor as data** (`src/platform/descriptor.ts`): reads
  `camunda-bpmn-moddle`'s `camunda.json` (pinned 8.0.1; since step 2
  inlined, the package a development dependency) to know which camunda
  attributes and extension elements belong where.
  It is never registered with bpmn-moddle: camunda content stays generic and
  the serialisation is byte-stable. Two `allowedIn` lists are corrected to what
  the engines accept.
- **`new --target camunda7`** writes `camunda:historyTimeToLive="180"` and
  `modeler:executionPlatformVersion="7.24.0"` like the Modeler (the engines
  refuse an executable process without TTL); a new pool's process gets the TTL
  (`Doc.initProcess`). Unknown targets fail with `E_USAGE`.
- **Nested keys** (`src/ops/set.ts`): `definition.<key>`, `loop.<key>`,
  `condition.<key>` address the event definition, the loop characteristics and
  the condition expression; a camunda attribute that belongs there is refused
  on the parent (`E_WRONG_HOST`, the hint names the key), a missing nested
  element is `E_NO_NESTED_ELEMENT`. Conditions are changed in place and report
  a dropped script resource / language; loop changes report dropped vendor
  content; renames re-point `camunda:errorEventDefinition errorRef`;
  send / receive tasks take `message=`; camunda Boolean attributes are written
  as exactly `true` / `false`. `bpmn kinds` lists the nested keys
  ("NESTED KEYS", `kinds --json` -> `nestedKeys`).
- **`ext` structure** (`src/ops/ext.ts`): child types are filed into their
  container, single-instance containers merged (`E_DUPLICATE_EXTENSION` on a
  conflict), keyed items replaced, paths reach nested containers, `ext remove`
  takes selectors (`'camunda:inputParameter[name=x]'`; `E_AMBIGUOUS_EXTENSION`),
  `--xml` accepts `bpmn:` children inside vendor elements and must match the
  positional type, `ext add` on `bpmn:definitions` is `E_WRONG_KIND`, content
  the engines would not read is `W_MISPLACED_EXTENSION`. A `definition.` /
  `loop.` / `condition.` prefix (or op `slot`) addresses the extension
  elements of a nested element (`loop.camunda:failedJobRetryTimeCycle`).
  `ext list` and `show <id>` print extension content as an indented tree.
- **Engine rules in the ops**: bridges next to an event-based gateway that the
  engines refuse are `E_INVALID_BRIDGE` (remove, move, move --in); a boundary
  event on a compensation handler is `E_INVALID_HOST` (add / move --on, and a
  structural check in `validate.ts`, so `set isForCompensation=true` on a host
  with boundary events is blocked); `connect` warns `W_DUPLICATE_FLOW`;
  `retype` names camunda content the new kind cannot use
  (`W_PROPERTY_INAPPLICABLE`).
- **Views**: `show` prints vendor values (nested ones under their set keys,
  process- and flow-level content, `xN` counts), `find` matches vendor values
  and prints the match.
- **Camunda 7 profile** (`src/platform/{detect,c7,profile,finding}.ts`):
  `validate` detects the platform (`--platform auto|c7|c8|none`) and runs 33
  rules (`W_C7_DEPLOY_*` = the engines refuse the file; runtime and practice
  findings), each with a `severity` and a hint naming the fixing command.
  Every write reports only the profile findings it introduced
  (`validation.platform.added/resolved`). Library: `validateDoc(doc,
  { platform })`, `runProfile`, `detectPlatform`, `MutationOptions.platform`.
- **Docs**: README "Camunda 7" section with a worked example (run on all three
  engines), the guide's CAMUNDA 7 recipe, every new code in the error
  catalogue (the catalogue test now also sees codes with digits, `W_C7_*`).

Tests: `test/c7-semantic.test.ts`, `test/c7-ext-structure.test.ts`,
`test/c7-profile.test.ts` (82 models with their engine verdict; live engines
opt-in with `BPMN_C7_ENGINES`, see docs/testing.md),
`test/c7-integration.test.ts`; all synthetic. Engine evidence (outside the
repository): every finding's repro re-run on the integrated build (108 / 108
checks), the real-file battery (same numbers as before, 0 regressions, 0
unexpected camunda changes; the 37 former sweep regressions are refused now),
the execution scenarios (65 / 65, including what the old CLI could not
express).

## What step 1 changed

All seven high-severity bugs and twelve medium ones are fixed (17 fully, 2
partly; 58 remain open). Each fix has a regression test that fails on the
code before it: `test/step1-semantic.test.ts`, `test/step1-diagram.test.ts`,
`test/step1-engine.test.ts`, `test/step1-gate.test.ts`, fixtures in
`test/fixtures/step1/` and `test/fixtures/gate/` (all synthetic).

**Semantic layer and pipeline** (`src/model.ts`, `document.ts`,
`validate.ts`, `pipeline.ts`, `ops/`):

- Vendor extension ids (`camunda:formField id`) are not BPMN ids: no false
  `E_DUPLICATE_ID`; `show` / `set` / `remove` on such an id give `E_NOT_FOUND`
  naming the vendor element and its owner.
- Changing only the details of an event's trigger updates the event
  definition in place (id and vendor attributes stay); a trigger kind change
  reports dropped vendor content (`W_PROPERTY_DROPPED`). A new timer value is
  classified again (`R/...` -> cycle).
- `mutateDoc` refuses lossy imports like the CLI (`E_IMPORT_LOSSY`, `assertLossless`).
- Only validation errors a change introduces block the write; errors the file
  already had become `W_PREEXISTING_ERROR` (complexGateway files, plain starts
  in event sub-processes, black-box-only collaborations are editable now).
- `retype` of a sub-process with content to a task / call activity needs
  `--force` (`E_WOULD_DROP_CONTENT` lists the ids); complexGateway can be
  retyped to a supported gateway.
- Associations on a bridged flow move to the bridging flow (no more
  `E_DANGLING_REF` on remove / move next to an annotated flow); a removed flow
  is also dropped from stale `incoming` / `outgoing` entries of other nodes.

**Incremental layout, format ops, metrics** (`src/diagram/`):

- "Frame mode" in the space tool (`space.ts`): a growing sub-process makes
  room inside itself, ancestors grow only when something sticks out, and room
  is made one level further out instead of growing over a foreign shape. Used
  by placement, fitInFrame, name growth, labels and expand.
- `fitInFrame` skips an ancestor that does not hold the inner frame's centre
  (a drawing with an event sub-process outside its member lane).
- Unconnected nodes go below their own container's content, not below the
  lowest label of the plane.
- `place` / `align` refuse (`E_NO_ROOM`) instead of pushing the reference's
  pool / lane / sub-process away, and never write a new overlap: a reference
  the neighbours would be pushed onto moves along when the request still
  holds, else `E_NO_ROOM` (`ops.ts` makeRoom, `newOverlaps`; fixes #11).
- Metrics: new hard kinds `frameIntrusion`, `frameOverlap`, `degenerateEdge`
  (weight 10, not in the harness: `EXTRA_KEYS` / `HARNESS_KEYS` in
  `metrics.ts`), and a real segment-rectangle test for `through` (also in the
  harness and in `geom.segmentHits`).
- No connection is written with fewer than two distinct waypoints.

**Full engine** (`src/layout/`):

- Lane bands follow the content after loop routing (`growFirstLane`).
- Pools are ordered by the message-flow cost (fewest cut shapes, declared
  order on ties; `messages.ts poolOrder`); message-flow legs jog into free
  column gaps; notes on boundary events avoid sibling events.
- Event sub-processes go below the content of their own lane and honour
  collapse; collaboration-level annotations get DI (`notes.ts`); cross-scope
  associations are drawn when both ends are on one plane, else reported.
- Side effect: a drawing made by the previous engine version is no longer
  recognised as engine-owned on laned and collaboration models, so `auto`
  keeps it (incremental) instead of redrawing it.

**Tooling** (new in the repository): `tools/bench` (edit benchmark with a
baseline arm), `tools/fuzz` (seeded random walks with invariants and ddmin
minimisation), `test/fuzz.test.ts` (fixed walks in-process),
`tools/bench/regress-gate.mjs` with the budget, `npm run gate`,
`test/repo-hygiene.test.ts` (no local paths or control characters in the
repository), docs/testing.md, docs/audit-2026-10.md.

## Evidence

Numbers from the gate on 2026-10-08; baseline = the build before step 1, both
measured with the new metrics. The real models come from private corpora
plugged in through `BPMN_BENCH_CORPUS` / `BPMN_FUZZ_CORPUS`; they never enter
the repository.

- **Layout regression**: the original 111 scenarios 472 -> 402 (464 for the
  old engine with the corrected `through` test), 5 files better, none worse;
  4 new scenarios 42 (old engine 245); total 115 files SCORE 444.
- **Benchmark**, auto mode, edits E1–E6 pooled (new / baseline): on the 115
  scenarios 0 / 3 runs add a hard defect, median share of other nodes moved
  11 % / 12 %, a full layout leaves 3 / 33 hard defects; on the scenarios
  redrawn by the previous engine 5 / 11 runs (5 / 20 defects); on 60
  modeler-drawn models 100 % / 95 % of the runs succeed without `--force`,
  0 / 0 runs add a hard defect, a full layout leaves 18 / 46 hard defects.
  Semantic success 100 % in every corpus and arm.
- **Fuzzing**, 2 x 200 walks x 40 steps (scenarios, perturbed variants,
  modeler models; auto / incremental): steps adding a hard defect 0.14 % /
  0.70 %, further steps adding only a frame defect 0.02 % / 0.41 % (the audit
  had 0.64 % + 0.77 %); `E_VALIDATION` refusals 14 / 216. Every hard step of
  the new build was replayed on the same input with the baseline, which adds
  the same defects: none is a regression.
- **Performance** unchanged: an insert on 56 modeler models, median 79 ms
  (77 ms before).
- Earlier evidence for the incremental layout (blind visual judging of
  rendered samples): on edits of hand-drawn models this CLI ranked first in
  43 of 52 judgments against the old full redraw and the PR #218 tool; for
  full redraws the clean engine was judged the best global layouter (3.77 vs
  bpmn-auto-layout 3.56 vs PR #218 2.96).

## How to work on it

```
npm run gate                                   # before every hand-over
npx vitest run test/<file>.test.ts             # one layer
node tools/layout-regress.mjs --save /tmp/base.json; ...; node tools/layout-regress.mjs --compare /tmp/base.json
BPMN_LAYOUT_DEBUG=1 node bin/bpmn.js add ...   # placement candidates, reroute reasons, [strip] lines (library: setLayoutDebug / debug option)
npm run check:iso                              # after a build: the core still bundles for the browser; the profile rules load on demand and import nothing the entry loads; sizes within tools/iso/budget.json (--table: the README table)
npm run roundtrip [<dir>]                      # after a build: how much of a file a no-op, a rename, an insert rewrite
node bin/bpmn.js metrics <file>                # problems with ids
node bin/bpmn.js render <file> --problems -o /tmp/png/x.png   # look at the result, the problems numbered (no browser; --around <id> / --path / --scope / ids crop, --tiles, --plane <id>)
node bin/bpmn.js add <file> ... --render /tmp/png/after.png    # any mutating command: its result with what changed in a halo
tools/render.sh /tmp/png <files>               # the same with real bpmn-js (the reference for reviews)
BASELINE_BIN=<old>/bin/bpmn.js npm run bench   # benchmark against an older build
npm run fuzz                                   # random walks; see docs/testing.md
BPMN_C7_ENGINES=<rest>[,<rest>] npx vitest run --no-file-parallelism test/c7-*.test.ts   # Camunda 7 profile vs live engines
BPMN_C8_ENGINE=<v2 root> npx vitest run test/c8-profile.test.ts test/c8-ops.test.ts      # Camunda 8 profile vs a live engine
node tools/gen-camunda-descriptor.mjs          # after updating camunda-bpmn-moddle or zeebe-bpmn-moddle
```

Rule of thumb: render and look at what you touched; the metrics do not see
everything (labels, aesthetics). Lower the
regression budget when the engine improves; raise it only with a reviewed
reason. Keep fixtures synthetic: rebuild a private model's defect with a
handful of elements (the fuzzer's minimiser tells you which ops matter).

## What to build next, most valuable first

(Camunda 7 / 8 leftovers, smaller than the items below: the XSD element
order in the C7 profile, the `activiti:` fallback namespace of Camunda 7 /
CIB seven, a FEEL parser for the Camunda 8 profile (today: the common slips
only), checking linked forms / called processes / decisions against a
deployment. See the "Still open" lists of the C7 audit and of step 3.)

1. **Issue #18 after stage B**: what stage B left (see "Incremental layout
   of edits to hand-drawn models, stage B" and its fixes): a `connect` to
   the sibling branch's node that crosses, the convention of exception
   paths above their host, a grown host sliding its boundary events, an
   opened row that cannot help (a line descending through it), room at the
   top of a pool moving its whole content. The `edit-hand-drawn-model` eval
   passed (WITH 1.00, no DI edited by hand).
2. **The remaining layout bugs the fuzzer still hits**: data objects and
   annotations placed onto shapes or into a foreign sub-process, boundary
   events added on a host inside a sub-process intruding into another
   frame, `place` / `align` pushing a
   flow through a shape, `route` and expand / collapse through shapes,
   associations on the wrong plane after a collapse (#15), data
   associations not rerouted after `split` / `move --lane`, flows left
   detached from gateways (#16).
3. **CI**: run `npm run gate` on every change; run the bench and a longer fuzz
   campaign on the private corpus on a schedule, outside the repository.
4. **An MCP server.** Thin wrapper over show/find/add/connect/apply/validate
   plus `show --layout`, `metrics` and the format ops. Removes the shell
   quoting trap (`${...}` in conditions).
5. **Embedding in design-iq, the rest** (audit P1 and the step 2 leftovers
   above): skip the layout in `auto` mode when the model did not change (a
   no-op that completes missing DI is still written); hunks or several text
   regions per save for inserts; lane conventions for nested lanes (a node
   in a child lane also listed by the parent lanes, as bpmn-js and design-iq
   expect; today `set lane=` writes the child lane only and `E_LANE_CONFLICT`
   reports bpmn-js files that list both) and lane inheritance for nodes
   placed next to a node in no lane; the bundle size if design-iq needs it
   (the profile rules load on demand since #13; the next lever is splitting
   `guide.ts`, see "Profile rules on demand").
6. **Let the agent see the result**: issue #12. Stages 1 (the renderer,
   `bpmn render`), 2 (crops, halos, numbered problems, tiles, `--render`)
   and 3 (the plugin skill's look step and its eval case) are done, see
   "`bpmn render`, stage 3", "stage 2" and "stage 1"; the verification's
   side-by-side with `tools/render.sh` (35 files) and its fixes are in
   "`bpmn render`, fixes after the verification". Open: the whole eval suite
   on the new skill, and offering `renderSvg` to design-iq (out of scope
   here).
7. **Persistent layout intent**: pins / "main path" hints in the DI that the
   clean engine honours, so formatting survives a full redraw.

## Known residuals

- Validators: the CLI cannot pass host validators (only the library can);
  a host validator that needs repository context (design-iq's `checkModel`
  with `modelIds`) gets it from the host. bpmn-cli has no copy of
  design-iq's rules since #35: in a content repository, run design-iq's own
  validator after edits. A new node next to a node in no lane inherits no
  lane (`--lane` in the same command).

- Camunda 7: an Operaton-namespace file is checked the way Operaton reads it
  (operaton first, camunda as the fallback), so `operaton:historyTimeToLive`
  satisfies the TTL rule although Camunda 7 and CIB seven ignore it; the
  platform line says so. The form-field type rule reports custom form types;
  `activiti:` is not modelled; a text-less field child cannot be told apart
  from a blank one; message start events of two executable pools with one
  message name are not reported (the engines refuse them).

- Camunda 8: FEEL syntax is checked, not its meaning (unknown functions,
  types); variables are not followed (an input mapping's local variable read by a later gateway passes
  the profile and fails at run time); `zeebe:publishMessage` is reported as
  accepted but not run by 8.9; an event-based gateway of a file without
  `<bpmn:outgoing>` lists is reported but cannot be repaired with a command;
  forms, called processes and decisions are not checked against a
  deployment. The old examples' `PT2D` duration is no ISO 8601 duration:
  Camunda 8 refuses it at deploy; Camunda 7.24, CIB seven 2.2 and Operaton
  2.1 deploy it, and every instance fails when it reaches the timer
  (ENGINE-09027, checked on all three); the docs say `P2D` now, the Camunda
  7 profile does not check timer values yet (a follow-up for it).

- See the open bugs in docs/audit-2026-10.md and its "Open findings from the
  gate".
- `labelOnLine` and `msgThroughPool` still use a segment's bounding box, so
  diagonal associations produce false positives (in the metrics and the
  harness alike).
- A drawing of the previous engine version with event sub-processes outside
  their lanes stays as it is in incremental edits; `bpmn layout` moves them.
- `tidy` considers shapes, not labels. Frames grow on demand and shrink only
  with `compact` / `space --by -<amount>`, which close strips (rows / columns
  empty across a pool or lane band): content spread over many rows shrinks
  less than with a full redraw; pools side by side are not compacted
  against each other.
- Known residuals of the clean engine: complexGateway and choreographies
  unsupported, groups cannot be created (a full redraw draws an existing
  group box again around its members; members of one connected flow and
  two overlapping groups are not kept apart, and an annotation's
  association to a group is not drawn, see "Group boxes over a full
  redraw"); cross-scope
  associations are straight lines; boundary-handler paths can run through
  nested expanded sub-processes (#19); `order <collaboration> <pools...>` sets
  the pool order of a kept drawing, a full redraw orders pools by its own
  rule (message-flow cost, declared order on ties).
