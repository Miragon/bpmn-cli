# Migrating

## Changes from 0.2

- `mutateFile`, `checkFile` and `loadDoc` moved to `@miragon/bpmn-cli/node`;
  `Doc.load(file)` is `readDoc(file)` there.
- `mutateDoc` never writes; `out`, `dryRun`, `backup` and `mustNotExist` are
  options of the file helpers (`mutateDocToFile`, `mutateFile`).
- `layoutXml` is `bpmn layout` on a string; the former wrapper around
  bpmn-auto-layout is internal (`layoutModel(model, { engine: 'auto' })`).
- `package.json` has `exports`: only `.`, `./node` and `./package.json`
  resolve (no deep imports into `dist/`).
- A write keeps the file's text outside what it changed, and a result equal
  to the file is not written (`MutationResult.unchanged`, `written: false`;
  [What a write changes](contract.md#what-a-write-changes)).
- New ids follow the file's id style ([Ids](reference.md#ids)); since 0.3 they also
  speak (see below).
- `checkFile` / `checkDoc` return the validation profile that ran
  (`CheckResult.profile`), and `MutationOptions` / `CheckOptions` take
  `profile`, `contentRepo`, `validators` and `file`; in a design-iq content
  repository the CLI and the file helpers run the design profile by default
  (`--profile none` switches it off).
- `readXml` and the other file helpers read a file in the encoding its XML
  declaration names (0.2 read UTF-8 only); a write is UTF-8 and declares it.
- A full redraw gives an element it draws that has no id (a hand-written
  message flow, pool, process or collaboration) an id first; 0.2 wrote
  `bpmnElement="undefined"`.

## Changes from 0.3

- A mutation's result reports warnings as a delta: `warnings` is
  `{ added, resolved, preexistingCount }` (0.3: the op warnings as an array),
  and `validation` has no `warnings` (0.3: every warning of the result,
  repeated on every write); the text lists the added warnings (three or more
  of one code as one line), the resolved findings and one line counting the
  file's own (the platform profile's findings included).
  `MutationResult.validation.warnings` (`mutateDoc`) is unchanged;
  `MutationResult.delta` has the comparison.
- `--json` prints compact JSON on one line; `--pretty` indents it.
- `show` prints each node's lane (`lane=<id>`) instead of member lists in
  the `lanes:` section, and message flows as `messageFlow <id> ["name"]:
  <source> "name" -> <target> "name"`.
- New ids speak ([Ids](reference.md#ids)): names, a kind and a place for unnamed
  elements (`Gateway_AfterCheckInvoice`), the ends for flows
  (`Flow_CheckInvoiceToBookInvoice`); 0.3 gave flows and unnamed elements a
  hash (`Flow_0k3x9qa`). A flow whose id names its ends is renamed when an
  edit changes them (0.3: every existing id stayed); the result says so on
  the changed line and in `renamed` (old id -> new id). A taken id gets
  `_2` and `W_ID_SUFFIXED` for every generated id, also flows and the event
  definitions of a Camunda 8 file. A generated id has at most 64
  characters; `new --name` (or a speaking `--id`) names the definitions too
  (`Definitions_OrderHandling`; 0.3: `Definitions_1`).
- An `apply` batch refers to an element it creates by an alias (`"as":
  "$check"`, `flowAs`, `joinAs`, `refAs` for the message / error / signal /
  escalation an op creates or finds; `MutationResult.aliases` /
  `result.aliases`: alias -> final id) or by an explicit `id`; new errors
  `E_UNKNOWN_ALIAS`, `E_DUPLICATE_ALIAS`.
- `--summary` (`mutationSummary` / `renderSummary`) is new; the summary and
  the JSON of a mutation carry `aliases` and `renamed`, the summary one line
  per format op (`format`).
- `remove --with-branch` / `--bridge-all` (`E_AMBIGUOUS_BRANCH`,
  `E_AMBIGUOUS_BRIDGE`); a node added into a flow between two lanes takes
  the lane of its row (`W_LANE_INHERITED`).
- Format commands: `compact`, pool order (`order <collaborationId>
  <participantId...>`, ops JSON `pools`), the selectors `--path` /
  `--via`, `--kind`, `--branch` of place, align, color and tidy (`E_NO_MATCH`,
  `E_NOT_PARTICIPANT`), negative `space --by`; `show --layout` prints
  columns (`c0 Event_Start, c1 ...`, JSON `columns`, `gaps`); four soft
  metric kinds (`backwardFlow`, `segmentOverlap`, `labelOutsideFrame`,
  `messageLabelFar`); `layout.reshaped` / `format[].reshaped`.
- Camunda 8: `validate` and every write run the Camunda 8 profile (34
  `W_C8_*` codes; 0.3 said "no Camunda 8 engine rules yet"); `new --target
  camunda8` writes the platform version; new user tasks of a Camunda 8 file
  get `zeebe:userTask`, new event definitions an id; `set <id>
  zeebe:<attr>` for an attribute of a zeebe element is `E_WRONG_HOST`,
  except `zeebe:correlationKey`, which (like `ext add <id>
  zeebe:subscription`) goes to the message a catch event or receive task
  waits for; the profile parses FEEL; `show` prints `job=`, `form=`,
  `assignee=` ... and a message's correlation key. The core grew by about
  200 KB minified / 57 KB gzip ([Browser bundles](library.md#browser-bundles); the
  FEEL check and the schema-text rules about 23 KB / 7 KB of it).

## Changes from 0.4

- `bpmn render` and `renderSvg` (core) / `renderPng`
  (`@miragon/bpmn-cli/node`) are new: the diagram as SVG or PNG without a
  browser, with the image size, the image-token estimate and the other
  planes ([`render`](commands.md#render)); new error `E_RENDER`. The package depends on
  `@resvg/resvg-wasm` (MPL-2.0, loaded on the first PNG) and ships the
  Arimo font (OFL-1.1, `assets/fonts`). For agents: crops (`--around` with
  exactly the nodes of `show --around`, `--path`, `--scope`, ids), halos
  (`--highlight`), the layout problems numbered in the image
  (`--problems`; `locateProblems` in the library), `--tiles`, and
  `--render <file>` on every mutating command (the result with created /
  changed / moved elements and the added problems).
- The Claude Code plugin's skill looks at what it drew: after a change to
  the drawing it renders into `.bpmn-render/` of the working directory,
  reads the PNG and fixes the numbered problems with the format commands
  ([Claude Code plugin](../plugins/bpmn-cli/README.md)); a new eval case,
  `tidy-after-edit`, measures it.
- The Camunda 7 and Camunda 8 profile rules load on demand
  ([Browser bundles](library.md#browser-bundles)): `applyToXml` alone is 618.2 KB
  minified / 195.8 KB gzip in a host's bundle (0.4: 750.7 / 232.9), the
  whole entry 814.7 / 255.1 KB without the renderer, 860.7 / 271.3 KB
  with it (0.4: 945.9 / 291.7). The CLI's output is
  unchanged. Their chunks import nothing, so a host's entry module can
  still await a call at top level.
- Unchanged: `applyToXml`, `newXml`, `layoutXml`, `validateXml`,
  `mutateDoc`, `checkDoc` and the file helpers (they load the rules
  themselves).
- Migration: a caller of the synchronous `runProfile(doc)` or
  `validateDoc(doc, { platform })` that does not go through one of them
  calls `await loadProfiles()` once (or `await loadProfile('c7')` /
  `loadProfile('c8')` for one platform) before; without it they throw
  `E_PROFILE_NOT_LOADED` on a Camunda 7 / 8 document (plain BPMN and
  `platform: 'none'` need no rules). In a test suite one setup line does
  it (vitest `setupFiles`, or a top-level `await loadProfiles()`).
- New: `loadProfile(platform)` and `loadProfiles(platforms?)`; a host
  prefetches the chunk when it opens a Camunda 7 / 8 file. A chunk that
  cannot be loaded rejects the call with `E_PROFILE_LOAD` (category `io`,
  exit 4) before a result exists; a later call imports it again, but a
  browser may keep the failed fetch until the page reloads.
- `tools/iso/check.mjs` enforces size budgets (`tools/iso/budget.json`) and
  prints the on-demand chunks (`--table`: the table above).

## Changes from 0.5

- A batch that edits a hand-made drawing places its new nodes like the
  same ops sent as single commands (issue #18): a task and a decision
  spliced into a flow stay in the row also when the decision gets a new
  "no" branch or comes from `split`, a boundary path waits for the normal
  flow, and each placed node's flows are routed before the next node is
  placed. On the plugin eval's model the agent's batches give the same
  shapes as single commands and score 0 (before: 9 to 19). A new flow
  that would enter a merge backwards moves the merge after its sources
  ([Layout modes](layout.md#layout-modes)).
- `place <boundaryEventId> --side top|bottom` (op key `side`) moves a
  boundary event to the other border of its host, with its exception path
  ([Formatting without XML](layout.md#formatting-without-xml)).
- An annotation's association to a flow docks on the nearest point of the
  flow it reaches in a straight line without cutting a shape, else it is
  routed around the shapes; when the flow is rerouted, it follows.
- `E_NO_ROOM` from `place` / `align` carries the checked space-tool run that
  makes the room with the fewest layout problems (`details.ops`; as
  `details.command` when the refused op saw the file's own drawing).
- `bench` has two batch edits, E8 and E9, and `--compare` reports the runs
  adding crossings / backward flows per edit, with a budget for E8 / E9
  (`tools/bench/soft-budget.json`).
- A new branch or boundary path in a hand-made drawing crosses far fewer
  lines (issue #18, stage B): its row is chosen with the line its nodes take
  on it; when every row below crosses a line, the row right under the anchor
  is opened (bypass and loop-back lines move down with the shapes), or the
  branch goes above its anchor, a boundary path above its host with the
  event on the top border. A crossing left is repaired once more (the flow
  routed again, the branch at its next row) when that lowers the score. On
  a private corpus of real models (single commands) a boundary path adds a
  crossing in 2 % of the runs (before 23 %), a new branch at a split in 5 %
  (before 20 %), a decision spliced into a branch in 7 % (before 38 %)
  ([Layout modes](layout.md#layout-modes)). A row in an expanded sub-process keeps
  clear of the boundary events on its border (no new task on a
  transaction's cancel event). After the verification: the path of a
  boundary event on its host's top border (`place --side top`, then `add
  ... --after <event>`) runs above the host and no longer tears the
  hand-drawn row apart; a boundary event drawn by hand keeps its border; the
  top border is not taken where a line runs through the spot; the repair
  never trades a crossing with a new flow for one between two drawn lines;
  a line along a new end event is routed again; a reroute that would still
  cross is not measured (faster writes on large models).
