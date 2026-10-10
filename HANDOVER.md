# Handover, 2026-10-10 (after step 1 of the audit fixes, the Camunda 7 step and its follow-ups, step 2: bpmn-cli as design-iq's editing engine, and step 3: the Camunda 8 profile)

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
host validators and a copy of design-iq's save gate inside the transaction.
`validate` (and every write) runs the engine profile of the file's platform:
Camunda 7 (`W_C7_*`) or Camunda 8 (`W_C8_*`), each rule checked on the
engines. New ids follow the file's id style. A hand-made diagram is kept (new elements
are placed locally, like the modeler's space tool), a new file or an
engine-owned drawing is redrawn by the built-in engine, and the agent formats
the picture with commands that name elements (`place`, `align`, `color`,
`label`, `route`, `space`, `tidy`, lane `order`). The format-command idea
comes from Miragon/design-iq PR #218 (`@bpmiq/bpmn-edit`, ADR 0008); no code
was copied, the concepts were re-implemented here.

```
npm install && npm run build
npm run gate            # build, 1493 tests (+159 opt-in), isomorphism check, layout-regression budget, short fuzz campaign
npm run typecheck
node tools/layout-regress.mjs   # FILES 115 SCORE 444 (budget in tools/bench/regress-budget.json)
node bin/bpmn.js guide  # the cheat sheet an agent reads first
```

An audit in October 2026 (eight streams, about 60,000 mutations) confirmed 77
bugs; [docs/audit-2026-10.md](docs/audit-2026-10.md) has the table with the
current status of each, and [docs/testing.md](docs/testing.md) how to run every
test layer, the benchmark and the fuzzer.

## What step 3 changed (2026-10-10): the Camunda 8 profile

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
  derived from its event (`src/ops/platform.ts`: Camunda 8.9 refuses
  conditional, compensation and link catch definitions without one); `ext
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

Still open from step 3: FEEL is not parsed (only the common slips); the
profile does not follow variables (an input mapping's local variable read
by a later gateway); `zeebe:publishMessage` is reported as not run by 8.9
(drop the rule when Camunda runs it); a file without `<bpmn:outgoing>`
lists cannot get them for an event-based gateway (reported, no command);
linked forms, called processes and decisions are not checked against a
deployment; the core grew by about 90 KB minified / 23 KB gzip.

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
  explicit ids for back references.
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
(#48); files that number their flows can still collide across branches (9 of
225 file pairs); in a process with two lane sets the design profile checks
the lanes design-iq does not read (stricter, documented); a sticky moves by its node's centre shift only; nested lanes
(`set lane=` writes the child lane only, design-iq reads top-level lanes) and
lane inheritance of a node placed next to a node in no lane; design-iq's
degree rules make compensation handlers, link events and ad-hoc content
unsavable there; host validators only through the library, not the CLI;
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
npm run check:iso                              # after a build: the core still bundles for the browser; sizes
npm run roundtrip [<dir>]                      # after a build: how much of a file a no-op, a rename, an insert rewrite
node bin/bpmn.js metrics <file>                # problems with ids
tools/render.sh /tmp/png <files>               # look at the result with real bpmn-js
BASELINE_BIN=<old>/bin/bpmn.js npm run bench   # benchmark against an older build
npm run fuzz                                   # random walks; see docs/testing.md
BPMN_C7_ENGINES=<rest>[,<rest>] npx vitest run --no-file-parallelism test/c7-*.test.ts   # Camunda 7 profile vs live engines
BPMN_C8_ENGINE=<v2 root> npx vitest run test/c8-profile.test.ts test/c8-ops.test.ts      # Camunda 8 profile vs a live engine
node tools/gen-camunda-descriptor.mjs          # after updating camunda-bpmn-moddle or zeebe-bpmn-moddle
```

Rule of thumb: render and look at what you touched; the metrics do not see
everything (labels, aesthetics, groups count as overlaps). Lower the
regression budget when the engine improves; raise it only with a reviewed
reason. Keep fixtures synthetic: rebuild a private model's defect with a
handful of elements (the fuzzer's minimiser tells you which ops matter).

## What to build next, most valuable first

(Camunda 7 / 8 leftovers, smaller than the items below: the XSD element
order in the C7 profile, the `activiti:` fallback namespace of Camunda 7 /
CIB seven, a FEEL parser for the Camunda 8 profile (today: the common slips
only), checking linked forms / called processes / decisions against a
deployment. See the "Still open" lists of the C7 audit and of step 3.)

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
4. **Embedding in design-iq, the rest** (audit P1 and the step 2 leftovers
   above): skip the layout in `auto` mode when the model did not change (a
   no-op that completes missing DI is still written); hunks or several text
   regions per save for inserts; lane conventions for nested lanes (a node
   in a child lane also listed by the parent lanes, as bpmn-js and design-iq
   expect; today `set lane=` writes the child lane only and `E_LANE_CONFLICT`
   reports bpmn-js files that list both) and lane inheritance for nodes
   placed next to a node in no lane; batch aliases (`as:`) so that an
   `apply` batch can refer to an element it creates without an explicit id;
   the bundle size if design-iq needs it (step 3 added about 90 KB minified
   for the Camunda 8 profile: a lazily loaded profile per platform would be
   the lever).
5. **Let the agent see the result**: a `render` command (`tools/render.sh`
   works).
6. **Persistent layout intent**: pins / "main path" hints in the DI that the
   clean engine honours, so formatting survives a full redraw.

## Known residuals

- Design profile: design-iq's flow rules are degree checks, so compensation
  handlers, link events and ad-hoc sub-process content cannot be saved there;
  the profile reports them with that explanation (BPMN allows them). A new
  node next to a node in no lane inherits no lane and is refused
  (`--lane` in the same command). The CLI cannot pass host validators (only
  the library can); a host validator that needs repository context (design-iq's
  `checkModel` with `modelIds`) gets it from the host.

- Camunda 7: an Operaton-namespace file is checked the way Operaton reads it
  (operaton first, camunda as the fallback), so `operaton:historyTimeToLive`
  satisfies the TTL rule although Camunda 7 and CIB seven ignore it; the
  platform line says so. The form-field type rule reports custom form types;
  `activiti:` is not modelled; a text-less field child cannot be told apart
  from a blank one; message start events of two executable pools with one
  message name are not reported (the engines refuse them).

- Camunda 8: FEEL is not parsed (the common slips are); variables are not
  followed (an input mapping's local variable read by a later gateway passes
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
- `tidy` considers shapes, not labels; frames never shrink after `place` /
  `space` (only a full redraw does that).
- Known residuals of the clean engine: complexGateway, choreographies and
  groups unsupported (a full redraw drops group boxes); cross-scope
  associations are straight lines; boundary-handler paths can run through
  nested expanded sub-processes (#19); no manual pool-order op.
