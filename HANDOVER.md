# Handover, 2026-10-08 (after step 1 of the audit fixes)

State of `bpmn-cli` and what to do next. Everything below is verified against
the code in this repository, not from memory.

## Where it stands

A CLI that lets an AI agent edit BPMN 2.0 models semantically. The agent names
elements by id and changes kinds, names, flows, triggers, lanes, pools,
properties and vendor extensions; it never sees or writes diagram interchange.
Every mutating command runs the same pipeline: load, apply operations,
validate, lay out, write atomically. A hand-made diagram is kept (new elements
are placed locally, like the modeler's space tool), a new file or an
engine-owned drawing is redrawn by the built-in engine, and the agent formats
the picture with commands that name elements (`place`, `align`, `color`,
`label`, `route`, `space`, `tidy`, lane `order`). The format-command idea
comes from Miragon/design-iq PR #218 (`@bpmiq/bpmn-edit`, ADR 0008); no code
was copied, the concepts were re-implemented here.

```
npm install && npm run build
npm run gate            # build, 585 tests, layout-regression budget, short fuzz campaign
npm run typecheck
node tools/layout-regress.mjs   # FILES 115 SCORE 444 (budget in tools/bench/regress-budget.json)
node bin/bpmn.js guide  # the cheat sheet an agent reads first
```

An audit in October 2026 (eight streams, about 60,000 mutations) confirmed 77
bugs; [docs/audit-2026-10.md](docs/audit-2026-10.md) has the table with the
current status of each, and [docs/testing.md](docs/testing.md) how to run every
test layer, the benchmark and the fuzzer.

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
BPMN_LAYOUT_DEBUG=1 node bin/bpmn.js add ...   # placement candidates, reroute reasons, [strip] lines
node bin/bpmn.js metrics <file>                # problems with ids
tools/render.sh /tmp/png <files>               # look at the result with real bpmn-js
BASELINE_BIN=<old>/bin/bpmn.js npm run bench   # benchmark against an older build
npm run fuzz                                   # random walks; see docs/testing.md
```

Rule of thumb: render and look at what you touched; the metrics do not see
everything (labels, aesthetics, groups count as overlaps). Lower the
regression budget when the engine improves; raise it only with a reviewed
reason. Keep fixtures synthetic: rebuild a private model's defect with a
handful of elements (the fuzzer's minimiser tells you which ops matter).

## What to build next, most valuable first

1. **The remaining layout bugs the fuzzer still hits**: data objects and
   annotations placed onto shapes or into a foreign sub-process, boundary
   events colliding with annotations or new nodes (#42, #63), `route` and
   expand / collapse through shapes, `place` stretching a nested sub-process
   (#12), associations on the wrong plane after a collapse (#15), data
   associations not rerouted after `split` / `move --lane`, flows left
   detached from gateways (#16).
2. **CI**: run `npm run gate` on every change; run the bench and a longer fuzz
   campaign on the private corpus on a schedule, outside the repository.
3. **An MCP server.** Thin wrapper over show/find/add/connect/apply/validate
   plus `show --layout`, `metrics` and the format ops. Removes the shell
   quoting trap (`${...}` in conditions).
4. **Roundtrip for embedding** (audit P1): text-preserving output and true
   no-op writes (#30, #31, #44–#47), a browser-safe core (#33), platform
   awareness (#27, #28), collision-resistant ids (#32).
5. **Let the agent see the result**: a `render` command (`tools/render.sh`
   works).
6. **Persistent layout intent**: pins / "main path" hints in the DI that the
   clean engine honours, so formatting survives a full redraw.

## Known residuals

- See the open bugs in docs/audit-2026-10.md and its "Open findings from the
  gate".
- `labelOnLine` and `msgThroughPool` still use a segment's bounding box, so
  diagonal associations produce false positives (in the metrics and the
  harness alike).
- A drawing of the previous engine version with event sub-processes outside
  their lanes stays as it is in incremental edits; `bpmn layout` moves them.
- `tidy` considers shapes, not labels; frames never shrink after `place` /
  `space` (only a full redraw does that).
- Known residuals of the clean engine: complexGateway, choreographies and
  groups unsupported (a full redraw drops group boxes); cross-scope
  associations are straight lines; boundary-handler paths can run through
  nested expanded sub-processes (#19); no manual pool-order op.
