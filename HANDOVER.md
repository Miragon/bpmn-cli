# Handover, 2026-10-09 (after step 1 of the audit fixes, the Camunda 7 step and its follow-ups)

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
npm run gate            # build, 919 tests, layout-regression budget, short fuzz campaign
npm run typecheck
node tools/layout-regress.mjs   # FILES 115 SCORE 444 (budget in tools/bench/regress-budget.json)
node bin/bpmn.js guide  # the cheat sheet an agent reads first
```

An audit in October 2026 (eight streams, about 60,000 mutations) confirmed 77
bugs; [docs/audit-2026-10.md](docs/audit-2026-10.md) has the table with the
current status of each, and [docs/testing.md](docs/testing.md) how to run every
test layer, the benchmark and the fuzzer.

## What the Camunda 7 follow-ups changed (2026-10-09, after the step below)

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
  `camunda-bpmn-moddle`'s `camunda.json` (new runtime dependency, pinned
  8.0.1) to know which camunda attributes and extension elements belong where.
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

(Camunda 7 leftovers, smaller than the items below: a Camunda 8 profile
(`W_C8_*`, mirroring `W_C7_FOREIGN_CONTENT`), the XSD element order in the C7
profile, the `activiti:` fallback namespace of Camunda 7 / CIB seven. See the
"Still open after the follow-ups" list of the C7 audit.)

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

- Camunda 7: an Operaton-namespace file is checked the way Operaton reads it
  (operaton first, camunda as the fallback), so `operaton:historyTimeToLive`
  satisfies the TTL rule although Camunda 7 and CIB seven ignore it; the
  platform line says so. The form-field type rule reports custom form types;
  `activiti:` is not modelled; a text-less field child cannot be told apart
  from a blank one; message start events of two executable pools with one
  message name are not reported (the engines refuse them).

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
