# Handover, 2026-10-13 (after step 1 of the audit fixes, the Camunda 7 step and its follow-ups, step 2: bpmn-cli as design-iq's editing engine, step 3 round 1 with its fixes and follow-ups: views, speaking ids, layout ergonomics, Camunda 8, stages 1 to 3 of `bpmn render` with the fixes after its verification (#12), the profile rules loaded on demand (#13), stages A and B of the incremental layout of edits to hand-drawn models (#18), the removal of the design profile (#35), and ids up to 64 characters cut at whole words (#31))

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
place, the ends of a flow) in the file's id style, and an `apply` batch
names what it creates with aliases (`"as": "$name"`). An agent reads a
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
npm run gate            # build, 1911 tests (+246 opt-in engine tests), isomorphism check with bundle budgets, layout-regression budget, short fuzz campaign
npm run typecheck
node tools/layout-regress.mjs   # FILES 115 SCORE 444 (budget in tools/bench/regress-budget.json)
node bin/bpmn.js guide --short  # the cheat sheet an agent reads first (`guide` for all of it, `guide <topic>` for one section)
```

An audit in October 2026 (eight streams, about 60,000 mutations) confirmed 77
bugs; [docs/audit-2026-10.md](docs/audit-2026-10.md) has the table with the
current status of each, and [docs/testing.md](docs/testing.md) how to run every
test layer, the benchmark and the fuzzer.

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
  `GLUED_SUFFIXED`) does not vote in `learn`: 0.6 read it as the prefix
  `flowVertrags...` and a number, and three of them made that the flow
  prefix (80-character ids, splices not followed).
- **Cut flows vote for their form** (`cutOfForm` in `learn`): a flow whose
  id matches no form uncut votes for a form built from its ends' ids
  (stemTo, idPair, stemSnake, idSnake) when it is one of the cuts
  `derivedBases` lists for that form (also 0.6's), with or without a
  suffix; cheap tests first (the word between the ends, a stemTo source in
  lower case, the start of a stem form's source). Before, enough cut flows
  flipped an idPair / idSnake / stemSnake file to `named`: the 7th
  long-named splice in an idPair file renamed nothing, and new flows
  switched convention. In a file whose flows read as stemTo / stemSnake,
  `derivedBases` also lists the `named` bases, so the `named` flows
  bpmn-cli gave it before (a flow to a join is named by the join's label,
  `CheckOrderJoin`) still follow their ends. Cost: `IdStyle.infer` on 300
  flows of which 250 are cut, 2 to 6 ms of CPU (idPair) and 3 to 11 ms
  (idSnake); a file of named flows is unchanged.
- **Flows written by 0.6** (`derivedBases`, used by `followEnds`): the uncut
  id when it has at most 60 characters, else also the ids at 64 to 60 (a
  suffix of up to 4 characters, `_100`), the id 0.6 cut (`legacyFitPair`,
  the old algorithm with 0.6's `cutAt` and scoped end words, kept only for
  this) and that id cut again to 60, as 0.6 did for a suffix from `_100`,
  so a flow 0.6 cut inside a word still follows its ends.
- DI ids keep `MAX_DI` 61 and go through `cutAt`, so only its letter guard
  changes them: a DI id 0.6 cut to a bare number or to two numbers in a row
  is not recognised by `edgeStyleOf` and keeps its id when its flow is
  renamed.

Ids differ from 0.6 for the same edit where an id has 62 to 64 characters or
has to be cut; one pinned id changed: the long-names test's flow keeps the
most characters among its cuts of seven words,
`Flow_PruefenObDieEingereichtenUnterlagenToBenachrichtigungUeber` (0.6:
`...EingereichtenToBenachrichtigungUeberDen`, 7 characters shorter). Runtime: a splice write
with long names is unchanged (4.6 to 4.7 ms median, as in 0.6), the
layout-regression score (444) and the gate's fuzz campaign are identical; on
long name pairs `derivedBase` takes about 10 instead of 7 microseconds and
`derivedBases` about 50 instead of 12 (a few calls per renamed flow).
Bundle (on top of #35): whole entry 865.8 / 273.2 -> 872.0 / 275.5 KB,
`applyToXml` only 630.6 / 199.9 -> 635.6 / 201.8 KB (budgets unchanged,
883 / 279 and 643 / 204; `docs/library.md` updated).
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
long-named splices, a stemTo file's `named` join flow, ends of 1,600 words,
element ids of 62 to 64 characters with the `--if-absent` hint and a data
object, joins), a
design-iq splice, scoped flows with long and number-led end words and a
glued file with suffixed flows in `test/conventions-ids.test.ts`, the
issue's commands in `test/cli.test.ts`, doc pins in `test/batch.test.ts`
and `test/conventions-ids.test.ts`. Left for later: a stop word left at the end of a cut
(`Flow_Task_lieferung_versenden_und_Task_rechnung_eingegangen_und`: the
most words win), the engine's `BPMNShape_<id>` / `BPMNEdge_<id>` over 64
characters in a fresh drawing, the DI cap, a data object whose `Object`
word a reference id of 63 or 64 characters cuts away again (it takes `_2`,
as 0.6 did just below its cap), a cut inside a word where two one-word ends
do not fit beside each other (one end loses its last letters,
`Flow_Task_lieferantenbestellungsuebersich_Task_zahlungseingaenge`), a
suffix glued to an end that ends in a digit (stemTo / scopedTo
`...Pdf10` + `2`, as in 0.6), bpmn-cli's own glued flows without a suffix,
which count against a numbered file's form without voting for it, scoped
flows 0.6 cut to an empty end word (`Flow_KotO_...To`), which no longer
match their form and can flip a 0.6 file's form, an end whose leading
number fills a small room (`10202422024Rechnung` in 11 characters keeps no
letter), an element prefix of 52 to 55 characters that a suffix leaves a
body under 8 (the fallback to the bpmn-cli prefix counts no suffix:
`<prefix>_2024_100`, a body without a letter), a target that already ends
in a number before its number tail (`x_2_2`: its re-cut for `_2` gives the
base again, so `_2` is skipped), and a count before a dropped word kept at
the end of a target that has no separated suffix
(`...ToLieferantenbestellungen4` for `Lieferantenbestellungen 4 Augen ab`:
only a suffix's look is checked, not whether the number counts the next
word).

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

- design-iq's spelling of decision links: for a model with no engine
  namespace bpmn-cli writes the unprefixed `calledDecision=`, design-iq's
  convention. It gets its own issue, together with keeping a file's own link
  spelling (design-iq's ADR 0009, upstream asks).
- Once the release is out: the design-iq PR for Miragon/design-iq#248 (the
  version bump, `profile: 'none'` dropped).
- The `E_VALIDATION` entry of the error catalogue still says to run `bpmn
  validate <file>`, which cannot show a host validator's findings (the CLI
  takes no validators; the host shows them in its result).
- #33 and #34 (bpmnlint config, project config) stay open: they are generic
  and do not depend on this issue.

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
  switch); `bpmn new` without `--name` (and without a speaking `--id`)
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
- Known residuals of the clean engine: complexGateway, choreographies and
  groups unsupported (a full redraw drops group boxes); cross-scope
  associations are straight lines; boundary-handler paths can run through
  nested expanded sub-processes (#19); `order <collaboration> <pools...>` sets
  the pool order of a kept drawing, a full redraw orders pools by its own
  rule (message-flow cost, declared order on ties).
