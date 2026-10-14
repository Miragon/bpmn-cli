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
  (`--profile none` switches it off). The validation profile is gone again
  after 0.6 (see [Changes from 0.6](#changes-from-06)).
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

## Changes from 0.6

- The design profile, bpmn-cli's copy of design-iq's save gate, is gone
  (issue #35). bpmn-cli no longer looks for a `bpmiq.yml` above a file, and
  a write in a design-iq content repository is no longer checked against
  design-iq's rules.
- The CLI option `--profile` is gone from every mutating command and from
  `validate`. It is now an unknown option (`E_USAGE`, exit 1): drop it from
  scripts.
- The library options `profile` and `contentRepo` are gone: from
  `applyToXml`, `newXml`, `layoutXml` and `validateXml` (`EditOptions`,
  `LayoutXmlOptions`, `ValidateXmlOptions`), from `MutationOptions` and
  `CheckOptions` (`mutateDoc`, `layoutDoc`, `checkDoc`) and from the file
  helpers (`mutateFile`, `mutateDocToFile`, `layoutFile`, `layoutDocToFile`,
  `checkFile`). TypeScript reports them; at runtime they are ignored, so a
  host that passed `profile: 'none'` only drops it. `file` stays: it is the
  validators' `ctx.file`.
- Removed exports of `@miragon/bpmn-cli`: `designFindings`,
  `designValidator`, `undeclaredPrefixes`, `DESIGN_VALIDATOR`,
  `resolveProfile`, `profileValidators`, `modelsFolderOf`, `PROFILE_CHOICES`,
  `CONTENT_CONFIG_FILE` and the types `DesignOptions`, `UndeclaredPrefix`,
  `ContentRepo`, `ProfileChoice`, `ProfileInfo`.
- Removed exports of `@miragon/bpmn-cli/node`: `findContentRepo`,
  `contentModelIds`, `contentRepoOf`, `resolveFileProfile` and the type
  `ContentRepoOnDisk`.
- The result of `bpmn validate --json`, `validateXml` (`ValidationReport`)
  and `checkFile` / `checkDoc` (`CheckResult`) has no `profile` field.
  `bpmn kinds --json` has no `profiles` key, and `bpmn kinds --section
  profiles` is gone.
- The codes `E_DESIGN_*` and `W_DESIGN_*` are gone from the error catalogue
  (`ERROR_CATALOGUE`, `bpmn kinds --section errors`), and so are the
  `bpmn guide design` topic and the DESIGN-IQ section of `bpmn guide`.
- Unchanged: the validator hook (`validators`, `W_PREEXISTING_ERROR`,
  `E_VALIDATOR_FAILED`, `covers`), the platform profiles (`--platform`,
  Camunda 7 / 8), stickies (`bpmiq:sticky` follows its node) and the
  decision links in every spelling.
- Migration: in a design-iq content repository, run design-iq's own
  validator after edits:

  ```
  npx @miragon/design-iq-validator --root .
  ```

- Migration: a library host that wants a check inside the write passes its
  own validator through `validators` ([Validators](validators.md)). An error
  a change adds refuses the write (`E_VALIDATION`); one the file already had
  is a `W_PREEXISTING_ERROR` warning. design-iq's live host already passes
  its own check this way.
- A generated id is no longer cut at 61 characters: the cap of 64 includes
  a collision suffix (issue #31). 0.6 could cut a flow's end inside a word
  (`Flow_ConsignationSynchronisierenToConsignationsProtokollieren`); now an
  id within 64 characters is not cut again, and a longer one loses whole
  words. A name still gives at most 40 characters of words, as in 0.6, but
  a cut no longer ends on a filler word such as `und` or `an`
  (`Activity_LieferantenbestellungVersenden`, 0.6:
  `Activity_LieferantenbestellungVersendenUnd`), nor does a cut flow end. A
  flow's ends keep the most words that fit (0.6 shared the room by
  characters), an end never shrinks to a number or to a bare Join, two
  numbers never run into one (0.6: `Flow_2ToVertragsunterlagenarchivierung`,
  `Flow_32024To...`), and the id never ends on a number a cut left that
  reads like a collision suffix. A flow named by its ends' ids
  (`Flow_<sourceId>_<targetId>`) keeps each id's prefix when it is cut,
  where the prefixes leave room for the words after them. A scoped flow
  (`Flow_KotO_ValidateToReserve`) cuts its two end words instead of losing
  the target (0.6: `Flow_KotO_WarenwirtschaftssystemabgleichTo`), and a
  number is no end word (0.6: `Flow_KotO_ReserveTo4`). A file prefix too
  long to leave an id room gives way to the bpmn-cli prefix where the id
  would not fit with it (0.6 went past 64 characters), and so does a flow
  prefix or scope that leaves the ends fewer than 16 characters where they
  do not fit beside it at whole words (0.6 kept it and cut them). A taken
  id whose glued suffix (stemTo and scopedTo flows) follows a digit gets
  `No` before the number (`flow_checkOrderToSendPdf10No2`; 0.6:
  `...Pdf102`); 0.6's glued ids still follow their ends. Where a file's
  data object references and data objects share one prefix (bare ids
  too), the backing `bpmn:DataObject` / `bpmn:DataStore` of a long name
  keeps its `Object` / `Store` word after the cut body
  (`processDataArtefactItem_lieferung_vollstaendig_object`; 0.6:
  `..._eingegangen_2` with `W_ID_SUFFIXED`). A flow the length cap cut still
  counts for the file's flow form, also one 0.6 cut (in 0.6, enough of them
  switched a file of `Flow_<sourceId>_<targetId>` flows to
  `Flow_<Source>To<Target>`, and its flows stopped following their ends).
  The same edit can therefore give a long id that differs from the one 0.6
  gave. Flows 0.6 named are still renamed after their ends, also as 0.6 cut
  them and in a file that now reads as another form (they then get that
  form's id).
- Flow ids can be kept (issue #32): `--keep-flow-ids` on every mutating
  command and `apply`, `BPMN_KEEP_FLOW_IDS=1` as the default of a shell or
  an agent session, `keepFlowIds` in `EditOptions` / `MutationOptions`. A
  flow the file had then keeps its id when an edit gives it other ends, and
  the change names each one whose id no longer names its ends
  (`W_FLOW_ID_STALE`, with the `bpmn set` that renames it; after a splicing
  `add --flow-id`, to that id; [Limitations](contract.md#limitations)). A
  library caller that sets `Doc.followFlowEnds = false` gets these warnings
  now too, and a `--strict`
  run exits 5 on them. Only the flows the document had keep their ids: a
  flow the same `runOp`, `runOps` or `mutateDoc` call created follows its
  ends, `renames` lists it and `created` has its final id (0.6: every id
  stayed). Name such a flow with an alias where an op creates it (`flowAs`
  on an add that appends or prepends and on split nodes, `as` on connect)
  instead of guessing its id; the flow a splice creates (new node -> old
  successor) has none. With ids kept, `move` puts the moved node's out-flow
  back at its new place (`changed`, keeping its id, documentation and
  extensions; its name and condition stay with the bridge, and its change
  says which; a node that is not bridged, or whose bridge a later node of
  the same move removed, drops them with `W_LABEL_DROPPED` /
  `W_CONDITION_DROPPED` unless the flow is put back between its old ends)
  instead of removing it and creating a new one (0.6), so a flow between
  nodes moved together stays theirs.
- A batch or an op learns the file's id style before its first op runs
  (`Doc.idStyle`). Before, it was learned when the first new id was needed,
  so the ops before that could change it: a first op that removed flows
  (also a single `move`, which detaches its node first), renamed ids
  (`set <flow> id=`), named elements or retyped them could make it learn
  another style from what was left: new elements were named in it, and a
  flow whose id named its old ends was not renamed (with ids kept: not
  reported as `W_FLOW_ID_STALE`). Such batches and commands now name and
  rename in the style of the file as read.
- A flow end is also recognised by its name where its id speaks, and in a
  batch by the id and name it had before a `set id=` / `set name=` earlier
  in the batch. 0.6 named an end only as it was called at that moment: after
  `set Activity_Check id=Activity_Verify` (in the same batch, or in a command
  before while the end keeps its name "Check"), or `set name=` on an end
  whose id says nothing, a splice next to it kept `Flow_CheckToOk` without a
  word. Such flows are now renamed after their new ends (`Flow_VerifyToLog`;
  with ids kept: `W_FLOW_ID_STALE`), so a file whose flow ids name their ends
  by the ends' names (`Flow_CheckToOk` between `Activity_Verify` "Check" and
  `Event_Ok`) sees more renames. An end without a name renamed in a command
  before is still missed: nothing records its old id across commands.
- A file's flow form stays put. The flows bpmn-cli names by their ends in a
  file of `flow12` / `f3` ids (`fPackToWeigh`, in snake_case
  `fpack_to_weigh`) count for that prefix: 0.6 counted them against it, and
  after a few edits such a file read as `Flow_`, named new flows
  `Flow_ArchiveToShip` and no longer renamed its own `fBillTo...` flows. A
  tie between two flow prefixes goes to the one more flows use (`f3` counts
  for `f`), then to the alphabetically first (0.6: the one declared first,
  so a move that declared a flow elsewhere could flip it); a tie between two
  forms under one prefix (two hashes and two `Flow_Task_A_Task_B` flows) to
  the one that names the ends, so new flows there take that form instead of
  `Flow_<Source>To<Target>`. A tie between scopes stays as in 0.6. 0.6's
  scoped flows cut to an empty target word
  (`Flow_KotO_WarenwirtschaftssystemabgleichTo`) count for the scopedTo
  form, so enough of them no longer switch a 0.6 file to
  `Flow_<Source>To<Target>`. A flow named after its ends under any flow
  prefix or form the file's flows use (a `SequenceFlow_` and a `Flow_`
  prefix from two modeler versions, `F_` next to `G_`, a second scope) is
  renamed after its new ends (with ids kept: `W_FLOW_ID_STALE`); 0.6
  recognised only the winning one, so a followed hint could stop naming its
  ends on the next read. Such files see more renames, and in a few the
  learned flow prefix changes (`show --conventions`).
- A sequence flow without id (valid BPMN, written by hand) no longer makes
  `add`, `split` or `apply` fail with `E_INTERNAL` (exit 70) when they splice
  into it, nor a bridge into it: it gets an id from its new ends (or the
  `--flow-id` of the `add` that splices into it) and is listed as changed
  with `(id added: it had none)`. A removed one is
  `removed sequenceFlow (no id)` (0.6: `undefined`); `--summary` leaves it
  out of `removed:`.
- The change report names a flow that took the id a renamed flow freed by
  its own id: `add --id Activity_Check --after Event_Check` into
  `Flow_CheckToDone` lists `created sequenceFlow Flow_CheckToDone -
  Activity_Check -> Event_Done` and the spliced flow as changed
  (`Flow_CheckToCheck`, `renamed: Flow_CheckToDone -> Flow_CheckToCheck`);
  0.6 listed both under `Flow_CheckToCheck`, and `--summary` dropped the
  changed one. The written file is the same.
- Node 22.12 or later (`engines.node`; commander 15 and vitest 5 need it,
  0.6 declared Node 20).
- `bpmn validate` and every write run the project's bpmnlint configuration:
  the nearest `.bpmnlintrc` above the file, up to the repository root,
  whoever owns it (outside a git repository: the file's directory only;
  [bpmnlint](bpmnlint.md)). `validate` exits 2 on its errors; a write lists
  the findings the change added (`warning [bpmnlint error] ...`) and never
  refuses because of them. `--no-lint-config` leaves bpmnlint out of the
  output; without a `.bpmnlintrc` nothing of bpmnlint is loaded and bpmnlint
  adds nothing.
- `bpmnlint` 11.15.0 and `@miragon/bpmnlint-plugin-rules` 0.12.1 are
  dependencies (exact versions); `bpmn-moddle` resolves to 10.3.
- Library: `NamedValidator.blocks: false` makes a validator advisory
  (`ValidatorReport.blocks`); the file helpers run the `.bpmnlintrc` too,
  with only the rules bpmn-cli ships unless `lintProjectCode: true`
  (project plugins then run only in a git repository of the host's user);
  `checkFile` takes `FileCheckOptions` (`lintConfig`, `lintFrom`,
  `lintBlocks`, `lintProjectCode`); `warningLines(warnings, advisory)` and
  `renderSummary(summary, { advisory })` group an advisory validator's
  findings by code and message (`advisoryValidators(report)` gives the
  names; the CLI passes them); `--summary`'s `preexistingCount` counts an
  advisory validator's old findings too.
- Two validators of the same name are compared in order (0.6 compared every
  run with the first one's baseline), and a lint warning that a resolved
  validator finding says again (`covers`) is listed once in `resolved`, as
  that finding (0.6 listed both: `W_DEAD_END` next to the validator's finding
  about the same element).
- A write that fails (`-o` naming a directory, a directory without write
  permission) is `E_IO` (exit 4) and leaves no temp file; 0.6 reported
  `E_INTERNAL` (exit 70) and left `.<name>.<pid>.tmp` behind. `writeAtomic`
  throws that `CliError`.
- Output piped into a reader that closes early (`| head`) ends without an
  `EPIPE` trace and keeps the command's exit code (0.6 printed a Node stack
  trace and exited 1 when the command succeeded), and a model piped in from
  a slow writer (`curl ... | bpmn validate -`) is read whole (0.6 could fail
  with `E_IO` `EAGAIN`).
- Where the `.bpmnlintrc` that runs has `@miragon/rules/element-id-naming` on
  (`recommended-for-automation` turns it on, `recommended-for-modeling` has
  it off), the ids a write generates follow its prefixes and case instead of
  the file's style: `serviceTask_checkInvoice` next to `Activity_CheckOrder`,
  `flow_checkInvoiceToBookInvoice` also for a flow renamed after its new ends
  ([bpmnlint](bpmnlint.md#id-conventions)). The process and definitions ids
  of `new` change only where the rule names `bpmn:Process` /
  `bpmn:Definitions` exactly (`process_orderHandling`, `process_main`
  without a name); no id the file has changes. Under camelCase or
  PascalCase a taken id gets a glued `2` (`serviceTask_checkInvoice2`; after
  a digit `No2`: `serviceTask_step1No2`) and a
  split's join is `<gatewayId>Join`. A result names such ids
  (`conventions:`; `MutationResult.conventions`). `--no-lint-config` gives
  the ids of before.
- Library: `MutationOptions`, `EditOptions` and `NewDocOptions` take
  `conventions` (`IdConventions`, plain data; `idConventionsFromLint` builds
  them from a rule setting with the plugin's naming helpers). The file
  helpers pass the conventions of the `.bpmnlintrc` they run, unless the host
  passes `conventions` or a validator named bpmnlint of its own.
  `bpmnlintValidator` takes `notes` (W_CONFIG_IGNORED), and `LoadedBpmnlint`
  has `where`.
- Library: with `platform: 'none'` (`MutationOptions.platform`), a `set`
  op with `calledDecision` on a business rule task whose link has an engine
  spelling updates it in that spelling (`camunda:decisionRef`,
  `operaton:decisionRef`; a `zeebe:calledDecision` gets the `decisionId` and
  keeps its `resultVariable`; issue #42). 0.6 replaced it with an unprefixed
  `calledDecision` and dropped the `resultVariable`. A task without a link
  takes the engine spelling of the file's other links when they all have
  the same one, else the unprefixed `calledDecision` as before. The change's
  `detail` names the spelling written (`calledDecision=risk
  (camunda:decisionRef)`; 0.6: `calledDecision=risk (calledDecision);
  removed camunda:decisionRef`). The CLI is unchanged: it detects the engine from
  such a link, so `bpmn set <file> <id> calledDecision=<decision>` writes
  the Camunda 7 / 8 spelling as in 0.6, and in a file without engine
  content the unprefixed `calledDecision` ([Set keys](reference.md#set-keys)).
- In an `apply` batch (and a typed batch of `mutateDoc` / `runOps`) an alias
  follows its element through a retype to another type, also to the new id
  the declared id conventions give it (`serviceTask_checkInvoice` ->
  `userTask_checkInvoice`), so a batch can create, retype and then
  configure an element. 0.6 failed a later op that used the alias with
  `E_NOT_FOUND` (exit 2) and left the alias out of `aliases` (the
  `aliases:` line and `--json`), which now lists it with the new id.
- Library: a typed `split` op (`mutateDoc`, `runOps`, `mutateFile`) whose
  branch has no `nodes` array is `E_USAGE`, worded like `parseOps` (`split
  branches[0]: missing required key "nodes" (...)`); 0.6 made it a direct
  gateway -> join flow. Write `nodes: []` for a direct flow, as the CLI
  already asked. `branches` or `nodes` that are not arrays of objects, and a
  node without a string `kind`, are `E_USAGE` too (0.6: a `TypeError`, a
  node without `kind` with the split gateway already added). The split
  checks this before it changes anything.
- `move` checks the chain before anything changes: when the node a chain of
  several ids starts after (the `--after` anchor, the source of the
  `--flow`) is one of its later nodes, inside one or a boundary event of
  one, or a `--before` anchor lies inside one, the move fails with
  `E_INVALID_PLACEMENT` (exit 2). 0.6 wrote a rewired model with exit 0
  (`move A Join Done --after Join`: unreachable nodes, a flow listed as
  created and removed). A single node after its own boundary event is
  `E_INVALID_PLACEMENT` too (0.6: `E_NOT_FOUND`).
- A move that leaves its nodes where they are (`move B --after A` with
  A -> B) changes nothing and adds a note (`Activity_B is already after
  Activity_A`), in both flow-id modes. 0.6 detached and placed the node
  again: by default new or suffixed flow ids (`W_ID_SUFFIXED`), the
  out-flow's label on the in-flow, and a gateway or merge in the chain lost
  its other flows; some such moves were refused (`E_HAS_SUCCESSOR`,
  `E_HAS_PREDECESSOR`, `E_NO_FLOW`, `E_INVALID_BRIDGE`) and are notes now. In
  a batch its flow keys go to the flow into the first node, and `"flowId"`
  renames that flow (0.6 made a new flow with that id where the node was
  appended, and dropped the id where it was spliced). The incremental layout
  places only the nodes a move relocated (0.6: every node a move named, so a
  move in place could rearrange a hand-made drawing). Library:
  `ChangeSet.relocated` lists them.
- A full redraw (`bpmn layout`, `--relayout` / `--layout full`, an
  engine-owned drawing redrawn in `auto` mode, the
  `W_LAYOUT_INCREMENTAL_FAILED` fallback, `--engine auto`) draws group boxes
  again around the elements they held, with their DI id and colour; 0.6
  dropped every group's shape. A group with nothing drawn inside keeps its
  box, or its size below the drawing when the redraw put shapes on it, and
  the layout block has a note (`LayoutStatus.notes` and
  `LayoutResult.notes` can now come from a full redraw). The built-in
  engine keeps the parts of a group that no flow connects together, so
  files with groups can get another order of such parts; without groups
  the order is unchanged.
- The layout metrics (`bpmn metrics`, `layoutProblems`, `layout.metrics` of
  every write, `render --problems`) no longer treat a group as a leaf
  shape: a group never overlaps, lies on a line or has a label on it (its
  own label still counts). Scores of drawings with a group are lower than
  in 0.6 for the same file: gallery.bpmn 182 -> 64.
- A group of the collaboration no longer gives `W_LAYOUT_DI_NOT_CREATED`.
  An association between a text annotation and a group still has no line
  after a full redraw; its warning now reads `No DI created for <id> (an end
  is a group: its box is drawn after the layout)`.
- DI ids stay within 64 characters, a collision suffix included, also in a
  new drawing (a new file, a file without DI, or DI whose ids show no form)
  and its full redraws: where `BPMNShape_<id>`, `BPMNEdge_<id>`,
  `BPMNPlane_<id>` or `BPMNDiagram_<id>` would pass 61 characters (room for
  a `_99`), the id in it is cut at whole words, and a cut id that is taken
  gets `_2`; 0.6 wrote them uncut there. Element ids up to 49 characters
  give the same DI ids as before. DI ids a file already has are never cut.
  Element ids, the CLI's output and the library's results do not change.
- `bpmn set <file> <id> id=<new>` (and an `apply` batch's `set`) takes a DI
  id derived from the old id along (`<id>_di`, `BPMNShape_<id>`,
  `BPMNEdge_<id>`, `Edge_<id>`, also cut, also with a `_2`), as a flow
  renamed after its ends always did; 0.6 left `BPMNShape_<old>`. So
  following a `W_FLOW_ID_STALE` hint gives the file the default rename
  gives. A DI edge id 0.6 cut to numbers (`BPMNEdge_Flow_Pruefung10To2030`)
  now follows its flow too. When the new DI id is taken, a renamed element
  (or a flow renamed after its ends) gets it with `_2`; 0.6 left the old
  one. The renamed element's DI element is written anew, as the renamed
  element itself already was: its attributes in bpmn-moddle's order, and a
  comment inside it is dropped (the result's note counts it). In a batch, a
  DI id of an element removed earlier in it is free for a later `set id=`,
  as it is for a command of its own.
