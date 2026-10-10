# bpmn-cli

A command line tool that lets an AI agent (or a human at a shell) edit BPMN 2.0
models **semantically**. The agent works on the metamodel only: kinds, names,
sequence flows, triggers, lanes, pools, properties and vendor extensions. It
never sees or writes diagram interchange (DI). The CLI keeps the drawing: a
hand-made diagram (Camunda Modeler, bpmn-js) stays as it is, new elements are
placed next to their neighbours, room is made like with the modeler's space
tool, and only the affected flows are rerouted. A new file, or a drawing the
engine made and nobody changed since, is drawn by the built-in layout engine,
following the modelling conventions of bpmn.io (ids like
`Activity_CheckInvoice`, expanded sub-processes, the happy path on a straight
line, branches as bands below it). `--engine auto` switches to
[bpmn-auto-layout](https://github.com/bpmn-io/bpmn-auto-layout) for those
redraws.

To change the picture itself the agent uses diagram-only commands that name
elements instead of coordinates (`place`, `align`, `color`, `label`, `route`,
`space`, `tidy`, `compact`, `order` of lanes and pools; selectors such as
`--path <fromId> <toId>` name a whole path at once) and reads the drawing
back with `show --layout` and `metrics`: formatting without XML.

```
$ bpmn new order.bpmn --name "Order handling"
$ bpmn add order.bpmn start "Order received"
$ bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived
$ bpmn add order.bpmn end "Done" --after Activity_CheckInvoice
$ bpmn show order.bpmn
process Process_OrderHandling "Order handling" executable
  startEvent Event_OrderReceived "Order received" -> Activity_CheckInvoice (Flow_OrderReceivedToCheckInvoice)
  userTask Activity_CheckInvoice "Check invoice" -> Event_Done (Flow_CheckInvoiceToDone)
  endEvent Event_Done "Done"
problems: none
```

The result is a normal `.bpmn` file that opens in Camunda Modeler / bpmn-js
with a laid-out diagram.

## Contents

- [Install](#install)
- [Claude Code plugin](#claude-code-plugin)
- [The contract](#the-contract)
- [Ids](#ids)
- [Command reference](#command-reference)
- [Layout modes](#layout-modes)
- [Formatting without XML](#formatting-without-xml)
- [Kinds](#kinds)
- [Triggers](#triggers)
- [Placement grammar](#placement-grammar)
- [Set keys](#set-keys)
- [Camunda 7](#camunda-7)
- [Camunda 8](#camunda-8)
- [design-iq: the design profile and validators](#design-iq-the-design-profile-and-validators)
- [Ops JSON (`bpmn apply`)](#ops-json-bpmn-apply)
- [Output, errors and exit codes](#output-errors-and-exit-codes)
- [Quoting](#quoting)
- [The DI contract](#the-di-contract)
- [What a write changes](#what-a-write-changes)
- [Limitations](#limitations)
- [A worked session](#a-worked-session)
- [Library use](#library-use)

## Install

Requires Node 20+ (developed on Node 24).

```
npm install -g @miragon/bpmn-cli   # puts `bpmn` on your PATH
bpmn guide --short                 # the agent cheat sheet, its 5 KB core (`bpmn guide` for all of it)
```

From a checkout:

```
npm install
npm run build          # tsc -> dist/
npm link               # optional: puts `bpmn` on your PATH (bin/bpmn.js)
bpmn guide             # the agent cheat sheet
```

Releases are automated (release-please, npm trusted publishing); see
[docs/releasing.md](docs/releasing.md).

During development `npm run dev -- <args>` runs the TypeScript sources directly
(`tsx src/cli.ts`). `npm test` runs the vitest suite, `npm run typecheck` the
compiler, and `npm run gate` everything a change has to pass before it is
handed over (build, tests, the isomorphism check of the browser-safe core,
the layout-regression budget and a short fuzz campaign). The test layers, the benchmark and the fuzzer, and how to run them
on a private corpus without copying it into the repository, are described in
[docs/testing.md](docs/testing.md).

Dependencies: `bpmn-moddle` (the semantic model; `moddle` for its types),
`bpmn-auto-layout` (pinned to `2.0.0-alpha.2`, loaded only for
`--engine auto`) and `commander` (the CLI only). Nothing else.
`camunda-bpmn-moddle` (pinned to `8.0.1`) is a development dependency: its
Camunda 7 descriptor says which `camunda:` attributes and extension elements
belong where (placement, `validate`), and it is inlined into
`src/platform/camunda-descriptor.ts` by `node tools/gen-camunda-descriptor.mjs`
(run it after updating the package; a test fails while the copy differs), so
the published package reads the copy, without the package and without file
access. It is never registered with bpmn-moddle, so camunda content stays
untyped and the serialisation is unchanged. `zeebe-bpmn-moddle` (pinned to
`2.0.0`) is the same for Camunda 8: its Zeebe descriptor is inlined into
`src/platform/zeebe-descriptor.ts` by the same tool and read as data
(placement and known names of zeebe content, [Camunda 8](#camunda-8)).

## Claude Code plugin

This repository is also a [Claude Code](https://code.claude.com/docs/en/plugins) plugin
marketplace, `miragon-bpmn`, with one plugin, `bpmn-cli`. Its skill `bpmn` makes Claude use this
CLI whenever a request creates or touches a BPMN model ("model the order process", "add an
approval step", "colour the happy path", "make it deployable on Camunda 8", "Prozess
modellieren", "BPMN anpassen", ...) instead of writing BPMN XML by hand.

Install it in a Claude Code session:

```
/plugin marketplace add Miragon/bpmn-cli
/plugin install bpmn-cli@miragon-bpmn
```

or from the shell with `claude plugin marketplace add Miragon/bpmn-cli` and
`claude plugin install bpmn-cli@miragon-bpmn` (Claude Code 2.1.275 and later also take one
step: `/plugin install bpmn-cli --marketplace Miragon/bpmn-cli`). The repository is private:
Claude Code clones it with the credentials of your machine and never prompts, so you need read
access to `Miragon/bpmn-cli` and either an SSH key loaded in `ssh-agent` or a stored HTTPS
credential (`gh auth login`, then `gh auth setup-git`; `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` skips
the SSH attempt). `/plugin marketplace update miragon-bpmn` fetches a new release, or enable
auto-update for the marketplace under `/plugin` > Marketplaces.

What the skill does:

- **Runs the CLI** - `bpmn` from `PATH`, else `npx -y @miragon/bpmn-cli@<version>` pinned to the
  plugin's version (Node 20+); these two commands are the only ones it pre-approves. Batches are
  piped in with `printf '%s' '<json>' | bpmn apply <file> -`, which runs under that
  pre-approval (a heredoc holding JSON makes Claude Code ask first).
- **Standing rules** - never write or patch `.bpmn` XML or BPMNDI; address elements by id only;
  give every created element an explicit speaking id (`Activity_CheckInvoice`); aliases for back
  references inside a batch; one `bpmn apply` batch per change; keep the user's drawing
  (`--relayout` only on request).
- **The loop** - orient with `show`, `show --around`, `show <id> --context`, `find`; change in one
  batch; read the result (layout mode, placed / moved, added layout problems, the warnings the
  change added); `validate` (`--strict` for deployable models); format with `show --layout`,
  dry runs and the format commands; Camunda 7 and Camunda 8 recipes; the common errors and
  their fixes.
- **Progressive disclosure** - `SKILL.md` holds the rules (about 480 tokens always loaded, about
  5k when it fires); `reference/` has the batch format, formatting, Camunda 7, Camunda 8 and
  complete recipes; for everything else the skill sends Claude to `bpmn guide <topic>` and
  `bpmn kinds`, so the CLI's own documentation stays the single source.

The plugin's version is the package version: release-please bumps
`plugins/bpmn-cli/.claude-plugin/plugin.json` and the pinned `npx` version of the skill in each
release PR ([docs/releasing.md](docs/releasing.md)). `test/plugin.test.ts` (part of `npm test`)
keeps the skill honest: it runs every recipe and reference example against the CLI built from
`src/`, checks that every `bpmn <command> --option` the skill mentions exists, and that the
versions agree. To work on the plugin:

```
claude plugin validate --strict plugins/bpmn-cli   # the plugin (CI runs both)
claude plugin validate --strict .                  # the marketplace
claude --plugin-dir plugins/bpmn-cli               # a session with the local plugin loaded
claude plugin eval plugins/bpmn-cli --scaffold --allow-tools Bash Write Edit
```

The eval suite (six cases: an order-to-cash model from scratch, a change to a hand-drawn model,
a Camunda 7 external task, a formatting request, a German Camunda 8 request, and an unrelated
question the skill must ignore) and how to run it are described in
[plugins/bpmn-cli/evals/README.md](plugins/bpmn-cli/evals/README.md).

## The contract

1. **You edit the metamodel.** Every command names elements by id and changes
   the BPMN semantics. `bpmn show` prints the model in flow order without any
   coordinates; that is all the agent needs to read.
2. **The CLI keeps the picture.** Every mutating command ends with
   *validate -> layout -> atomic write*. A hand-made (or formatted) drawing is
   kept and only what changed is placed and routed; a new file or a drawing
   the engine made and nobody changed is redrawn ([Layout modes](#layout-modes)).
   `--relayout` redraws on request, `--no-layout` skips the layout,
   `bpmn layout` redraws on its own. The picture itself is changed with the
   [format commands](#formatting-without-xml), never with coordinates. The
   write rewrites only the elements the change touched; the rest of the file
   keeps its text, and a result equal to the file is not written at all
   ([What a write changes](#what-a-write-changes)).
3. **Ids speak and follow the file.** Every new id says what it names, in
   the id style the file already uses ([Ids](#ids)): its prefixes
   (`Activity_`, `serviceTask_`, `Task_`, `SF_`), its case
   (`Activity_CheckInvoice`, `serviceTask_checkStock`, `Task_check_stock`)
   and its flow form (`flow_checkStockToShip`, `Flow_<from>_<to>`). Never a
   hash or a running number: a Camunda Modeler file (`Activity_0k3x9qa`)
   gets `Activity_CheckInvoice`, a file numbering `Task_12` gets
   `Task_CheckInvoice`. A new file follows the bpmn-js conventions:
   `Activity_CheckInvoice`, `Event_OrderReceived`, `Gateway_InvoiceOk`,
   `Participant_Customer`, `Lane_Sales`, `DataObjectReference_Order`;
   unnamed elements are named by their kind and place
   (`Gateway_AfterCheckInvoice`, `Event_TimerOnReview`), flows by their ends
   (`Flow_CheckInvoiceToBookInvoice`). Elements are addressed by id only
   (names may repeat); a taken id gets `_2`, `_3` (with a `W_ID_SUFFIXED`
   warning). Every result lists the ids it created; inside an `apply`
   batch, an op names what it creates with an alias (`"as": "$check"`).
4. **Nothing is half done.** A command (or a whole `apply` batch) either
   succeeds completely or leaves the file untouched. Structural validation
   errors that the change would introduce block the write (`--force`
   overrides); errors the file already had are reported as
   `W_PREEXISTING_ERROR` and do not block, so a file with an unsupported
   element (a `complexGateway`) or another old problem stays editable. In a
   design-iq content repository the same holds for design-iq's save gate
   (the [design profile](#design-iq-the-design-profile-and-validators)).
5. **Conventions instead of coordinates.** Sub-processes are expanded by
   default; the default flow (or, without one, the first outgoing flow) is
   the straight continuation and further branches alternate below and above
   it; exclusive gateways should be named as a question and their branches
   named; joins and parallel gateways stay unnamed. `bpmn validate` lints
   against these.

## Ids

Elements are addressed by id, never by name (names may repeat). Every new
id says what it names, and follows the conventions of the file it is
written into (the modeler, a team convention, a generator): `bpmn` reads
the ids the file has and generates new ones the same way. Explicit ids
(`--id`, `"id"` in ops JSON) are always taken as given.

| what | learned from the file | examples |
| --- | --- | --- |
| prefix | per kind (and trigger); else what its family shares (`Task_` for every task kind); else the type when prefixes name types; else the bpmn-cli prefix in the file's case. No prefix is a convention too: where a kind's or family's ids have none, or the file's flow nodes mostly have none, a named element gets a bare id (camelCase, PascalCase in a PascalCase file); an unnamed one keeps a prefix | `Activity_`, `Task_`, `serviceTask_`, `End_`, `messageBoundaryEvent_`, `event_`; bare `reviewOrder` |
| case of the body | the case of the named flow nodes' ids (of the other named elements when the flow nodes show none); Camunda Modeler hashes (`Activity_0k3x9qa`) and numbers (`Task_12`) show none: PascalCase | `CheckInvoice` (default), `checkInvoice`, `check_invoice`, `Check_Invoice` |
| sequence / message flows | the form of at least half of the flows; files whose flows are hashed (`Flow_0k3x9qa`, `SequenceFlow_1abc2de`) or numbered (`Flow_12`, `SF_3`, `flow12`) lend their prefix to the `named` form | `named`: `Flow_CheckInvoiceToBookInvoice` (default), `SequenceFlow_ArchiveToDone`, `SF_ThirdToFinish`, `flowReviewOrderToPackGoods`; the file's own forms: `flow_checkStockToShipGoods`, `Flow_<from>_<to>`, `Flow_<from>_to_<to>`, `Flow_check_stock_to_ship_goods`, `Flow_<scope>_<A>To<B>` (`Flow_KotO_ValidateToReserve`: the scope the flows share, the first word of each end, `Start` / `End` for start and end events) |
| diagram (DI) | the form of the file's DI ids; a full redraw keeps every existing DI, plane and diagram id | `<id>_di`, `BPMNShape_<id>`, `Shape_<id>` |

One id is not a convention: a rule needs two ids that follow it (in a file
whose ids are mostly prefixed, one id of a kind is enough for that kind). A
file without a convention gets the bpmn-cli default.

What the body says:

| element | body | examples |
| --- | --- | --- |
| named | the name | `Activity_CheckInvoice`, `Gateway_InvoiceOk` |
| unnamed | a word for its kind (events: `Start`, `End`, `MessageStart`, `ErrorEnd`, the trigger of a catch or boundary event, `MessageThrow`; other kinds only when there is no context: `Gateway_Parallel`, `Activity_Task`) and its context: `After <anchor>`, `Before <anchor>`, `On <host>`, `In <sub-process>` (or pool, in a file with several processes); after or before an unnamed anchor placed the same way, the nearest named anchor, once (and the anchor's kind where the id would repeat the anchor's: see below) | `Gateway_AfterCheckInvoice`, `Event_TimerOnCheckInvoice`, `Event_EndAfterTimerOnCheckInvoice`, `Event_ErrorStartInHandleErrors`; after `Gateway_AfterCheckInvoice`: `Event_EndAfterCheckInvoice` (never `EndAfterAfterCheckInvoice`) |
| flow | its ends: `<Source>To<Target>` (in the file's case: `checkStockToShip`, `check_stock_to_ship`) | `Flow_CheckInvoiceToBookInvoice`, `Flow_CheckInvoiceToAfterCheckInvoice` (to the unnamed gateway after it), `Flow_BookInvoiceToCheckInvoiceJoin` (to that split's join) |
| join of a split | the split gateway's id + `_join` (camelCase files: `Join`) | `Gateway_InvoiceOk_join`, `gateway_fanOutJoin` |
| other | what it belongs to | `Collaboration_OrderHandling` (its process), `LaneSet_OrderHandling`, `Process_Customer` (its pool), `TextAnnotation_CheckWithinTwoDays` (its text), `Association_CheckInvoiceToCheckWithinTwoDays`, `DataInputAssociation_OrderToCheckInvoice` |

An end or anchor is named by the speaking part of its id (ids are built
from ids: `Activity_CheckInvoice` is `CheckInvoice`, also after its name
changed; an unnamed element by its own kind and place, `Gateway_AfterCheckInvoice`
is `AfterCheckInvoice`, the join of the split after it `CheckInvoiceJoin`,
so the flows at two unnamed gateways differ without a suffix), by its name
when its id says too little (a hash, a number, one or two letters), else by
a word for its kind (`Gateway`, `End`, `Timer`). Ids that say nothing
(Camunda Modeler hashes, numbers, `StartEvent_1`) are never copied into new
ids. A name without a letter (`123`, `✓✓✓`) names nothing: the element gets
the id of an unnamed one.

A generated id has at most 64 characters, cut at word boundaries the same
way every time: a name gives at most 40 characters of words
(`Activity_PruefenObDieEingereichtenUnterlagen` for "Prüfen ob die
eingereichten Unterlagen vollständig und fristgerecht vorliegen"), a flow's
two ends share the room, a join's `Join` and a collision suffix are kept. A
flow a file got before the cap still counts as named after its ends.

The same edit on the same file always gives the same ids. An unnamed
gateway or activity whose id is taken, or whose body the id of another
element already has (the unnamed gateway it follows), first spells out its
kind where the prefix does not say it (`Gateway_ParallelAfterCheckInvoice`
after `Gateway_AfterCheckInvoice`, `Activity_ServiceTaskAfterCheckInvoice`
after it); after an unnamed anchor whose place it would repeat, it then
names that anchor's kind (`Task_AfterCheckInvoiceGateway` after
`ExclusiveGateway_AfterCheckInvoice` in a file whose task prefix says the
kind, `Task_AfterCheckInvoiceGatewayTask` after that one,
`Activity_AfterCheckInvoiceServiceTask` after
`Activity_ServiceTaskAfterCheckInvoice`). Unnamed elements in a row get
bodies of their own that way, and the flows between them never read
`AfterCheckInvoiceToAfterCheckInvoice` (where the two ends of a flow begin
with the same word, the length cut keeps each end's last word). A taken id gets `_2`, `_3`
(the file-learned `stemTo` / `scopedTo` flows: `2`, `3`) and a
`W_ID_SUFFIXED` warning: a name the file already has, or two unnamed
elements that only an index tells apart (two unnamed tasks right after the
same unnamed gateway: `Task_AfterCheckInvoiceGateway_2`). Edits made
independently on two branches of a file (git, two agents) produce the same
new id only when they add the same thing in the same place.

A flow whose id names its ends (exactly the id the file's style gives a flow
between them, also with a suffix) is renamed after its new ends when an edit
changes them: a splice (`add --after`, `--flow`, `split`), a bridge
(`remove`, `move`) or `set <flow> target=`. The change says so (`renamed
from Flow_CheckInvoiceToDone: its id named its old ends`; `--summary` and
`--json`: `renamed`, old id -> new id), its DI edge id
follows when it was derived from the flow id, and every other id stays (a
hashed `Flow_0k3x9qa` or a numbered `Flow_12` keeps its id). In an `apply`
batch a later op refers to an element an earlier op created by an alias
([Ops JSON](#ops-json-bpmn-apply)) or by an explicit `id`.

Names become ASCII words: German umlauts are transliterated (`ä` -> `ae`,
`ö` -> `oe`, `ü` -> `ue`, `ß` -> `ss`; `Prüfung` -> `Activity_Pruefung`), so
are the letters an accent cannot be dropped from (`ø` -> `oe`, `å` -> `aa`,
`æ` -> `ae`, `œ` -> `oe`, `ł` -> `l`, `þ` -> `th`; `Øre` -> `Oere`), other
accents dropped (`Café` -> `Cafe`). An id that is not found
(`E_NOT_FOUND`) comes with the ids that were probably meant, best first: the
new id of a flow an earlier op of the batch renamed; the same id in another
case, umlaut spelling or with another or no prefix (`Activity_Prufung`,
`Activity_Prüfung` -> `Activity_Pruefung`; `Task_CheckInvoice`,
`CheckInvoice` -> `Activity_CheckInvoice`); ids containing it; typos
(`Activity_ChekInvoice`); names containing it. Inside an `apply` batch the
ids it created come first, and the hint lists them (and points out an alias
written without `$`).

## Command reference

```
bpmn new <file> [--name <text>] [--id <processId>] [--no-executable] [--target camunda8|camunda7]
bpmn show <file> [<id> [--context]] [--json] [--scope <id>]
bpmn show <file> --around <id> [--depth <n>] [--inner] [--json]
bpmn show <file> --layout [--json]
bpmn find <file> <text> [--kind <kind>] [--json]
bpmn add <file> <kind[:trigger]> [<name>] [--id <id>]
         [--after <id>] [--before <id>] [--flow <flowId>] [--in <scopeId>] [--on <activityId>] [--to <id>]
         [--lane <laneId>] [--flow-name <text>] [--flow-id <id>] [--condition <expr>] [--language <lang>] [--default]
         [--collapsed] [--if-absent] [--doc <text>] [--text <text>] [--process <id>] [--black-box] [--members <id,...>]
         [--timer <iso>] [--timer-kind cycle|duration|date] [--message <name>] [--error <name>] [--error-code <code>]
         [--signal <name>] [--escalation <name>] [--escalation-code <code>] [--when <expr>] [--link <name>] [--non-interrupting]
         [key=value ...]
bpmn connect <file> <sourceId> <targetId> [--name <text>] [--id <id>] [--condition <expr>] [--language <lang>] [--default]
         [--message <name>] [--if-absent]
bpmn set <file> <id> <key=value ...> [--unset <key>]...
bpmn remove <file> <id...> [--no-bridge | --bridge-all | --with-branch] [--if-exists]   (alias: rm)
bpmn retype <file> <id> <kind[:trigger]> [trigger options as in add]        (alias: replace)
bpmn move <file> <id...> [--after <id>] [--before <id>] [--flow <flowId>] [--in <scopeId>] [--on <activityId>] [--lane <laneId>]
bpmn order <file> <nodeId> <flowId...>
bpmn order <file> <poolId|processId|laneId> <laneId...>
bpmn order <file> <collaborationId> <participantId...>
bpmn ext add <file> <id> <type|path> [attr=value ...] [--body <text>] [--xml <snippet>] [--replace]
bpmn ext remove <file> <id> <selector|index>
bpmn ext list <file> <id> [--json]
bpmn apply <file> [<ops.json> | -]                                           (- = stdin)
bpmn place <file> [<id...>] [--row-of <id> | --below <id> | --above <id>] [--column-of <id> | --after <id> | --before <id>] [SELECTORS]
bpmn align <file> [<id...>] --axis row|column [--to <id>] [SELECTORS]
bpmn color <file> [<id...>] --color blue|orange|green|red|purple|default [SELECTORS]   (alias: colour)
bpmn label <file> <id> --side above|below|left|right
bpmn route <file> <flowId> [--exit right|top|bottom|left] [--entry left|top|bottom|right]
bpmn space <file> (--after <id> | --below <id>) [--by column|row|<px>|-column|-row|-<px>]
bpmn tidy <file> [<id>...] [SELECTORS]
bpmn compact <file> [<poolId|laneId|subProcessId>...]
  SELECTORS: --path <fromId> <toId> [--via <flowId...>] | --kind <kind> | --branch <flowId>
bpmn validate <file> [--json] [--strict] [--platform auto|c7|c8|none] [--profile auto|design|none]
bpmn layout <file> [--expand <id,...>] [--collapse <id,...>]
bpmn layout <file> --tidy
bpmn metrics <file> [--json]
bpmn kinds [--section <name,...>] [--json]
bpmn guide [--short | <topic>]
```

`-` as the file reads the model from stdin (`show -`, `find -`, `validate -`,
`metrics -`, `ext list -`, and every mutating command, whose result then goes
to stdout); see [stdin and stdout](#stdin-and-stdout). Every `--json` output
is compact JSON on one line; `--pretty` indents it.

Common options of every mutating command (`new`, `add`, `connect`, `set`,
`remove`, `retype`, `move`, `order`, `ext add/remove`, `apply`, `place`,
`align`, `color`, `label`, `route`, `space`, `tidy`, `compact`, `layout`; `layout`
always redraws, so it has no layout mode options):

| option | effect |
| --- | --- |
| `--json` | machine-readable result on stdout (compact; `--pretty` indents it), errors as JSON on stderr |
| `--summary` | a short result: created ids by kind, batch aliases, changed / renamed / removed ids, one line per format op, the added warnings, one layout line (see [Output](#output-errors-and-exit-codes)) |
| `-o, --out <file>` | write to another file instead of in place; `-o -` writes the result to stdout (the report goes to stderr) |
| `--dry-run` | run everything (including layout) but write nothing |
| `--layout <auto\|incremental\|full>` | how the diagram is updated, see [Layout modes](#layout-modes); default `auto` |
| `--relayout` | redraw the whole diagram (= `--layout full`) |
| `--no-layout` | write without updating the diagram (stale DI of removed elements is pruned; format commands still apply to the existing drawing) |
| `--force` | write although the import was lossy, validation found errors, or (`new`) the file exists |
| `--backup` | copy `<file>` to `<file>.bak` before overwriting |
| `--show` | append the full model view (as `show` prints it) to the result |
| `--strict` | exit with code 5 when the result has warnings |
| `--engine <clean\|auto>` | layout engine: `clean` (built-in, default) or `auto` (bpmn-auto-layout) |
| `--profile <auto\|design\|none>` | validation profile: `design` checks the result against design-iq's save gate and refuses a change that introduces an `E_DESIGN_*` error; `auto` (default) runs it for the models of a design-iq content repository (a `bpmiq.yml` above the file), see [design-iq](#design-iq-the-design-profile-and-validators) |

### `new`

Creates a file with one empty process. `--name` gives the process a name and
drives its id and the definitions' id (`Process_OrderHandling`,
`Definitions_OrderHandling`); `--id` sets the process id explicitly (a
speaking one names the definitions too: `--id Process_Billing` ->
`Definitions_Billing`); without either they are `Process_1` and
`Definitions_1`. The process is executable unless `--no-executable`.
`--target camunda8` declares the `zeebe:` and `modeler:` namespaces with
`modeler:executionPlatform="Camunda Cloud"` and `modeler:executionPlatformVersion="8.9.0"` (in such a file new
user tasks get `zeebe:userTask` and new event definitions an id, like the
Modeler; see [Camunda 8](#camunda-8)),
`--target camunda7` the `camunda:` and `modeler:` namespaces with
`modeler:executionPlatform="Camunda Platform"`,
`modeler:executionPlatformVersion="7.24.0"` and
`camunda:historyTimeToLive="180"` on the process, which is what Camunda
Modeler writes: Camunda 7.20+, CIB seven and Operaton refuse to deploy an
executable process without a time to live. A process created later in a
Camunda 7 file (a new participant) gets the TTL too; change it with
`bpmn set <file> <processId> camunda:historyTimeToLive=30`. Use `camunda7` for
CIB seven and Operaton as well (they read the `camunda:` namespace); any other
value fails with `E_USAGE`. Refuses to overwrite an existing file
(`E_FILE_EXISTS`) unless `--force`.

### `show` and `find`

`show <file>` starts with a `namespaces:` line (declared vendor namespaces,
if any) and the collaboration when there is one: its pools, its message
flows with the names of their endpoints (`messageFlow Flow_Decision
"Decision": Activity_SendDecision "Send decision" -> Participant_Customer
"Customer" [message Decision]`) and the text annotations it owns (`~` names
what they are attached to). Then it
prints every process in flow order: depth-first from the start events,
following the outgoing flows in declaration order (so a join and what follows
it appear under the first branch that reaches it); unreachable nodes follow,
flagged. Every flow is written as `-> Target (Flow_n "label" if condition)`.
Boundary events are indented under their host, sub-process children under the
sub-process. Every node that is a lane member carries its lane as
`lane=<laneId>` (the deepest lane; the nodes inside a sub-process are in the
sub-process's lane). Then the lanes as a tree of names, data, annotations,
root messages/errors/signals and
the validation findings (`problems: none` when there are none). Vendor
attributes appear with their values next to the properties, nested ones under
their `set` keys, and repeated extension types are counted:
`userTask Activity_Review "Review" [loop=parallel, camunda:assignee=demo,
loop.camunda:collection=${items}, ext: camunda:taskListener x3]`; a business
rule task shows its decision link as `calledDecision=<id>` whatever the
spelling (see [`set`](#set)), and a node of a Camunda 8 file
its zeebe settings the same way (`job=`, `calledElement=`, `script=`,
`form=`, `assignee=` / `candidateGroups=` / `candidateUsers=`,
`inputCollection=` / `inputElement=` / `outputCollection=` /
`outputElement=`; a message its `correlationKey`). The process
line carries the process's own (`process P "P" executable
[camunda:historyTimeToLive=180, ext: camunda:executionListener]`); flows show
`language=`, their vendor attributes and extensions, and a script resource
condition reads `if resource deployment://check.groovy`. `show <file> <id>`
prints everything about one element: settable properties, flows in and out
with labels and conditions, host, lane, scope, extension elements as an
indented tree (children two spaces deeper than their parent) and vendor
attributes; a nested element adds `definition.id`, `definition.camunda:...`,
`loop.camunda:...`, `condition.camunda:resource` and `<slot>.extensions:`.
It also lists the element's message flows with the partner at the other end
(`message flows: out Flow_Decision "Decision" -> Participant_Customer
"Customer"`; `in ... <-` for incoming ones, the partner's pool when the
partner is inside one), the text annotations associated with it, the data
objects / stores it `reads:` and `writes:` (a data element: `read by:` /
`written by:`) and, for an annotation, what it is `attached to:`
(`messageFlows`, `annotations`, `data`, `attachedTo` in `--json`).
`--json` has the same: `attrs` (vendor values), `extensionElements` (types in
order, repeats included), on flows `conditionResource` and `language`, and in
the element detail `nested: {definition|loop|condition: {type, id, attrs,
extensions}}`; `extensions` keeps its meaning (types and attribute names).
An event with several event definitions lists each under its selector
(`definition[0].id`, `definition[1].camunda:...`; the model view flags it with
`definitions=message+timer`). A multi-line body (a script) is printed as
`body:` followed by one `| <line>` per line, so it can be rebuilt verbatim;
`--json` keeps the raw string. Import warnings (content the reader could not
keep, see [Limitations](#limitations)) come first as `import:` lines.
`--scope <id>` restricts the view to one process / sub-process / participant.
`find` is a case-insensitive substring search over ids and names, optionally
filtered by `--kind`; it also matches vendor attribute values (topic,
assignee, candidate groups, listener class, extension element attributes and
bodies, nested elements) and then prints the match
(`serviceTask Activity_Charge "Charge"  (in P)  [camunda:topic=charge-card]`,
`match` in `--json`). With a non-empty text, event definitions and loop
characteristics are found by their id too.

`show <file> --layout` prints the drawing instead of the model, still without
coordinates: per diagram the frames as a tree (pools, lanes, expanded
sub-processes) and in each frame the flow nodes as rows, `row 1: c0 id, c1 id,
...` top to bottom and left to right (centres within a quarter row spacing
share a row; boundary events follow their host and are not listed), then the
coloured elements, the labels that are not on their default side, and the
layout problems with ids (the same list as `bpmn metrics`). Every node carries
its column across the whole diagram (`c0` .. `cN`: centres within half a gap
share a column), so x order can be compared across lanes and pools; the
`columns:` line names the wide empty gaps between two neighbouring columns
(more free width than one column of the drawing: room `compact` can close),
and ` … ` instead of `, ` marks such a gap inside a row (a row that merely
shares a y with an unrelated cluster). `--json` gives the same data
(`diagrams[] {id, root, columns, gaps: [{after, width}], groups: [{id, kind,
name, parent, rows, columns, gaps?: [{row, before}]}]}`, `colors`, `labels`,
`metrics`).

```
$ bpmn show order.bpmn --layout
diagram BPMNPlane_Collaboration_OrderHandling (Collaboration_OrderHandling)
  columns: c0..c4
  participant Participant_OrderHandling "Order handling"
    lane Lane_Sales "Sales"
      row 1: c0 Event_OrderReceived, c1 Activity_CheckInvoice, c2 Gateway_InvoiceOk, c3 Activity_BookInvoice, c4 Event_Done
      row 2: c3 Activity_ClarifyInvoice, c4 Event_Clarified
    lane Lane_Backoffice "Backoffice"
colors: Activity_CheckInvoice red, Flow_CheckInvoiceToInvoiceOk red
labels off their default side: Gateway_InvoiceOk below (default above)
layout quality: score 0: no layout problems
```

#### Reading large models: `show --around` and `show <id> --context`

The whole model view of a large model runs to 15–40 KB. Two views answer
the questions of a local edit for a fraction of that; both address elements
by id only (names may repeat).

`show <file> --around <id> [--depth <n>]` prints the neighbourhood of an
element: everything within `--depth` flow steps (default 2; 0 is the element
alone) along sequence flows in both directions. A boundary event and its host
are neighbours, so are a throwing and a catching link event of one name; the
first and last node of a sub-process lead out to the sub-process, and with
`--inner` the window also enters sub-processes from outside (their first and
last nodes are neighbours of the sub-process). A sequence flow as `<id>`
starts from both its ends. The nodes come in flow order in the grammar of
`show` (nested like there), each with its lane, its vendor values and a
compact summary of its extension elements (`io: in policyId; out covered`,
`zeebe:taskDefinition type=charge-card retries=3`, `camunda:in x8`); a
sub-process the window does not enter says how many nodes it holds
(`content: 4 nodes`), a sub-process outside the window that holds window
nodes is a heading (`in subProcess Activity_Assess "Assess claim"
[lane=Lane_Office]:`), and an incoming flow from outside the window follows
`<-`. The header says what is shown and what was left out; the message
flows, annotations and data of the window's nodes close it:

```
$ bpmn show claims.bpmn --around Activity_Pay --depth 1
around Activity_Pay (depth 1): 3 of 16 nodes, 3 of 12 flows; 13 nodes, 9 flows omitted
process Process_Claims "Claims" in Participant_Insurer "Insurer"
  exclusiveGateway Gateway_Covered "Covered?" [lane=Lane_Clerks] <- Activity_Assess (Flow_ToCovered) -> Activity_Pay (Flow_Covered "yes" if ${covered}), Activity_SendDecision (Flow_NotCovered "no" default)
  serviceTask Activity_Pay "Pay claim" [lane=Lane_Clerks, camunda:type=external, camunda:topic=pay-claim] -> Activity_SendDecision (Flow_PaidToDecision)
  sendTask Activity_SendDecision "Send decision" [lane=Lane_Clerks, camunda:type=external, camunda:topic=send-decision] -> Event_Done (Flow_ToDone)
message flows:
  messageFlow Flow_Decision "Decision": Activity_SendDecision "Send decision" -> Participant_Customer "Customer"
annotations:
  TextAnnotation_Pay "Paid by bank transfer" ~ Activity_Pay
  TextAnnotation_Sla "Answer within 5 days" ~ Activity_SendDecision
data:
  dataObject DataObjectReference_ClaimFile "Claim file" (to Activity_Pay)
```

`show <file> <id> --context` prints the element in its context, one line
each: `implementation:` (vendor values and extension elements, compact),
`in:` (pool > process > sub-processes), `lane:` (a node inside a sub-process
is in the sub-process's lane: `via`; nested lanes: `within`), `host:` (a
boundary event), `from:` / `to:` (the neighbours with their names and the
connecting flows), `boundary:` (its own boundary events), `caught by:` (the
boundary events of every kind on the sub-processes around it, inner first:
an interrupting one cancels the element with its sub-process, a
non-interrupting one is marked, an error / escalation one catches what it
throws), `event sub-processes:` (those of every scope around it, with their
start event), `annotations:`, `message flows:` (with the partner and its
pool) and `reads:` / `writes:`. A message event or send / receive task also
gets `message:` (the message's id, name and Camunda 8 correlation key) and,
among its message flows, those of its message drawn to its pool instead of
to the element (`(at pool <id>)`; a flow without `messageRef` counts when it
has the message's name); a message flow gets `message:`, `in:
collaboration <id>` and `from:` / `to:` with the pool of each end; a
message, signal, error or escalation gets `used by:` (the events, tasks and
message flows that name it). Lines without content are left out:

```
$ bpmn show claims.bpmn Activity_RateDamage --context
userTask Activity_RateDamage "Rate damage"
implementation: camunda:assignee=clerk
in: participant Participant_Insurer "Insurer" > process Process_Claims "Claims" > subProcess Activity_Assess "Assess claim"
lane: Lane_Office "Office" (via Activity_Assess)
from: serviceTask Activity_CheckPolicy "Check policy" (Flow_ToRate)
to: endEvent Event_AssessEnd "Assessed" (Flow_ToAssessEnd)
caught by: boundaryEvent:error Event_FraudSuspected "Fraud suspected" on Activity_Assess [error Fraud (FRAUD)] -> Activity_Investigate
event sub-processes: eventSubProcess Activity_OnCancel "Handle cancellation" in Process_Claims [startEvent:message Event_CancelRequested "Cancellation requested" [message Cancel, non-interrupting] -> Event_Cancelled]
writes: DataObjectReference_ClaimFile "Claim file"
```

(`test/fixtures/views/claims.bpmn`.) `--json` gives the same data
(`AroundView`: `around`, `depth`, `inner`, `process`, `scopes`, `nodes` with
`scope`, `distance`, `lane`, `impl`, `outgoing`, `from`, then `messageFlows`,
`annotations`, `data`, `shown`, `omitted`; `ElementContext`: `ancestors`,
`pool`, `lane`, `host`, `from`, `to`, `boundary`, `caughtBy`,
`eventSubProcesses`, `annotations`, `messageFlows` (`at`: drawn to the
pool), `message`, `usedBy`, `data`, `implementation`). On 278 real models (private corpora, centred on the
middle activity) the neighbourhood (depth 2) is 1.2 KB in the median (p90
2.1 KB) against 2.3 KB (7.6 KB) for the whole model and 1.4 KB (2.4 KB) for
PR #218's `outline --around`; on the 30 models with 30 flow nodes or more it
is 1.8 KB against 10.6 KB (17 % in the median, p90 24 %).

### `add`

`add <file> <kind[:trigger]> [name]` creates one element and wires it in
(see [Kinds](#kinds), [Triggers](#triggers) and the
[placement grammar](#placement-grammar)). Trailing `key=value` pairs are
applied like `set` (`camunda:assignee=kermit`). `--doc` sets the
documentation, `--lane` the lane (default: the lane of the anchor or host;
`--flow`: of the flow's source), `--collapsed` draws a sub-process
collapsed, `--if-absent` together with `--id` makes the command idempotent.
A node added into a flow between two lanes without `--lane` gets the lane of
the row the layout puts it on: after a branching node (a gateway) the
target's row and lane, else the anchor's; `W_LANE_INHERITED` names both
lanes and the `move --lane` that switches. With `--lane` the row follows
the lane: a node whose lane is not the target's goes on a free row of its
own lane (a new one when none is free), never on the target's row with its
lane stretched over to it. `--message <name>` also works for
`sendTask` and `receiveTask` (the root `bpmn:Message` is found by name or
created), like `set <id> message=<name>`.

Non-flow-node kinds: `participant` (pool; the first one wraps the existing
process, further ones get a new process, `--process <id>` binds an existing
unbound process, `--black-box` creates a pool without a process and never
wraps, so on a file without pools add a normal participant first), `lane`
(`--in <process|participant|lane>` for nesting, `--members <id,...>`),
`dataObject` / `dataStore` (`--in <process|subProcess|participant>` only),
`textAnnotation` (`--text`, `--in` only). Wire data and annotations
afterwards with `connect`.

### `connect`

The connection kind is inferred from the endpoints:

- two flow nodes in the same scope: **sequence flow** (`--name`, `--condition`,
  `--language`, `--default`, `--id`); a second outgoing flow of a non-gateway
  warns `W_IMPLICIT_SPLIT`, a second incoming flow `W_IMPLICIT_JOIN`;
- endpoints in different pools (or a pool itself): **message flow**
  (`--message <name>` references a root `bpmn:Message`); gateways cannot be
  message endpoints;
- a text annotation on either side: **association**;
- a data object / store on one side: **data association** (node -> data is an
  output, data -> node an input).

`--if-absent` succeeds silently when the same connection already exists;
without it a second sequence or message flow between the same two elements is
created with `W_DUPLICATE_FLOW` (the target would run twice).

### `set`

`set <file> <id> key=value ...` changes properties; `key=` (empty) or
`--unset key` removes one. See [Set keys](#set-keys). Renaming an id
(`id=New_Id`) re-points every reference, including `calledElement` strings
and the id-valued attributes the Camunda descriptor knows inside extension
elements (`camunda:errorEventDefinition errorRef`). Nested elements without
an id of their own take a prefix: `definition.<key>` (the event definition),
`loop.<key>` (the loop characteristics) and `condition.<key>` (the condition
expression), e.g. `set Activity_Review 'loop.camunda:collection=${items}'`; a
`camunda:` attribute that belongs on such a nested element (or a process
attribute given to its participant) is refused on the parent with
`E_WRONG_HOST`, whose hint names the right key. A `camunda:` attribute the
descriptor types as Boolean (`asyncBefore`, `exclusive`, ...) is written as
exactly `true` / `false` (`yes`, `1`, `TRUE` are normalised; the engines read
only the exact `true`); other values fail with `E_INVALID_VALUE`. The same
rules apply to Operaton's own namespace (`operaton:asyncBefore`, see
[Camunda 7](#camunda-7)). A `zeebe:` attribute that Camunda 8 reads on a
zeebe extension element (`zeebe:assignee`, `loop.zeebe:inputCollection`) is
refused with `E_WRONG_HOST`; the hint is the `ext add` that writes it (see
[Camunda 8](#camunda-8)). `zeebe:correlationKey` on a catch event or receive
task (or on a bpmn:Message) is written into the `zeebe:subscription` of the
message the element waits for, with a note; on an element that waits for no
message it is `E_WRONG_HOST`. `completion=` on an ad-hoc sub-process without
a multi-instance loop sets its own completion condition.

An event with several event definitions (BPMN "multiple"; the engines act on
one of them only) needs a selector: `'definition[1].<key>=...'` (0-based) or
`'definition[timer].<key>=...'`; a plain `definition.` key fails with
`E_AMBIGUOUS_NESTED` listing them, a selector that matches nothing with
`E_NO_NESTED_ELEMENT`. Quote the brackets in a shell. `set <id>
trigger=<t>` keeps the definition of that trigger and reports the others as
dropped. `definition.activityRef` of a compensation event must name an
activity of the event's own (sub-)process (from an event sub-process also one
of the scope around it), else `E_CROSS_SCOPE`: the engines refuse anything
else. An attribute without prefix that BPMN does not define (a hand-edited
`assignee="..."`, which the engines refuse) is removed with `<attr>=`
(also `definition.<attr>=`); it cannot be set.

`calledDecision=<decision>` links a business rule task to the DMN decision
it calls, in the spelling of the file's platform: an unprefixed
`calledDecision="<decision>"` in a design model (no engine namespace, what
Miragon's design-iq writes, its hard rule 5), `camunda:decisionRef` in a
Camunda 7 file (`operaton:decisionRef` in an Operaton-only one) and a
`zeebe:calledDecision decisionId` extension element in a Camunda 8 file (an
existing `resultVariable` is kept; without one `W_DECISION_RESULT_VARIABLE`
says Camunda 8 needs it). The other spellings are removed (also a
hand-written unprefixed `calledElement`), so a task never carries two links;
the change line names what was removed. An empty value removes the link in
every spelling. In a Camunda 7 or 8 file the unprefixed attribute is never
written (the engines validate the file against the BPMN schema and refuse
it): `set <id> calledDecision=<d>` there converts a hand-written one into the
engine's spelling, which is the fix the `W_C7_DEPLOY_SCHEMA` finding names.
`show`, `show <id>` and `find` read every spelling (`calledDecision=risk` on
the node line, also `match` in `find`). On another element the key is
`E_UNKNOWN_KEY` (an unprefixed `calledDecision` there is still removed with
`calledDecision=`).

Conditions are changed in place: `condition=` keeps the expression's id and
vendor attributes. An inline body replacing a script resource drops
`camunda:resource` and its language, and a `${...}` body does not inherit a
script language (both `W_PROPERTY_DROPPED`; pass `language=` to keep one).
`language=` also works on a resource condition; `condition=
condition.camunda:resource=<uri> language=groovy` switches an inline condition
to a script resource. The same rules apply to `when=` on conditional events.
Removing the script resource of a condition that has no inline body
(`condition.camunda:resource=` alone) is refused with `E_INVALID_VALUE`: it
would leave an empty condition, which deploys and fails every evaluation.
Give the inline condition in the same command (`condition.camunda:resource=
'condition=${ok}'`, `when=` on a conditional event) or remove the whole
condition (`condition=`).
`loop=none` / `loop=standard` (and standard -> multi-instance) report the
dropped vendor content of the old loop (`W_PROPERTY_DROPPED`).

### `remove`

Cascades: a flow node loses its flows, boundary events (recursively), data
associations, associations, message flows, lane membership and default-flow
references; sub-process children go with it. A node with exactly one incoming
and one outgoing flow is **bridged** (predecessor -> successor, carrying the
label/condition over) unless `--no-bridge`. A merge (several incoming flows,
one outgoing) that does not synchronise, such as an exclusive gateway or a
task two paths flow into, is bridged from every predecessor like
`--bridge-all` (each path already ran on alone; note `bridged all: ...`). A
synchronising join (parallel, inclusive, complex gateway) is refused with
`E_AMBIGUOUS_BRIDGE`, because bridging ends the synchronisation and not
bridging cuts off its successor: the hint names both commands
(`bpmn remove <file> <id> --bridge-all`, `--no-bridge`). A lane un-assigns its members; a
participant takes its process and message flows along (the collaboration is
dropped when no pool remains); a data object reference also removes its
`bpmn:DataObject` when unused. Associations on a flow that bridging replaces
(a note on the removed node's outgoing flow) move to the bridging flow; a
flow removed without a bridge takes its associations along. A removed flow is
also dropped from stale `incoming` / `outgoing` entries of other nodes (files
from other tools sometimes carry them). `--if-exists` skips unknown ids with
a note.

`--bridge-all` bridges a join or merge (several incoming flows, one
outgoing): every incoming flow is re-pointed to the successor (keeping its
label and condition; a predecessor already connected to the successor, or
the successor itself, gets no second flow) and the outgoing flow goes. A
parallel or inclusive join loses its synchronisation; `W_IMPLICIT_JOIN` says
so. A node with several outgoing flows is refused (`E_AMBIGUOUS_BRIDGE`:
which predecessor would go to which successor?).

`--with-branch` removes a node or boundary event together with its exclusive
downstream path: every node only it leads to (all incoming flows from the
branch; a host takes its boundary events and their paths along, a
compensate boundary event its compensation handler), up to the next node
another path reaches (it stays, the flows into it go) or the ends. Nothing
is bridged; a note lists the branch and where it stopped
(`branch of Event_Reminder: 3 node(s) (...); it ends there`). A node several
paths reach (two or more incoming flows) is refused (`E_AMBIGUOUS_BRANCH`):
remove the branch from the first node after the split, or the node alone
with `--bridge-all`. `apply`: `"bridgeAll": true`, `"withBranch": true`.

A bridge from an event-based gateway is made only when the file's rule
accepts it. In a Camunda 7 file that is the engines' rule: the successor is a
message / timer / signal / conditional intermediate catch event without other
incoming flows, and no other branch waits for the same message or signal
name. Other files follow BPMN 2.0: catch events with those triggers or
receive tasks without boundary events, receive tasks not mixed with message
catch events behind one gateway, no other incoming flow. Otherwise the
command fails with `E_INVALID_BRIDGE` (the message says which rule applied)
and writes nothing: use `--no-bridge`, insert a catch event first, or remove
the successor in the same command. This applies to `move` as well, which
bridges the old place the same way. An edge the agent asks for explicitly
(`connect`, `add --after` / `--flow` / `--before`, a `move` placement) is not
refused: a plain file warns `W_EVENT_GATEWAY_TARGET`, a Camunda 7 file gets
the profile's `W_C7_DEPLOY_EVENT_GATEWAY`.

### `retype`

Changes the kind keeping id, name, documentation, extension elements, vendor
attributes, flows, boundary events and lane membership. Allowed within a
family: task <-> task / subProcess / callActivity, gateway <-> gateway, event
<-> event of the same position (start / end / catch / throw / boundary), plus
trigger changes (`retype <id> startEvent:message --message OrderReceived`).
A kind token without trigger suffix keeps the event's current trigger
(`retype Event_X startEvent` on a message start is a no-op); drop it with
`retype Event_X startEvent:none` or `set Event_X trigger=none`. Properties
the new kind does not have are dropped with `W_PROPERTY_DROPPED`. Vendor
attributes and extension elements are kept; the `camunda:` ones the new kind
cannot use (the Camunda descriptor decides: `camunda:assignee` on a service
task, `camunda:topic` on a user task, a `camunda:taskListener` outside a user
task; `operaton:` content alike) are named in one `W_PROPERTY_INAPPLICABLE`
warning with the commands that remove them. In a Camunda 7 file the profile
reports each of them as `W_C7_MISPLACED_ATTRIBUTE` / `W_C7_MISPLACED_EXTENSION`
(with severity and a remove command each); a write then drops the summary, so
every item is reported once. The same for `zeebe:` content the Zeebe
descriptor does not allow on the new kind (`zeebe:assignmentDefinition` on
a service task; `W_C8_MISPLACED_EXTENSION` in a Camunda 8 file), and a task
retyped to a `userTask` in a Camunda 8 file gets `zeebe:userTask`. A
sub-process with content becomes a task or call activity only with `--force`:
without it the command fails with `E_WOULD_DROP_CONTENT` and lists every
element that would be deleted (move what should stay out first, `move ...
--in`); an empty sub-process retypes freely. A `complexGateway` (not
supported) can be retyped to a supported gateway.

### `move` and `order`

`move` detaches the nodes (bridging their old place), then places them again
with the placement grammar; `--in` moves into another scope without
connecting (flows that would cross scopes are removed and reported);
`--lane` assigns a lane and may be combined with a placement. Without
`--lane`, a node in a lane keeps it when it moves within its process (a note
says so when the flow it went into runs between two other lanes); a node
without a lane at its new place (out of a sub-process, from another pool, or
one that had none) gets one like `add` gives it: the anchor's, and in a flow
between two lanes the lane of the row the layout draws it on (the target's
after a branching node), with `W_LANE_INHERITED`. A node that keeps its
lane is drawn on a row of that lane, like `add --lane`. Boundary events
travel with their host; `move --on` (like `add --on`) refuses a compensation
handler (`isForCompensation=true`) as host (`E_INVALID_HOST`). The bridge left
behind follows the event-based gateway rule of [`remove`](#remove)
(`E_INVALID_BRIDGE`). `order <nodeId> <flowId...>` sets the declaration
order of a node's outgoing flows; unlisted flows keep their relative order
after the listed ones. The picture follows the branch rule of
[the DI contract](#the-di-contract): the default flow (else the first flow)
is the straight continuation, the other branches alternate below and above
it in declaration order; to pin a branch as the continuation make it the
default (`set <flowId> default=true` or `set <gatewayId> default=<flowId>`).

`order <poolId|processId|laneId> <laneId...>` orders lanes instead (the ids
are lanes): the lanes of a pool (or of its process) or the child lanes of a
lane, top to bottom; unlisted lanes follow in their old order, a lane of
another level is refused (`E_NOT_CHILD_LANE`). It rewrites `laneSet.lanes`,
and a kept drawing gets its bands reordered with their content (a band whose
members hang out at its bottom, such as a boundary event on the border, grows
with the pool, so nothing ends up outside it).

`order <collaborationId> <participantId...>` orders the pools (the ids are
participants, black-box partner pools included; ops JSON `"pools"`): top to
bottom, unlisted pools follow in their old order, a participant of another
collaboration is refused (`E_NOT_PARTICIPANT`). It rewrites
`collaboration.participants`; a kept drawing restacks the pool bands in the
slots of the old order (each pool keeps its height and x, the gaps between the
slots stay) with their content and the collaboration-level artifacts drawn in
them, and routes the message flows again. Pools that are not stacked top to
bottom keep their places (a note says so). A full redraw (`bpmn layout`)
orders pools by its own rule (fewest message flows crossing other pools,
declared order on ties).

### `ext`

Vendor extension elements inside `<bpmn:extensionElements>`. The sub-command
comes first, then the file and the element id:

```
bpmn ext add <file> <id> <type|path> [attr=value ...] [--body <text>] [--xml <snippet>] [--replace]
bpmn ext remove <file> <id> <selector|index>
bpmn ext list <file> <id> [--json]
```

`ext add` creates one element from `<prefix:type> attr=value ... [--body
<text>]`, or takes a raw snippet with nested elements (`--xml`). The
namespace comes from the file or from the known prefixes (`camunda`,
`operaton`, `zeebe`, `modeler`, `bioc`, `color`); other prefixes must be declared in the file
(`E_UNKNOWN_NAMESPACE`). The file's own prefixes are used: a snippet that
binds a namespace the file already declares under another prefix is mapped to
the file's prefix, never declared twice. The structure the engines expect is
kept:

- **Child types go into their container**, created when missing:
  `camunda:inputParameter` / `camunda:outputParameter` -> `camunda:inputOutput`,
  `camunda:formField` -> `camunda:formData`, `camunda:property` ->
  `camunda:properties`, `camunda:connectorId` -> `camunda:connector`;
  `zeebe:input` / `zeebe:output` -> `zeebe:ioMapping`, `zeebe:header` ->
  `zeebe:taskHeaders`, `zeebe:property` -> `zeebe:properties`. Children are
  kept in the schema order (inputs before outputs).
- **Single-instance containers are merged, never duplicated**:
  `camunda:inputOutput`, `formData`, `connector`, `failedJobRetryTimeCycle`,
  `properties`; `zeebe:ioMapping`, `taskHeaders`, `properties`,
  `taskDefinition`, `formDefinition`, ... A second one merges its attributes,
  value and children into the first; a conflicting attribute or value fails
  with `E_DUPLICATE_EXTENSION`, and `--replace` replaces the whole element.
  (Camunda 7.24, CIB seven 2.2 and Operaton 2.1 refuse two `inputOutput`,
  `formData`, `connector` or `failedJobRetryTimeCycle`, and two
  `connectorId`, `validation`, form-field `properties` or listener `script`,
  with ENGINE-01009; `camunda:properties` is merged because the Modeler reads
  one.)
- **An item with the same key replaces the old one**, and the replacement is
  reported. Keys: `name` for parameters, properties and fields, `id` for form
  fields, `target` for `zeebe:input` / `zeebe:output`, `key` for
  `zeebe:header`. What the old item held and the new one does not (attributes,
  value, children such as a form field's validation) is reported as
  `W_PROPERTY_DROPPED`, whose hint is the `ext add ... --xml '...'` that adds
  the item again with everything (not with `--replace`, which asks for the
  whole item).
- **Operaton's namespace** (`operaton:`) follows the same rules by local
  name: `operaton:inputParameter` goes into an `operaton:inputOutput`, which is
  merged like the camunda one. A `camunda:` and an `operaton:` container are
  kept apart (Operaton reads one of each, Camunda 7 and CIB seven only the
  camunda one).
- **A `zeebe:subscription` goes on the message.** Camunda 8 reads the
  correlation key on the bpmn:Message a catch event or receive task waits
  for, so `ext add <event|receiveTask> zeebe:subscription ...` writes it
  there and notes it (naming the other elements that wait for the same
  message); an element that waits for no message is `E_WRONG_HOST`, with the
  `set ... message=` to run first. Camunda 7 has no such element, so nothing
  changes there.
- **Paths reach nested containers**:
  `'camunda:connector/camunda:inputParameter' name=url --body https://...`,
  `'camunda:formField[id=amount]/camunda:validation/camunda:constraint'
  name=min config=1`. Only attribute-free containers are created along a
  path; a listener or form field must exist first and is selected with
  `[attr=value]` or `[n]`.
- **`--xml`**: `<type>` names the snippet's root elements (a path type names
  their container); a mismatch fails with `E_INVALID_VALUE`, and `--xml`
  cannot be combined with `attr=value` or `--body` (`E_USAGE`). `bpmn:`
  elements are accepted inside a vendor element, e.g. a timeout task listener
  (`<camunda:taskListener event="timeout" ...><bpmn:timerEventDefinition>...`)
  or `camunda:potentialStarter` with a `bpmn:resourceAssignmentExpression`;
  never at the top level.
- `ext add` on `bpmn:definitions` is refused (`E_WRONG_KIND`; the BPMN schema
  has no extension elements there): use the process. Content the engines
  would not read where it was put (a loose `camunda:constraint` or
  `camunda:value`, `camunda:field` on a user task, a zeebe element the Zeebe
  descriptor does not allow there such as `zeebe:taskDefinition` on a user
  task) is added with `W_MISPLACED_EXTENSION` and a path hint.

`ext remove` takes a selector: a bare type removes every element of that type
at the top level (a child type: inside its container),
`'camunda:inputParameter[name=customerId]'` removes one item,
`'camunda:formField[1]'` one by index, paths such as
`'camunda:executionListener[1]/camunda:field[name=x]'` reach deeper. Values
may be quoted (`[name="a b"]`). A predicate that is not found directly is
searched deeper, and refused with `E_AMBIGUOUS_EXTENSION` when it matches in
several places. A container left empty is removed with its last child. An
index from `ext list` works too (`2`, `loop.0`, `definition[1].0`; also as the
ops JSON `type`). Quote selectors in zsh: `[` and `]` are glob characters.

Nested elements without an id hold extension elements as well (a retry cycle
on a multi-instance loop, `camunda:in` on a signal event definition,
`camunda:field` / `camunda:connector` on a message event definition): give
the type or selector the same prefix as the nested `set` keys,
`loop.camunda:failedJobRetryTimeCycle`, `definition.camunda:in`,
`condition.<type>`; in `ext remove` also `loop.0`. `ext add <id>
loop.zeebe:loopCharacteristics ...` creates a parallel multi-instance loop
on an activity that has none (Camunda 8's multi-instance settings live
there). One of several event definitions: `'definition[1].camunda:field'` (or `definition[<trigger>].`).
`ext list` prints the element's own extension elements and then those of its
nested elements (`loop.0: ...`, `definition[1].0: ...`), each as an indented
tree (a multi-line body as `body:` plus `| <line>` lines); `--json` gives the
full tree with a `slot` field on nested items.

```
$ bpmn ext add claim.bpmn Activity_CheckCoverage camunda:inputParameter name=amount --body '${amount * 100}'
changed serviceTask Activity_CheckCoverage "Check coverage" - ext replaced camunda:inputParameter[name=amount] in camunda:inputOutput
$ bpmn ext list claim.bpmn Activity_ApproveClaim
0: camunda:formData
     camunda:formField id="approved" type="boolean"
       camunda:validation
         camunda:constraint name="required"
```

Ids inside vendor extensions (a `camunda:formField id="email"`) are not BPMN
ids: they never clash with BPMN ids or with each other, they are kept
untouched on every write, and `show` / `set` / `remove` on such an id fail
with `E_NOT_FOUND` naming the vendor element and the BPMN element that owns
it.

### `apply`

Runs a JSON list of ops as one transaction with one layout pass at the end.
See [Ops JSON](#ops-json-bpmn-apply).

### `validate` and `layout`

`validate` runs the structural checks (errors, exit 2), the lint rules
(warnings, exit 5 with `--strict`), the engine profile of the file's platform
and a layout dry run, without writing; it prints the findings, a `platform:`
line, `layout: ok|skipped|failed`, and `valid, n warning(s)` or `n error(s),
m warning(s)` (plus `k import warning(s)` when the reader reported any; they
are printed first as `import:` lines and fail `--strict` too). The platform
is detected from `modeler:executionPlatform` ("Camunda Platform", "Camunda
7", "Operaton", "CIB seven" -> `c7`; "Camunda Cloud", "Camunda 8" -> `c8`),
else from the vendor namespace the content uses (`camunda:` -> c7, CIB seven
and Operaton files included; `operaton:` -> c7 as well; `zeebe:` -> c8), else
from a declared namespace (both camunda and zeebe declared without content:
`none`, the detail says so), else `none`; `--platform auto|c7|c8|none`
overrides it (another value: `E_USAGE`, exit 1). The same detector decides
which defaults the CLI writes (`Doc.platform()`, e.g. the TTL of a new
process). A file that uses Operaton's namespace is checked the way Operaton
reads it: `operaton:*` first, `camunda:*` as the fallback; only Operaton reads
that namespace, Camunda 7 and CIB seven ignore it, which the detail line says
(`3 operaton attribute(s)/element(s); only Operaton reads the operaton
namespace, Camunda 7 and CIB seven ignore it`) and `--json` flags as
`"operaton": true`. Camunda 7 ([Camunda 7](#camunda-7)) and Camunda 8
([Camunda 8](#camunda-8)) have rules (plain BPMN has none): the findings
are warnings named `W_C7_*` / `W_C8_*` with a `severity` (`deploy`: the
engine refuses the file, codes `W_C7_DEPLOY_*` / `W_C8_DEPLOY_*`;
`runtime`: it deploys but the setting is ignored or fails when it runs;
`practice`: it works, the engine logs a warning), so `--strict` exits 5 on
them. `--json` adds `"platform": {"platform", "source", "detail", "counts":
{"deploy", "runtime", "practice"}}`. Only executable processes are checked
(the engines skip the others; Camunda 7 also the content of ad-hoc
sub-processes, which Camunda 8 checks; Camunda 8 refuses a file without an
executable process), plus file-level content and the BPMN schema rules,
which the engines apply to the whole file (an attribute BPMN does not define, a conditional event definition
without condition, a link definition without name, also next to another
definition the engines ignore). Every write runs the
profile before and after and reports only the findings the change introduced
(JSON `validation.platform` with `added`, `resolved` and the totals in
`counts`), so a file's old problems are not repeated on every write; `bpmn
show` does not run it.

`--profile auto|design|none` selects the validation profile, independent of
the platform: `design` checks the file against design-iq's save gate (see
[design-iq](#design-iq-the-design-profile-and-validators)); its errors
(`E_DESIGN_*`) are errors of `validate` (exit 2), its warnings
(`W_DESIGN_*`) warnings, each line tagged `[design]`, followed by a
`validator design (<why it ran>): n error(s), m warning(s) in the file`
line. `auto` (the default) runs it for the models of a design-iq content
repository; `--json` adds `"profile": {"profile", "source", "detail"}` and
`"validators": [{"name", "detail", "errors", "warnings", "counts"}]`. The
validators read the file's own diagram (before the layout dry run).

`layout` redraws the whole diagram from the
model (a hand layout is replaced, colours and DI ids survive); `--expand` /
`--collapse` change which sub-processes are drawn expanded. `layout --tidy`
keeps the drawing instead and only removes overlaps (= `bpmn tidy`).

### `metrics`

`metrics <file>` measures the drawing: `score <n>: <kind> <count>, ...` and
one line per problem with the element ids, e.g. `overlaps [Activity_A,
Activity_B]`, `through [Flow_3, Gateway_X]` (a flow through a shape),
`outsideLane [Activity_A, Lane_Sales]`, `crossings [Flow_1, Flow_7]`,
`labelOnLine [Event_End, Flow_2]`. The kinds and weights are those of the
layout regression harness (`tools/layout-regress.mjs`) plus three structural
kinds the harness does not measure (the clean engine never produces them),
each weighted like an overlap: `frameIntrusion [Activity_A, Activity_Sub]`
(a shape inside an expanded sub-process, pool or lane that is not its own),
`frameOverlap [Lane_A, Lane_B]` (two sibling frames overlapping) and
`degenerateEdge [Flow_3]` (a connection with fewer than two distinct
waypoints). So the score of a drawing can be higher than the harness's.
`through` uses a real segment-rectangle test (a diagonal association passing
beside a shape does not count). Four soft drawing-quality kinds only the
library measures (weights below 6: never a hard defect for the bench and the
fuzzer): `backwardFlow [flow, source, target]` (the target's centre lies left
of the source, and the target does not lead back to the source: not a loop
return), `segmentOverlap [flowA, flowB, target]` (two flows into one target
run on top of each other for more than 20 px: they merge before it; a fork's
common first segment does not count), `labelOutsideFrame [owner, frame]` (a
named event, gateway, data or flow label reaching out of its sub-process or
pool) and `messageLabelFar [messageFlow]` (a message flow label more than
50 px from its line). `--json` gives `{file, score, counts,
problems: [{kind, ids, detail?}]}`. Every mutation reports the same
measurement before and after in its `layout.metrics` block, with the
problems it added and resolved.

### `kinds` and `guide`

`kinds` prints the kind table, trigger options, set keys, placement grammar
and the error catalogue; `kinds --json` adds the JSON Schema of the ops
format (`ops`), the example (`opsExample`), the validation profiles
(`profiles`) and the exit codes. `kinds --section <name,...>` prints only the
named parts (`kinds`, `triggers`, `setKeys`, `nestedKeys`, `zeebeElements`,
`placement`, `ops`, `layoutModes`, `ids`, `profiles`, `colors`, `errors`,
`exitCodes`;
case and dashes do not matter, `set-keys` works), with `--json` only those
keys (`ops` brings `opsExample`, `triggers` `nonInterrupting`, `nestedKeys`
`nestedSelectors`); an unknown name is `E_USAGE` with the list.

`guide` is the cheat sheet for agents (about 57 KB). `guide --short` is its
core in at most 5 KB: the contract, the reading views, the commands that
change a model, every op with its keys, the placement grammar and the most
common errors. `guide <topic>` prints the sections of one topic: `contract`,
`workflow`, `reading`, `output`, `layout`, `format`, `ops`, `placement`,
`triggers`, `errors`, `quoting`, `camunda7`, `camunda8`, `design`,
`commands` (an unknown topic is `E_USAGE` with the list).

## Layout modes

Every mutating command updates the diagram in one of three modes
(`--layout <mode>`; `--relayout` is `--layout full`, `--no-layout` skips it):

| mode | what happens |
| --- | --- |
| `auto` (default) | A file without diagram is drawn from scratch. A drawing that the engine made and nobody changed since (re-running the engine on the model as it was before the command reproduces every shape, label and connection within 2 px; flow nodes added with `--no-layout` are left out of that check) is redrawn in full, so it keeps the best global layout while the CLI owns it. Any other drawing, hand-made in a modeler or changed by a format command (also one that only reroutes a flow or moves a label), is kept: `incremental`. |
| `incremental` | Keep every existing shape and connection. New elements are placed next to their neighbours (splice: between predecessor and successor; a new branch: one row below the existing branches; a boundary event: on the host's bottom border; ...), room is made like the modeler's space tool, by the room that is missing (everything right of / below the spot moves, pools, lanes and the sub-processes holding the spot grow; another expanded sub-process the line crosses moves as a whole or stays, it is never stretched; connection labels move with their connection), removed elements' DI is pruned (and an empty column closed; when shapes in other rows reach into it, only the removed node's own row closes, if that tears nothing apart), lane changes move a node into its new lane, an activity whose new name does not fit grows (wider in steps of 20 px up to 200, then higher; never smaller), and only the connections that need it are rerouted (a gateway docks on its vertices, one connection per vertex while one is free). Untouched shapes keep their exact bounds, untouched connections their waypoints. If it fails, `auto` falls back to a full redraw (`W_LAYOUT_INCREMENTAL_FAILED`), an explicit `--layout incremental` fails with `E_LAYOUT_INCREMENTAL` instead. |
| `full` | Redraw everything with the engine (`--engine clean`, default, or `auto`). Colours (`bioc:` / `color:` attributes) and the DI ids are carried over by element id (new DI gets the file's id style); positions are not. `bpmn layout <file>` always does this. |

The result says which mode ran and why (`layout: ok - incremental (hand-made
diagram: kept, changes placed locally)`), lists what was placed / moved /
rerouted / pruned (`--json` also `reshaped`: connections the space tool
stretched without routing them again), and compares the layout quality before and after with the
problems added and resolved (`layout.metrics`, see [`metrics`](#metrics)).

Because a format command that changes the geometry (moves a shape, reroutes
a flow, moves a label) makes the drawing hand-made, formatting persists:
colour a path and place a branch, and the next `add` in `auto` mode keeps
both.

## Formatting without XML

Diagram-only commands: they never change the semantic model (except `order`
of lanes, which also reorders `laneSet.lanes`), need an existing diagram
(`E_NO_DIAGRAM`; a file without one is drawn first unless `--no-layout`), and
name other elements instead of coordinates. In an `apply` batch they run
after the semantic ops and the layout, in batch order, all or nothing.

| command / op | effect |
| --- | --- |
| `place <id...>` with `--row-of` / `--below` / `--above <id>` and/or `--column-of` / `--after` / `--before <id>` | Move the shapes as one rigid group so the first lands on the row (vertical centre) and/or column (horizontal centre) of another element; `below` / `above` keep one row of the drawing and clear the element, `after` / `before` one gap. Boundary events, labels and the content of an expanded sub-process follow; shapes in the way give way, frames grow (also for a label that reaches past their right or bottom border), flows are rerouted. `place --branch <flowId> --below <id>` moves a whole branch (see selectors below). |
| `align <id...> --axis row\|column [--to <id>]` | Put the shapes on one horizontal / vertical centre line, the one of `--to` (default: the first id; with only `--kind` and `--axis column`: the rightmost one, so nothing moves left). Shapes that would land on each other give way along the free axis. |
| `color <id...> --color blue\|orange\|green\|red\|purple\|default` | The bpmn-js colour picker colours on shapes and connections (`bioc:fill` / `bioc:stroke` / `color:background-color` / `color:border-color`, labels `color:color`); `default` removes them. `color --path <fromId> <toId> --color green` colours a whole path. |
| `label <id> --side above\|below\|left\|right` | The external label of an event, gateway, data object / store or flow on that side (flows: of their longest horizontal / vertical segment), off lines and other labels where possible. |
| `route <flowId> [--exit <side>] [--entry <side>]` | Route one sequence / message flow again, optionally forcing the side it leaves its source and enters its target by (`--exit bottom --entry bottom` draws a loop below). |
| `space --after <id> \| --below <id> [--by column\|row\|<px>]` | The space tool: everything starting right of (within the element's pool) / below the element moves by one column / row of the drawing or `<px>`; pools, lanes and the sub-processes holding the element grow, any other expanded sub-process crossing the line moves as a whole (mostly beyond it) or stays. On a lane or pool it makes that frame wider / taller. A negative amount (`--by -column`, `-row`, `-<px>`) closes up to that much of the empty space right of / below the element instead (the drawing's gap stays; on a lane or pool: its own empty right / bottom part, the frame gets smaller); only as far as it is empty (a note says how much), and `E_NO_ROOM` when closing would add a layout problem. |
| `tidy [<id>...]` (also `bpmn layout --tidy`) | Remove overlaps and gaps < 20 px with minimal moves, keeping the reading order (nothing moves left), default every shape. |
| `compact [<poolId\|laneId\|subProcessId>...]` | Close the empty rows and columns and shrink the frames to their content, keeping the order and the relative positions: expanded sub-processes first (deepest first, everything outside stays), then the columns of each pool (all its lanes at once), then the rows of each lane (bottom up; the lanes and pools below move up, the pool shrinks; an empty lane keeps 120 px), then the rows between pools; pools that were right-aligned stay aligned. What stays between content is the drawing's gap (columns) or clamp(row spacing - 80, 30, 60) (rows), frames keep 30 px of padding (45 above the content of a sub-process). Message flows do not hold a gap open: their bends and labels in it are squeezed with it. Each strip is closed only when that adds no hard layout problem and does not raise the score, else it stays open (a note names what closing it would have added). With ids: only those frames and what is inside them. |
| `order <poolId\|processId\|laneId> <laneId...>` | Lanes top to bottom; the bands move with their content. |
| `order <collaborationId> <participantId...>` | Pools top to bottom (black boxes too); the bands move with their content, message flows are routed again. |

Selectors name many elements at once on `place`, `align`, `color` and
`tidy`; they add to the ids given (elements are always named by id):

| selector | names |
| --- | --- |
| `--path <fromId> <toId> [--via <flowId...>]` | every node (for `color` also every flow) on the shortest sequence-flow path, the default flow of a node first on ties, then the declaration order (the straight continuation); `--via` flows must be on it, in order (to pick a branch). A host leads to its boundary events. |
| `--kind <kind>` | every element of a kind, in the grammar of `find --kind` (`endEvent`, `userTask`, `startEvent:message`, `sequenceFlow`, ...) |
| `--branch <flowId>` | what only that flow's branch reaches up to the join: the nodes reachable from its target that no other outgoing flow of its source reaches, following flows that run forward in the drawing (a loop back ends it); for `color` with the flows. `place --branch <flowId> --below <id>` moves the branch as one group. |

A selector that names nothing is `E_NO_MATCH` (no path, no element of the
kind, nothing on the branch); in ops JSON the keys are `path` (two ids),
`via`, `kind` and `branch`.

Refusals: a node never leaves its lane, pool or expanded sub-process
(`E_LEAVES_CONTAINER`; up to 10 px into the header of a lane or pool are
fine, a sub-process's border is the limit; a node is not placed beside the
sub-process it lives in; a sub-process grows towards a reference inside it,
never out to a reference outside it; the hint names the lane at the target
position: `move <id> --lane <laneId>` first, or `space --below <laneId>` to
make room). `align` leaves out a member that only a selector named and that
would leave its frame on the requested line, with a note (`left out
Event_Packed (sub-process Activity_Prepare): on the column of Event_Shipped
it would leave its frame`); named by id, the member refuses the op. `place`
moves the selected set as one group, so such a member refuses it.
`route --exit` / `--entry` on a boundary event refuses the side that points
into its host (`E_INVALID_VALUE`).
When the shapes in the way cannot give way without moving the reference off
the requested row / column, a sub-process would have to grow over a
reference outside it, or the reference's own pool, lane or sub-process would
be pushed away (a reference in another pool), the command fails with
`E_NO_ROOM` and writes nothing. Making room never leaves two shapes on each
other and never takes a shape out of a sub-process, lane or pool that held
it: a reference the neighbours would be pushed onto moves along with them
when its row / column still holds, otherwise the command fails with
`E_NO_ROOM`. Elements without a
shape fail with `E_NO_SHAPE` (for a pool use the participant id, not the
process id), a reference on another diagram (inside a collapsed sub-process)
with `E_DIFFERENT_DIAGRAM`, a task given to `label` with `E_WRONG_KIND`, an
unnamed element with `E_NO_LABEL`.

Each format op reports `{op, index, moved, rerouted, reshaped?, colored?,
labels?, notes?}` in `layout.format` (`reshaped`: connections stretched or
shortened without being routed again), and `layout.metrics` measures the
drawing after the last of them. A typical agent loop:

```
$ bpmn show order.bpmn --layout                                                                   # rows per lane, colours, problems
$ bpmn color order.bpmn --path Event_OrderReceived Event_Done --color green                       # the happy path
$ bpmn align order.bpmn --kind endEvent --axis column                                             # every end event in one column
$ bpmn place order.bpmn --branch Flow_InvoiceOkToClarifyInvoice --below Activity_BookInvoice      # the whole branch, up to the join
$ bpmn order order.bpmn Participant_OrderHandling Lane_Backoffice Lane_Sales
$ bpmn order order.bpmn Collaboration_OrderHandling Participant_Customer                          # the customer pool on top
$ bpmn compact order.bpmn                                                                         # close the empty rows / columns
$ bpmn route order.bpmn Flow_ReminderToRemindCustomer --exit bottom --entry bottom
$ bpmn metrics order.bpmn                                                                         # no overlaps / through / outsideLane added?
```

## Kinds

`bpmn add` and `bpmn retype` take a kind token: the canonical lowerCamel name
(`userTask`), a short alias (`user`), or the moddle type with or without
prefix (`bpmn:UserTask`, `UserTask`). Events take an optional trigger suffix
(`startEvent:message`, `boundary:timer`). Case does not matter.

| kind | aliases | id prefix | description |
| --- | --- | --- | --- |
| `task` | | `Activity_` | Generic task |
| `userTask` | `user` | `Activity_` | Task performed by a human |
| `serviceTask` | `service` | `Activity_` | Automated task (worker / connector) |
| `scriptTask` | `script` | `Activity_` | Task executing a script |
| `sendTask` | `send` | `Activity_` | Task sending a message |
| `receiveTask` | `receive` | `Activity_` | Task waiting for a message |
| `manualTask` | `manual` | `Activity_` | Task done outside the engine |
| `businessRuleTask` | `rule`, `businessRule`, `decision` | `Activity_` | Task evaluating a decision / rule |
| `subProcess` | `sub` | `Activity_` | Embedded sub-process (expanded by default, `--collapsed` to collapse) |
| `eventSubProcess` | `eventSub` | `Activity_` | Event sub-process (`triggeredByEvent=true`); it needs a `startEvent:<trigger>` inside and is a structural error (`E_EVENT_SUBPROCESS_NO_START`, blocks the write) until it has one, so create both in one `bpmn apply` (or add it with `--force`, then the start) |
| `adHocSubProcess` | `adhoc` | `Activity_` | Ad-hoc sub-process |
| `transaction` | | `Activity_` | Transaction sub-process |
| `callActivity` | `call` | `Activity_` | Calls another process (`set calledElement=<processId>`) |
| `exclusiveGateway` | `xor`, `exclusive` | `Gateway_` | XOR: exactly one outgoing path (name it as a question, name the branches) |
| `parallelGateway` | `and`, `parallel` | `Gateway_` | AND: all outgoing paths |
| `inclusiveGateway` | `or`, `inclusive` | `Gateway_` | OR: one or more outgoing paths |
| `eventBasedGateway` | `eventBased`, `event-based`, `eventGateway` | `Gateway_` | Waits for the first of several catching events |
| `startEvent` | `start` | `Event_` | Start event; triggers: none, message, timer, signal, conditional, error, escalation, compensate (the last three only inside an event sub-process) |
| `endEvent` | `end` | `Event_` | End event; triggers: none, message, error, signal, escalation, terminate, compensate, cancel |
| `intermediateCatchEvent` | `catch`, `icatch`, `catchEvent` | `Event_` | Intermediate catching event (waits); triggers: message, timer, signal, conditional, link |
| `intermediateThrowEvent` | `throw`, `ithrow`, `throwEvent` | `Event_` | Intermediate throwing event; triggers: none, message, signal, escalation, link, compensate |
| `boundaryEvent` | `boundary` | `Event_` | Boundary event attached to an activity (`--on <hostId>`, trigger required); triggers: message, timer, error, signal, escalation, conditional, compensate, cancel |
| `participant` | `pool` | `Participant_` | Pool; the first one wraps the existing process, further ones get a new process; `--black-box` creates a pool without a process and never wraps (add a normal pool first) |
| `lane` | | `Lane_` | Lane inside a process (`--in <processId>`) |
| `dataObject` | `data`, `dataObjectReference` | `DataObjectReference_` | Data object (reference + backing `bpmn:DataObject`) |
| `dataStore` | `store`, `dataStoreReference` | `DataStoreReference_` | Data store reference (+ root `bpmn:DataStore`) |
| `textAnnotation` | `note`, `annotation`, `text` | `TextAnnotation_` | Text annotation (connect it to an element to draw an association) |

Rejected kinds: `complexGateway` (the layouter cannot draw it; use exclusive
or inclusive gateways), choreographies, implicit throw events and groups.
`bpmn kinds` prints this table from the live vocabulary.

## Triggers

An event's trigger is the suffix of its kind (`startEvent:timer`); the details
come from an option (`--timer P2D`). Root elements (`bpmn:Message`,
`bpmn:Error`, `bpmn:Signal`, `bpmn:Escalation`) are looked up by name and
created next to the process when missing. In ops JSON the keys are the option
names in lowerCamelCase (`timerKind`, `errorCode`, `nonInterrupting`).

| trigger | option | notes |
| --- | --- | --- |
| `none` | | plain event; the default for start / end / throw events in `add`; `retype` keeps the current trigger unless you write `<kind>:none` |
| `message` | `--message <name>` | `bpmn:Message` by name (also on `sendTask` / `receiveTask`) |
| `timer` | `--timer <iso>` `[--timer-kind cycle\|duration\|date]` | `R/PT1H` -> timeCycle, `P2D` -> timeDuration, `2026-01-31T09:00:00Z` -> timeDate (auto-classified; `--timer-kind` overrides) |
| `error` | `--error <name>` `[--error-code <code>]` | `bpmn:Error` by name |
| `signal` | `--signal <name>` | `bpmn:Signal` by name |
| `escalation` | `--escalation <name>` `[--escalation-code <code>]` | `bpmn:Escalation` by name |
| `conditional` | `--when <expr>` | condition expression |
| `link` | `--link <name>` | a throwing and a catching link event pair up by name |
| `compensate` | | compensation |
| `terminate` | | terminate end event |
| `cancel` | | transaction cancel (end event inside a transaction, boundary event on one) |

`--non-interrupting` sets `cancelActivity=false` on boundary events and
`isInterrupting=false` on start events of an event sub-process; it is not
allowed on error / cancel / compensate boundary events. Boundary events need a
trigger (`E_TRIGGER_REQUIRED`). Later changes: `bpmn set <id> trigger=timer
timer=PT1H` or `bpmn retype <id> boundaryEvent:message --message X`. Changing
only the details of the current trigger (another message, timer value,
condition, error code ...) updates the existing event definition in place: its
id, vendor attributes and extension elements stay. A new timer value is
classified again (`R/...` becomes a cycle). Only a change of the trigger kind
replaces the definition; vendor content of the old one is reported as
`W_PROPERTY_DROPPED`.

## Placement grammar

`add` and `move` (and every split branch node, implicitly) place a flow node
with exactly one of these (`--after` + `--before` counts as one):

| option | ops key | rule |
| --- | --- | --- |
| `--after <X>` | `after` | X is a gateway or has no outgoing flow: **append** `X -> node`. X has exactly one outgoing flow: **splice**, `X -> node -> old successor`. Otherwise `E_HAS_SUCCESSOR`: say which flow. |
| `--before <Y>` | `before` | Symmetric: prepend before a join gateway or a node without incoming flow, else splice into its single incoming flow; several incoming flows -> `E_HAS_PREDECESSOR`. |
| `--after <X> --before <Y>` | `after` + `before` | Splice into the flow `X -> Y` (`E_NO_FLOW` / `E_AMBIGUOUS_FLOW` when there is none / several). |
| `--flow <F>` | `flow` | Splice into sequence flow F: `A -> B` becomes `A -> node -> B`. F keeps its name and condition and now ends at the node; it keeps its id too, unless the id named A and B (then it names A and the node, [Ids](#ids)). |
| `--in <S>` | `in` | Put the node into process / sub-process / participant S without connecting it. |
| `--on <A>` | `on` | Boundary events only: attach to activity A (not to a compensation handler: `E_INVALID_HOST`). |
| `--to <T>` | `to` | Additionally connect `node -> T` (a branch that re-joins the main path). |

- Without any placement the node is appended to the only process, unconnected
  (several processes: `E_AMBIGUOUS_SCOPE`, use `--in`).
- The flow options `--flow-name`, `--flow-id`, `--condition`, `--language`,
  `--default` describe the flow **into** the new node (from the anchor). They
  need a placement that creates one (`after`, `before`, `flow`).
- Data objects, data stores, text annotations, lanes and pools take `--in`
  only (`E_INVALID_PLACEMENT` otherwise); wire them with `connect`.
- Branch order in the diagram: the default flow (else the first outgoing flow
  that leads to an end event, else the first one) continues straight; the
  other branches are drawn alternately below and above it in declaration
  order (all below when a default flow exists). `bpmn order` changes the
  declaration order, `set <flowId> default=true` picks the continuation.
- Sequence flows never cross scopes (`E_CROSS_SCOPE`): use a message flow
  between pools or `move --in`.

## Set keys

`bpmn set <file> <id> key=value ...` (also `add ... key=value` and the `set`
map of an `add` op). `key=` or `--unset key` removes the property. `bpmn
kinds` prints the live table grouped by element family; the documented keys
are:

| applies to | keys |
| --- | --- |
| any element | `id` (rename, every reference follows, including `calledElement` strings), `name`, `doc` / `documentation`, any attribute-typed BPMN property of the element's type by its name (`isExecutable`, `isForCompensation`, `completionQuantity`, `processType`, `script`, `scriptFormat`, `implementation`, `calledElement`, `instantiate`, `gatewayDirection`, ...; enums are checked), vendor attributes with a prefix (`camunda:assignee`, `zeebe:modelerTemplate`; the xmlns is declared automatically for known prefixes; Camunda 8 settings are extension elements, see [Camunda 8](#camunda-8)) |
| sequence flows | `condition`, `language`, `default` (`true`/`false`), `source`, `target` (redirect) |
| events | `trigger` (`message`, `timer`, ...), `timer`, `message`, `error`, `errorCode`, `signal`, `escalation`, `escalationCode`, `when`, `link`, `nonInterrupting` (`true`/`false`) |
| activities | `loop` (`none`/`standard`/`parallel`/`sequential`), `cardinality`, `completion` (completion condition of the multi-instance loop; an ad-hoc sub-process without one: its own) |
| sub-processes | `expanded` (`true`/`false`, drives the diagram), `triggeredByEvent` |
| flow nodes | `lane` (lane id; empty removes the membership), `default` (id of the default outgoing flow of a gateway / activity, the node-side twin of `set <flowId> default=true`; empty clears it) |
| text annotations | `text` |
| send / receive tasks | `message=<name>`: the root `bpmn:Message` found by id or name, created when missing; empty removes the reference |
| business rule tasks | `calledDecision=<decision>`: the decision link in the file's spelling (design model: `calledDecision`, Camunda 7: `camunda:decisionRef`, Camunda 8: `zeebe:calledDecision`); the other spellings are removed, empty removes the link |
| events | `definition.<key>`: attribute of the event definition, e.g. `definition.camunda:errorCodeVariable=errCode definition.camunda:errorMessageVariable=errMsg` (error), `definition.camunda:type=external definition.camunda:topic=notify` (message throw / end event; also `class`, `delegateExpression`, `expression`, `resultVariable`), `definition.camunda:variableName=amount definition.camunda:variableEvents=create,update` (conditional), `definition.camunda:escalationCodeVariable=code` (escalation), `definition.camunda:async=true` (signal); one of several event definitions: `'definition[1].<key>=...'` (0-based) or `'definition[timer].<key>=...'` |
| activities | `loop.<key>`: attribute of the loop characteristics, e.g. `'loop.camunda:collection=${items}' loop.camunda:elementVariable=item loop.camunda:asyncBefore=true` (a parallel multi-instance loop is created when none exists), `loop.isSequential=true`, `loop.loopMaximum=5` |
| sequence flows, conditional events | `condition.<key>`: attribute of the condition expression, e.g. `condition.camunda:resource=deployment://check.groovy language=groovy` (a script resource condition, no body; on a conditional event `condition.language=groovy`) |

Every slot also takes `<slot>.id` (give or rename the nested element's id).
`bpmn kinds` prints the full table of nested keys ("NESTED KEYS"), `bpmn
kinds --json` -> `nestedKeys` lists them per nested BPMN type from the Camunda
descriptor. A `camunda:` attribute that belongs on a nested element is refused
on its parent with `E_WRONG_HOST`, whose hint names the prefixed key; the same
for a process attribute set on its participant. A `definition.` /
`condition.` key on an element that has no event definition / condition yet
fails with `E_NO_NESTED_ELEMENT` (set the trigger or the condition in the same
command). On an event with several event definitions a plain `definition.`
key is `E_AMBIGUOUS_NESTED`: select one with `definition[<n>].` or
`definition[<trigger>].` (`bpmn kinds --json` -> `nestedSelectors`). Quote
`${...}` values and bracketed keys with single quotes.

Unknown keys fail with `E_UNKNOWN_KEY` and a list of the keys the element
accepts.

## Camunda 7

Camunda 7, CIB seven and Operaton read the `camunda:` namespace; the engine
rules below and the worked example were checked on Camunda 7.24.0, CIB seven
2.2.0 and Operaton 2.1.5, which behaved identically. Camunda content stays
untyped in the model and is kept byte for byte by every edit; the Camunda
descriptor (`camunda-bpmn-moddle`, read as data) tells the CLI where an
attribute or extension element belongs.

**Operaton's own namespace.** Operaton 2.1 also reads `operaton:*`
(`xmlns:operaton="http://operaton.org/schema/1.0/bpmn"`, the same types),
first, with `camunda:*` as the fallback; Camunda 7 and CIB seven ignore it
(an Operaton-only file without `camunda:historyTimeToLive` is refused by
them). The CLI treats it as part of the Camunda 7 family: `set`, `ext`,
renames, `retype` and `validate` apply the same rules to `operaton:` content
(by local name), a new process of an Operaton file gets
`operaton:historyTimeToLive`, and `validate` reads the file the way Operaton
does and says so in its platform line. (The `activiti:` namespace, which
Camunda 7 and CIB seven still read as a fallback, is not modelled.)

**A new file.** `bpmn new claim.bpmn --name "Claim handling" --target
camunda7` declares the `camunda:` and `modeler:` namespaces, the execution
platform (`Camunda Platform`, `7.24.0`) and `camunda:historyTimeToLive="180"`
on the process, like Camunda Modeler; without a TTL the engines refuse to
deploy an executable process.

**Attributes** are `set` keys with the `camunda:` prefix (also trailing
`key=value` pairs of `add`, and the `set` map of an ops `add` / the `values` of
a `set` op): `bpmn set claim.bpmn Activity_ApproveClaim
camunda:candidateGroups=claims 'camunda:dueDate=${dueDate}'`. Typical ones:

| element | attributes |
| --- | --- |
| process | `camunda:historyTimeToLive`, `camunda:versionTag`, `camunda:isStartableInTasklist`, `camunda:candidateStarterGroups` |
| start event | `camunda:initiator`, `camunda:formKey` |
| user task | `camunda:assignee`, `camunda:candidateGroups`, `camunda:candidateUsers`, `camunda:dueDate`, `camunda:followUpDate`, `camunda:priority`, `camunda:formKey` / `camunda:formRef` |
| service / send / business rule task | `camunda:type=external` + `camunda:topic` (+ `camunda:taskPriority`), or `camunda:class` / `camunda:delegateExpression` / `camunda:expression` (+ `camunda:resultVariable`); `camunda:decisionRef`, `camunda:mapDecisionResult` |
| call activity | `calledElement` (BPMN), `camunda:calledElementBinding`, `camunda:calledElementVersion` |
| any activity, gateway, event | `camunda:asyncBefore`, `camunda:asyncAfter`, `camunda:exclusive`, `camunda:jobPriority` |

Attributes of nested elements without an id take the prefix of their slot:
`definition.` (the event definition: `definition.camunda:errorCodeVariable`,
`definition.camunda:type=external` + `definition.camunda:topic` on a message
throw or end event, `definition.camunda:variableName` on a conditional event),
`loop.` (the loop characteristics: `loop.camunda:collection`,
`loop.camunda:elementVariable`, `loop.camunda:asyncBefore`) and `condition.`
(the condition expression: `condition.camunda:resource`). The full table is in
`bpmn kinds` ("NESTED KEYS"). An attribute given to the wrong element is
refused with the right command in the hint:

```
$ bpmn set claim.bpmn Activity_InformParty 'camunda:collection=${parties}'
error E_WRONG_HOST: camunda:collection does not belong on userTask Activity_InformParty: it is an attribute of its loop characteristics
  element: Activity_InformParty
  op: #0
  hint: Use `bpmn set <file> Activity_InformParty 'loop.camunda:collection=${parties}'`.
```

**Extension elements** are added with `ext add`. Child types are filed into
their container and a container exists once (see [`ext`](#ext)), so input
mappings, form fields and properties are added one by one, replaced by key and
removed by selector:

```
bpmn ext add claim.bpmn Activity_CheckCoverage camunda:inputParameter name=amount --body '${amount}'
bpmn ext add claim.bpmn Activity_CheckCoverage camunda:outputParameter name=coverage --body '${result}'
bpmn ext remove claim.bpmn Activity_CheckCoverage 'camunda:inputParameter[name=amount]'
bpmn ext add claim.bpmn Activity_ApproveClaim camunda:formField id=approved type=boolean
bpmn ext add claim.bpmn Activity_ApproveClaim 'camunda:formField[id=approved]/camunda:validation/camunda:constraint' name=required
bpmn ext add claim.bpmn Activity_ApproveClaim camunda:taskListener event=create 'expression=${task.setPriority(80)}'
bpmn ext add claim.bpmn Activity_PayOut camunda:in variables=all
bpmn ext add claim.bpmn Activity_InformParty loop.camunda:failedJobRetryTimeCycle --body R3/PT5M
```

**Validate before deploying.** `bpmn validate claim.bpmn` runs the Camunda 7
profile: about 40 rules derived from what the engines refuse at deploy time
(`W_C7_DEPLOY_*`: a missing TTL, a service task without implementation, an
external task without topic, a multi-instance loop without collection or
cardinality, two `camunda:inputOutput`, an event-based gateway leading to a
receive task, an exclusive gateway flow without condition next to a default,
two none / timer start events in a process or two start events in a
sub-process, a sub-process without start event, a connected ad-hoc
sub-process, a link throw without its catch, two subscriptions to one message
or signal in one engine scope, a compensation `activityRef` outside the
throw event's scope, an attribute BPMN does not define (`W_C7_DEPLOY_SCHEMA`:
the engines validate the whole file against the schema; design-iq's
unprefixed `calledDecision` on a business rule task is converted to
`camunda:decisionRef` by `set <id> calledDecision=<decision>`), ...), what they
silently ignore or fail on at run time (unknown or misplaced attributes and
elements, settings on the wrong side of an event definition such as
`camunda:topic` on a message catch event, `asyncBefore=yes`, a dangling error
mapping, an empty condition, an event with several event definitions of
which the engines use one, Camunda 8 content) and what they warn about. Each
rule was taken from a deployment to the three engines; the precision was
checked on 218 real Camunda 7 / CIB seven files (no deploy finding on a file
the engines accept). Every finding names the command that fixes it (a
repeatable extension element such as a listener or an error mapping is
rebuilt by removing just that one by its selector and adding it again, never
with `--replace`, which would delete its siblings), and every write reports
the findings it introduced. Use `--strict` in a pipeline: the findings are
warnings, so `validate` alone exits 0.

```
$ bpmn set claim.bpmn Process_ClaimHandling camunda:historyTimeToLive=
...
$ bpmn validate claim.bpmn
W_C7_DEPLOY_HISTORY_TTL Process_ClaimHandling: Executable process Process_ClaimHandling has no camunda:historyTimeToLive; Camunda 7.20+, CIB seven and Operaton refuse to deploy it (ENGINE-12018)  (`bpmn set <file> Process_ClaimHandling camunda:historyTimeToLive=180` (days, like Camunda Modeler; P180D works too).)
platform: c7 (modeler:executionPlatform "Camunda Platform") - 1 refused at deploy, 0 runtime, 0 practice finding(s)
layout: ok
valid, 1 warning(s)
```

### A worked example

A claim is checked by an external worker (input mapping; an error mapping
turns `covered=false` into a BPMN error), approved by the claims group in a
generated form, paid out by another process (call activity with in / out
mappings), and every party is informed (multi-instance over a collection):

```
bpmn new claim.bpmn --name "Claim handling" --target camunda7
bpmn add claim.bpmn start "Claim received"
bpmn add claim.bpmn serviceTask "Check coverage" --after Event_ClaimReceived camunda:type=external camunda:topic=check-coverage
bpmn ext add claim.bpmn Activity_CheckCoverage camunda:inputParameter name=policyId --body '${policyId}'
bpmn ext add claim.bpmn Activity_CheckCoverage camunda:inputParameter name=amount --body '${amount}'
bpmn add claim.bpmn boundary:error "Not covered" --on Activity_CheckCoverage --error "Not covered" --error-code NOT_COVERED definition.camunda:errorCodeVariable=rejectCode
bpmn ext add claim.bpmn Activity_CheckCoverage camunda:errorEventDefinition id=Mapping_NotCovered errorRef=Error_NotCovered 'expression=${not covered}'
bpmn add claim.bpmn end "Claim rejected" --after Event_NotCovered
bpmn add claim.bpmn userTask "Approve claim" --after Activity_CheckCoverage camunda:candidateGroups=claims
bpmn ext add claim.bpmn Activity_ApproveClaim camunda:formField id=approved type=boolean
bpmn ext add claim.bpmn Activity_ApproveClaim 'camunda:formField[id=approved]/camunda:validation/camunda:constraint' name=required
bpmn add claim.bpmn callActivity "Pay out" --after Activity_ApproveClaim calledElement=Process_PayOut camunda:calledElementBinding=latest
bpmn ext add claim.bpmn Activity_PayOut camunda:in source=amount target=payoutAmount
bpmn ext add claim.bpmn Activity_PayOut camunda:out source=transactionId target=transactionId
bpmn add claim.bpmn userTask "Inform party" --after Activity_PayOut 'loop.camunda:collection=${parties}' loop.camunda:elementVariable=party 'camunda:assignee=${party}'
bpmn add claim.bpmn end "Claim settled" --after Activity_InformParty
```

```
$ bpmn show claim.bpmn
namespaces: camunda, modeler
process Process_ClaimHandling "Claim handling" executable [camunda:historyTimeToLive=180]
  startEvent Event_ClaimReceived "Claim received" -> Activity_CheckCoverage (Flow_ClaimReceivedToCheckCoverage)
  serviceTask Activity_CheckCoverage "Check coverage" [camunda:type=external, camunda:topic=check-coverage, ext: camunda:inputOutput, camunda:errorEventDefinition] -> Activity_ApproveClaim (Flow_CheckCoverageToApproveClaim)
    boundaryEvent:error Event_NotCovered "Not covered" [error Not covered (NOT_COVERED), definition.camunda:errorCodeVariable=rejectCode] -> Event_ClaimRejected (Flow_NotCoveredToClaimRejected)
  userTask Activity_ApproveClaim "Approve claim" [camunda:candidateGroups=claims, ext: camunda:formData] -> Activity_PayOut (Flow_ApproveClaimToPayOut)
  callActivity Activity_PayOut "Pay out" [calledElement=Process_PayOut, camunda:calledElementBinding=latest, ext: camunda:in, camunda:out] -> Activity_InformParty (Flow_PayOutToInformParty)
  userTask Activity_InformParty "Inform party" [loop=parallel, camunda:assignee=${party}, loop.camunda:collection=${parties}, loop.camunda:elementVariable=party] -> Event_ClaimSettled (Flow_InformPartyToClaimSettled)
  endEvent Event_ClaimSettled "Claim settled"
  endEvent Event_ClaimRejected "Claim rejected"
root: error Error_NotCovered "Not covered" (NOT_COVERED)
problems: none

$ bpmn show claim.bpmn Activity_CheckCoverage
...
extensions:
  camunda:inputOutput
    camunda:inputParameter name="policyId" body="${policyId}"
    camunda:inputParameter name="amount" body="${amount}"
  camunda:errorEventDefinition id="Mapping_NotCovered" errorRef="Error_NotCovered" expression="${not covered}"
camunda:type: external
camunda:topic: check-coverage
```

`bpmn validate claim.bpmn` reports no finding, and the file (deployed together
with a `Process_PayOut` made the same way) runs on all three engines: the
worker fetches `check-coverage` with `policyId` and `amount` as local
variables; completing it with `covered=false` ends in "Claim rejected" with
`rejectCode=NOT_COVERED`; with `covered=true` the claims group gets the task,
the form refuses a submit without `approved`, the child process receives
`payoutAmount` and returns `transactionId`, and one "Inform party" task is
created per entry of `parties`, assigned to it. (`Mapping_NotCovered` follows
a rename of `Error_NotCovered`: `bpmn set claim.bpmn Error_NotCovered
id=Error_Rejected` re-points it.)

## Camunda 8

Camunda 8 (Zeebe) reads the `zeebe:` namespace. The rules below and the
worked example were checked on Camunda 8.9.22 (REST v2): every deploy rule by
deploying, every runtime rule by running the process. Zeebe content stays
untyped in the model and is kept byte for byte by every edit; the Zeebe
descriptor (`zeebe-bpmn-moddle`, read as data like the Camunda 7 one) tells
the CLI where a zeebe element belongs and which attributes it has.

**A new file.** `bpmn new invoice.bpmn --name "Invoice approval" --target
camunda8` declares the `zeebe:` and `modeler:` namespaces and the execution
platform (`Camunda Cloud`, `8.9.0`), like Camunda Modeler. In a Camunda 8
file a new user task (`add`, or `retype` to `userTask`) gets
`<zeebe:userTask />`: a Camunda user task, which is what the Modeler creates.
Without it Camunda 8 runs a job worker user task (a job of type
`io.camunda.zeebe:userTask`, which the v2 user task API and Tasklist in V2
mode do not list; `W_C8_JOB_WORKER_USER_TASK`). A new event definition gets
a speaking id after its event, in the file's id style
(`ConditionalEventDefinition_StockReady`; never the hash of a Modeler event
id: the event's name then; a taken id gets `_2` and `W_ID_SUFFIXED`):
Camunda 8.9 refuses conditional, compensation and link catch event
definitions without one.

**Settings are extension elements.** Almost every Camunda 8 setting is a
zeebe extension element, added with `ext add`; FEEL values start with `=`,
so write `attr==<expression>` (the first `=` separates key and value:
`source==order.total` is `source="=order.total"`). Child types go into their
container, single elements are merged, keyed items replaced (see
[`ext`](#ext)); `bpmn kinds` (section CAMUNDA 8, `kinds --json` ->
`zeebeElements`) lists every zeebe element, where it goes and its
attributes.

| what | command |
| --- | --- |
| job worker (service, send, script, business rule task, message throw / end event) | `bpmn ext add <file> <id> zeebe:taskDefinition type=<jobType> retries=3` |
| input / output mapping | `bpmn ext add <file> <id> zeebe:input source==<FEEL> target=<variable>` (`zeebe:output`; filed into `zeebe:ioMapping`, replaced by target) |
| task header | `bpmn ext add <file> <id> zeebe:header key=<key> value=<value>` |
| FEEL script task | `bpmn ext add <file> <id> zeebe:script expression==<FEEL> resultVariable=<variable>` |
| DMN decision | `bpmn set <file> <id> calledDecision=<decisionId>`, then `bpmn ext add <file> <id> zeebe:calledDecision resultVariable=<variable>` |
| call activity | `bpmn ext add <file> <id> zeebe:calledElement processId=<processId> propagateAllChildVariables=false` |
| user task | `zeebe:assignmentDefinition assignee=<user> candidateGroups=<groups>`, `zeebe:formDefinition formId=<formId>` (or `externalReference=<url>`), `zeebe:taskSchedule dueDate=<date-time>`, `zeebe:priorityDefinition priority=<0..100>`, `zeebe:taskListener eventType=completing type=<jobType>` |
| message correlation | `bpmn set <file> <id> message=<Name>` (or `add ... --message <Name>`), then `bpmn set <file> <id> zeebe:correlationKey==<FEEL>` or `bpmn ext add <file> <id or messageId> zeebe:subscription correlationKey==<FEEL>` (both go to the message's `zeebe:subscription`; in `apply`, `"refAs": "$msg"` names the message) |
| multi-instance | `bpmn ext add <file> <id> loop.zeebe:loopCharacteristics inputCollection==<FEEL> inputElement=<variable>` (creates the parallel loop; `outputCollection=<variable> outputElement==<FEEL>` collect results; `set <id> loop=sequential`) |
| execution listener | `bpmn ext add <file> <id> zeebe:executionListener eventType=start type=<jobType>` |
| conditions | `add ... --condition '= amount > 1000'`, `bpmn set <file> <flowId> 'condition== amount > 1000'`, `when=` on a conditional event |
| process | `bpmn ext add <file> <processId> zeebe:versionTag value=v1` |

A zeebe attribute set on the element itself is refused, with the command
that writes it where Camunda 8 reads it:

```
$ bpmn set invoice.bpmn Activity_ApproveInvoice zeebe:candidateGroups=finance
error E_WRONG_HOST: zeebe:candidateGroups is not an attribute of userTask Activity_ApproveInvoice: Camunda 8 reads candidateGroups on the zeebe:assignmentDefinition extension element
  element: Activity_ApproveInvoice
  op: #0
  hint: Use `bpmn ext add <file> Activity_ApproveInvoice zeebe:assignmentDefinition candidateGroups=finance`.
```

A zeebe element added where Camunda 8 does not read it (a
`zeebe:taskDefinition` on a user task) is written with
`W_MISPLACED_EXTENSION`; `retype` names the zeebe content the new kind
cannot use (`W_PROPERTY_INAPPLICABLE`, in a Camunda 8 file one
`W_C8_MISPLACED_EXTENSION` per item). `show` prints what a node does
(`job=check-invoice`, `calledElement=...`, `script=...`, `form=...`,
`assignee=...` / `candidateGroups=...`, `inputCollection=...`) and a message
its correlation key; `show --around` and `show <id> --context` print each
zeebe element once, with its attributes (`zeebe:taskDefinition
type=check-invoice retries=3, io: in amount`); `show <id>` and `ext list`
print the whole tree.

**Validate before deploying.** `bpmn validate` runs the Camunda 8 profile in
Camunda 8 files (`modeler:executionPlatform` "Camunda Cloud", or zeebe
content; `--platform c8` forces it). Its findings are warnings named
`W_C8_*` with a `severity`: `deploy` (`W_C8_DEPLOY_*`: Camunda 8 refuses the
file), `runtime` (it deploys, but the setting is ignored or fails when the
process runs), `practice`. The deploy rules: a service / send / script /
business rule task or message throw / end event without job type (or
script, called decision), a call activity without `zeebe:calledElement`
(the BPMN `calledElement` is not read), a catching message without a
`zeebe:subscription` correlation key, a JUEL `${...}` condition or any
static value where Camunda 8 wants FEEL, a FEEL syntax error (below), a
timer value it cannot parse (`PT2D` instead of `P2D`, `PT1.5H`: a fraction
on seconds only, a date without offset, a 5-field cron), a cycle on an
intermediate or interrupting timer,
a multi-instance loop without `zeebe:loopCharacteristics` or
`inputCollection`, two of a zeebe element it reads once, form, priority,
date, listener and mapping content it refuses, event and start-event
combinations it does not support (several definitions, a triggered start
in an embedded sub-process, two none starts, error codes or message names
twice in a scope, an escalation boundary event on a task, a link without
catch, an empty link name), unsupported elements (transaction, cancel
events), what the BPMN schema refuses (an unprefixed attribute BPMN does not
define, an id that is no XML NCName such as `a:b`, an IDREF that names no
id such as a lane's `flowNodeRef`, child elements out of the schema's order
such as `extensionElements` after `incoming`: the last two are read from the
file's text, the model shows neither), and a file without an executable
process. White space is a value to Camunda 8 where it is a name: a job type,
message / signal name, error / escalation code, process / decision id or
result variable of white space deploys (only an empty one is refused), so
the profile reports only the empty one; a FEEL, path or enum attribute, a
form id or a correlation key of white space is refused.

**FEEL.** Every value Camunda 8 parses as FEEL at deploy (conditions, the
zeebe attributes it reads as expressions, a message or signal name starting
with `=`, `zeebe:adHoc` and an ad-hoc sub-process's completion condition) is
parsed by a small built-in checker of the grammar Camunda 8.9 accepts
(`src/platform/feel.ts`, no dependency). It reports `&` / `|` (FEEL: `and`
/ `or`), `<>` (`!=`), `>>`, `%` (`modulo(a, b)`), `:=`, `AND` / `OR`
(keywords are lower case), `if` without `else`, `for` without `return`,
unbalanced brackets and strings, an operator without operand, and the JUEL
habits (`&&`, `||`, `==`, `!`, `${...}`, single quotes, `?:`), each with its
FEEL spelling. Where Camunda's parser is lenient, so is the check: ranges,
unary tests, contexts, function names with spaces, `?`, a keyword glued to
a name (`x andy` is `x and y`). 762 expressions with the engine's verdict
are in `test/fixtures/c8/feel-verdicts.json`; the check agrees on every one.
The runtime rules: a flow without condition out of an exclusive or
inclusive gateway with other outgoing flows is never taken, a condition on
a flow out of a task or parallel gateway is ignored, a standard loop runs
once, a JUEL completion condition and non-numeric job retries end in an
incident, Camunda 7 content (`camunda:*`) is ignored, unknown and misplaced
zeebe content (input mappings on start, boundary, none throw and none end
events included) has no effect, `zeebe:publishMessage` is accepted but not
run. Every finding names the command that fixes it (the worked example
below after `set Flow_AmountOver1000ToApproveInvoice 'condition=${invoice.amount > 1000}'` and
`ext remove Message_PaymentReceived zeebe:subscription`):

```
$ bpmn validate invoice.bpmn
W_C8_DEPLOY_MESSAGE Activity_WaitForPayment [Message_PaymentReceived]: Message Message_PaymentReceived ("Payment received") of receiveTask Activity_WaitForPayment has no zeebe:subscription: Camunda 8 needs one with the correlation key that matches a message to an instance and refuses the file  (`bpmn ext add <file> Message_PaymentReceived zeebe:subscription correlationKey==<expression>` (e.g. correlationKey==orderId).)
W_C8_DEPLOY_EXPRESSION Flow_AmountOver1000ToApproveInvoice: The condition "${invoice.amount > 1000}" of sequence flow Flow_AmountOver1000ToApproveInvoice is no FEEL expression; Camunda 8 needs one starting with = and refuses the file  (`bpmn set <file> Flow_AmountOver1000ToApproveInvoice 'condition== invoice.amount > 1000'` (check the FEEL syntax: and / or, = for equality).)
platform: c8 (modeler:executionPlatform "Camunda Cloud") - 2 refused at deploy, 0 runtime, 0 practice finding(s)
layout: ok
valid, 2 warning(s)
```

Evidence (Camunda 8.9.22): 151 synthetic models (`test/c8-profile.test.ts`,
re-checked with `BPMN_C8_ENGINE`) get a deploy finding exactly when the
engine refuses them; on 38 real Camunda 8 files and 28 synthetic scenario
files the profile has no false deploy finding and finds every refused file
(32 / 32; every element the engine names is in a finding), following the
hints (306 commands through the CLI) made all 32 refused files deployable,
and an edit battery (rename, id rename, insert, remove, retype, boundary
event, full redraw; 459 edits) has 0 regressions, the profile agrees with
the engine on every result, and no zeebe content outside the edited element
changed (1,689 / 1,689 extension blocks byte for byte). Like Camunda 8,
the profile checks executable processes only (but a file without one is
refused) and the content of ad-hoc sub-processes too. On 200 adversarial
models (81 refused by Camunda 8.9.22) the deploy findings have precision
1.000 and recall 0.951 (before the FEEL and schema-text rules: 0.938 /
0.741); the 4 refused models without a deploy finding get a structural
error (`E_DANGLING_REF`, `E_INVALID_DEFAULT`, `E_INVALID_HOST`), so every
refused model gets a finding.

### A worked example: invoice approval

An invoice is checked by a job worker (input mapping, task header), large
amounts are approved by the finance group (FEEL condition, Camunda user
task with assignment and form), the process waits for the payment message
(correlation by invoice id), books the payment in another process (call
activity with an output mapping) and notifies every party (multi-instance):

```
bpmn new invoice.bpmn --name "Invoice approval" --target camunda8
bpmn add invoice.bpmn start "Invoice received"
bpmn add invoice.bpmn serviceTask "Check invoice" --after Event_InvoiceReceived
bpmn ext add invoice.bpmn Activity_CheckInvoice zeebe:taskDefinition type=check-invoice retries=3
bpmn ext add invoice.bpmn Activity_CheckInvoice zeebe:input source==invoice.amount target=amount
bpmn ext add invoice.bpmn Activity_CheckInvoice zeebe:header key=channel value=mail
bpmn add invoice.bpmn exclusiveGateway "Amount over 1000?" --after Activity_CheckInvoice
bpmn add invoice.bpmn userTask "Approve invoice" --after Gateway_AmountOver1000 --flow-name yes --condition '= invoice.amount > 1000'
bpmn ext add invoice.bpmn Activity_ApproveInvoice zeebe:assignmentDefinition candidateGroups=finance
bpmn ext add invoice.bpmn Activity_ApproveInvoice zeebe:formDefinition externalReference=https://forms.example.com/approve-invoice
bpmn add invoice.bpmn exclusiveGateway --id Gateway_Approved --after Activity_ApproveInvoice
bpmn connect invoice.bpmn Gateway_AmountOver1000 Gateway_Approved --name no --default
bpmn add invoice.bpmn receiveTask "Wait for payment" --after Gateway_Approved --message "Payment received"
bpmn ext add invoice.bpmn Message_PaymentReceived zeebe:subscription correlationKey==invoiceId
bpmn add invoice.bpmn callActivity "Book payment" --after Activity_WaitForPayment
bpmn ext add invoice.bpmn Activity_BookPayment zeebe:calledElement processId=Process_BookPayment propagateAllChildVariables=false
bpmn ext add invoice.bpmn Activity_BookPayment zeebe:output source==bookingId target=bookingId
bpmn add invoice.bpmn serviceTask "Notify party" --after Activity_BookPayment
bpmn ext add invoice.bpmn Activity_NotifyParty zeebe:taskDefinition type=notify-party
bpmn ext add invoice.bpmn Activity_NotifyParty loop.zeebe:loopCharacteristics inputCollection==parties inputElement=party
bpmn add invoice.bpmn end "Invoice settled" --after Activity_NotifyParty

bpmn new booking.bpmn --name "Book payment" --target camunda8
bpmn add booking.bpmn start "Booking requested"
bpmn add booking.bpmn scriptTask "Create booking" --after Event_BookingRequested
bpmn ext add booking.bpmn Activity_CreateBooking zeebe:script 'expression== "B-" + invoiceId' resultVariable=bookingId
bpmn add booking.bpmn end "Booked" --after Activity_CreateBooking
```

Each step reports what the profile finds until it is complete (`bpmn add
... serviceTask` warns `W_C8_DEPLOY_IMPLEMENTATION` until the job type is
there, the receive task `W_C8_DEPLOY_MESSAGE` until its message has a
correlation key):

```
$ bpmn show invoice.bpmn
namespaces: zeebe, modeler
process Process_InvoiceApproval "Invoice approval" executable
  startEvent Event_InvoiceReceived "Invoice received" -> Activity_CheckInvoice (Flow_InvoiceReceivedToCheckInvoice)
  serviceTask Activity_CheckInvoice "Check invoice" [job=check-invoice, ext: zeebe:taskDefinition, zeebe:ioMapping, zeebe:taskHeaders] -> Gateway_AmountOver1000 (Flow_CheckInvoiceToAmountOver1000)
  exclusiveGateway Gateway_AmountOver1000 "Amount over 1000?" -> Activity_ApproveInvoice (Flow_AmountOver1000ToApproveInvoice "yes" if = invoice.amount > 1000), Gateway_Approved (Flow_AmountOver1000ToApproved "no" default)
  userTask Activity_ApproveInvoice "Approve invoice" [form=https://forms.example.com/approve-invoice, candidateGroups=finance, ext: zeebe:userTask, zeebe:assignmentDefinition, zeebe:formDefinition] -> Gateway_Approved (Flow_ApproveInvoiceToApproved)
  exclusiveGateway Gateway_Approved -> Activity_WaitForPayment (Flow_ApprovedToWaitForPayment)
  receiveTask Activity_WaitForPayment "Wait for payment" [message=Payment received] -> Activity_BookPayment (Flow_WaitForPaymentToBookPayment)
  callActivity Activity_BookPayment "Book payment" [calledElement=Process_BookPayment, ext: zeebe:calledElement, zeebe:ioMapping] -> Activity_NotifyParty (Flow_BookPaymentToNotifyParty)
  serviceTask Activity_NotifyParty "Notify party" [loop=parallel, job=notify-party, inputCollection==parties, inputElement=party, ext: zeebe:taskDefinition] -> Event_InvoiceSettled (Flow_NotifyPartyToInvoiceSettled)
  endEvent Event_InvoiceSettled "Invoice settled"
root: message Message_PaymentReceived "Payment received" [correlationKey==invoiceId]
problems: none

$ bpmn show invoice.bpmn Activity_CheckInvoice
...
job: check-invoice
incoming: Flow_InvoiceReceivedToCheckInvoice from Event_InvoiceReceived
outgoing: Flow_CheckInvoiceToAmountOver1000 to Gateway_AmountOver1000
extensions:
  zeebe:taskDefinition type="check-invoice" retries="3"
  zeebe:ioMapping
    zeebe:input source="=invoice.amount" target="amount"
  zeebe:taskHeaders
    zeebe:header key="channel" value="mail"

$ bpmn show invoice.bpmn --around Activity_ApproveInvoice --depth 1
around Activity_ApproveInvoice (depth 1): 3 of 9 nodes, 3 of 9 flows; 6 nodes, 6 flows omitted
process Process_InvoiceApproval "Invoice approval"
  exclusiveGateway Gateway_AmountOver1000 "Amount over 1000?" <- Activity_CheckInvoice (Flow_CheckInvoiceToAmountOver1000) -> Activity_ApproveInvoice (Flow_AmountOver1000ToApproveInvoice "yes" if = invoice.amount > 1000), Gateway_Approved (Flow_AmountOver1000ToApproved "no" default)
  userTask Activity_ApproveInvoice "Approve invoice" [zeebe:userTask, zeebe:assignmentDefinition candidateGroups=finance, zeebe:formDefinition externalReference="https://forms.example.com/approve-inv..."] -> Gateway_Approved (Flow_ApproveInvoiceToApproved)
  exclusiveGateway Gateway_Approved -> Activity_WaitForPayment (Flow_ApprovedToWaitForPayment)

$ bpmn validate invoice.bpmn
platform: c8 (modeler:executionPlatform "Camunda Cloud") - 0 refused at deploy, 0 runtime, 0 practice finding(s)
layout: ok
valid, 0 warning(s)
```

Both files deploy together to Camunda 8.9 and run: started with
`{invoiceId: "INV-1", invoice: {amount: 5000}, parties: ["buyer",
"seller"]}`, the `check-invoice` worker gets `amount = 5000` as a local
variable and the header `channel = mail`; the gateway routes to "Approve
invoice", a Camunda user task for the group `finance` with the external
form; after it is completed the process waits until the message "Payment
received" is published with the correlation key `INV-1`; the call activity
runs "Book payment", whose FEEL script returns `bookingId = "B-INV-1"` to
the parent through the output mapping; two `notify-party` jobs are created,
one per party, and the instance completes. An instance with `amount: 100`
takes the default flow and skips the approval. (The input mapping's
`amount` is local to "Check invoice": the condition reads
`invoice.amount`.)

## design-iq: the design profile and validators

Miragon's design-iq validates every save of a model with its own validator
(`@bpmiq/validator`) and refuses a model with an error (HTTP 422). Two
things make bpmn-cli predictable there: the **design profile**, a built-in
copy of those rules, and a **validator hook** through which an embedding
host runs its own validator inside the write transaction.

**The design profile** (`--profile design`, `MutationOptions.profile`)
checks the result of every write, after the layout, the format operations
and the text-preserving step, i.e. exactly what would be written. Its rules
are design-iq's
hard rules, checked the way design-iq checks them:

| code | rule |
| --- | --- |
| `E_DESIGN_START_EVENTS` | a process with flow nodes has exactly one start event; an embedded sub-process (not an event sub-process) at most one. No start event is reported on the process, several on each start event (so a change that adds another one always counts as new) |
| `E_DESIGN_UNREACHABLE` | every flow node except start events, boundary events and event sub-processes has an incoming sequence flow |
| `E_DESIGN_DEAD_END` | every flow node except end events and event sub-processes (boundary events included) has an outgoing sequence flow |
| `E_DESIGN_NOT_IN_LANE` | in a process with lanes every node except boundary events is listed by a top-level lane |
| `E_DESIGN_NO_DI` | every flow node, sequence flow, data object / store reference, text annotation, association, group, top-level lane, participant and message flow has a shape or edge (design-iq's editor breaks without it) |
| `E_DESIGN_NAMESPACE` | every namespace prefix the file uses is declared; checked like design-iq on the raw text, so text, CDATA, comments and attribute values that look like `<p:name` or ` p:name="` (a documentation `Set app:mode="prod"`) count as a use too |
| `E_DESIGN_NO_PROCESS` | the file has a process |
| `E_DESIGN_XML` | the file is well-formed: no attribute written twice on one element (bpmn-moddle reads such a file by dropping the element; design-iq's parser refuses it and checks nothing else) |
| `W_DESIGN_COMPLEXITY` | warning: more than 9 activities in the file (7 +- 2) |
| `W_DESIGN_CALL_LINK` / `W_DESIGN_DECISION_LINK` | warnings: a call activity / business rule task of a design model links no process / decision; inside a content repository, a link to a process / decision that is no `.bpmn` / `.dmn` of its models folder |

The flow rules are degree checks, as in design-iq, not a reachability
analysis, and they hold for every node: a compensation handler, a
compensation boundary event, link events and the content of an ad-hoc
sub-process are valid BPMN but design-iq errors (the messages say so). They
count the way design-iq counts: one sequence flow per id in each process or
sub-process (flows without id, or sharing an id, count once; a full redraw
gives a flow without id one), nodes without id not at all; every
collaboration's pools and message flows need DI. What the structural
validation already refuses (a start event with incoming flows, dangling
references) is not repeated.

One difference is deliberate: in a process with two lane sets design-iq's
reader sees no lanes at all (its XML parser turns the repeated element into
a list) and checks no lane membership there; the profile checks every lane
set, so a node in none of them is `E_DESIGN_NOT_IN_LANE` (stricter: a write
it lets through is still a save design-iq accepts). A lane member written
with whitespace around its id (`<flowNodeRef> Task_1 </flowNodeRef>`) counts,
as in design-iq (the reader resolves the trimmed id, as the XSD says).

On a write the profile behaves like the structural validation: an error the
change introduces refuses the write (`E_VALIDATION`, each finding tagged
`[design]`), an error the file already had is a `W_PREEXISTING_ERROR`
warning (it follows its element through a rename; the result counts it with
the file's other warnings instead of listing it), a warning the change
introduced is reported once, and the result names the validator and the
totals:

```
$ bpmn add claims/models/claim.bpmn boundary:timer "2 days" --on Activity_Review --timer P2D
error E_VALIDATION: The change would introduce 1 error(s) reported by validator design; nothing was written
  [design] E_DESIGN_DEAD_END Event_2Days: boundaryEvent:timer Event_2Days "2 days" has no outgoing sequence flow  (Continue the flow ...)
  hint: Fix the listed problems (each names its validator in brackets), make the edit in one transaction ...
$ bpmn apply claims/models/claim.bpmn ops.json      # the boundary event and its end event in one batch
created boundaryEvent:timer Event_2Days "2 days" - on Activity_Review
created endEvent Event_Escalated "Escalated" - after Event_2Days
...
validator design (bpmiq.yml in /work/claims: a design-iq content repository): 0 error(s), 0 warning(s) in the result
layout: ok - ...
written: claims/models/claim.bpmn
```

Edits that pass through an invalid state (a boundary event before its path,
a node before its flows) go into one `apply` batch; `--profile none` drafts
without the gate, and `bpmn validate --profile design` lists what is left. A
`--no-layout` write leaves new elements without shapes, which the profile
refuses (`E_DESIGN_NO_DI`).

**When it runs.** `--profile auto` (the default) runs the design profile
for the models of a design-iq content repository: a `bpmiq.yml` in the
file's directory or above names (`models: <folder>`, legacy `processes:`) a
folder that contains the file. There the call and decision links are also
checked against the file stems of the repository's `.bpmn` and `.dmn` files
(design-iq's id rule). Any other file gets no profile by default, also a file
without engine namespace (what design-iq's PR #218 tool calls a "design"
model and bpmn-cli's platform detector `none`; the two detectors agree on all
394 real models measured): the profile refuses every intermediate state of a
model built step by step (`add start` alone leaves a dead end), which is right
for design-iq's save gate and wrong for plain BPMN editing. `--profile design`
applies it anywhere, `--profile none` switches it off. In memory
(`applyToXml`, `validateXml`, `mutateDoc`) there is no file to look up:
`auto` runs the profile when the caller passes the repository as
`contentRepo` (`{ processIds, decisionIds }`, the stems of its `.bpmn` /
`.dmn` models, for the link checks); the file helpers of
`@miragon/bpmn-cli/node` and the CLI look it up on disk.

**Decision links.** A business rule task's decision link is the set key
`calledDecision` in every file (see [`set`](#set)): design models get
design-iq's unprefixed `calledDecision`, Camunda 7 files `camunda:decisionRef`,
Camunda 8 files `zeebe:calledDecision`. In a design model the unprefixed
attribute is not reported as an import warning.

**Measured** on 394 real models (private corpora; design-iq's validator
crashes on one of them, a file with a DOCTYPE): the design profile's verdict
equals design-iq's on all 393 others (65 refused, 328 accepted), and every
one of the 540 findings matches by rule and element. bpmn-cli's own
structural validation refuses 2 of the 328 files design-iq accepts (a plain
start event in an event sub-process, a contradicting incoming / outgoing
list). In 2,231 probe edits through the gate (an insert into a flow, a
rename, a loose task, a boundary event with and without its path, a second
start event), every write the gate let through was accepted by design-iq and
every refused one would have added a design-iq error.

**The validator hook** (library). The `validators` option of
`applyToXml`, `newXml`, `layoutXml`, `validateXml` (and of `mutateDoc`,
`checkDoc`, and in `@miragon/bpmn-cli/node` of `mutateFile` and
`checkFile`) takes functions `(xml, ctx) => findings` (sync or async) or
`{ name, validate }` objects. A mutation runs each one on the document
before the ops (its text as read) and on the candidate XML after the layout,
the format operations and the text-preserving step, inside the transaction,
with `ctx = { file, phase: 'before' | 'after' | 'check', platform, ops,
doc() }` (`file`: the `file` option, the document's name, or the target the
file helpers write to). A finding is `{ severity:
'error' | 'warning', code, message, element?, related?, hint?, key? }`;
design-iq's `{ severity: 'ERROR' | 'WARN', ruleId, message }` is accepted as
it is. Errors the change introduces block the write (`E_VALIDATION`, unless
`force`), errors the document had before are `W_PREEXISTING_ERROR`, and
findings are matched before / after by code and element (renames followed)
or, without an element, by code and message (renamed ids replaced in the
message); `key` overrides that identity. A validator that throws fails the
write with `E_VALIDATOR_FAILED`. The reports are in
`result.validation.validators` (`name`, `detail`, introduced `errors` and
`warnings`, `preexisting`, `resolved`, `counts`), and the findings among
`validation.errors` / `warnings.added` (the pre-existing ones counted in
`warnings.preexistingCount`) with `validator` and `severity`; `mutateDoc`'s
`MutationResult.validation.warnings` keeps every warning of the result:

```js
import { checkModel } from '@bpmiq/validator';
import { applyToXml } from '@miragon/bpmn-cli';

const edit = await applyToXml(xml, ops, {
  file: 'processes/order.bpmn',
  profile: 'none', // the host's own validator below is the gate
  validators: [{ name: 'design-iq', validate: (candidate) => checkModel(candidate, { path: 'processes/order.bpmn' }) ?? [] }],
});
// edit.xml is what to save (edit.unchanged: nothing to save); E_VALIDATION (err.details.errors) is the 422

// or the built-in copy of the rules, with the repository's model ids for the link checks
await applyToXml(xml, ops, { contentRepo: { processIds: ['order', 'billing'], decisionIds: ['risk-rating'] } });
```

## Ops JSON (`bpmn apply`)

`bpmn apply <file> ops.json` (or `-` for stdin) runs many operations as one
transaction: the whole batch is validated first, then the semantic ops are
applied to the model in memory, then it is validated and laid out, then the
format ops (`place`, `align`, `color`, `label`, `route`, `space`, `tidy`,
`compact`, the band part of a lane or pool `order`) run on the drawing in batch
order, and the file
is written once. If any op fails nothing is written and the error names the
op index (`ops[3] (add): ...`, `"op": 3` in `--json`).

The format is "CLI flags spelled as JSON": every op is an object with `"op"`
and the flags of the matching command in lowerCamelCase (`--flow-name` ->
`flowName`, `--if-absent` -> `ifAbsent`, `--non-interrupting` ->
`nonInterrupting`). The input is either an array of ops or `{"ops": [...]}`.

| op | keys |
| --- | --- |
| `add` | `kind` (required), `name`, `id`, `as`, `flowAs`, `refAs`, `after`, `before`, `flow`, `in`, `on`, `to`, `lane`, `flowName`, `flowId`, `condition`, `language`, `default`, trigger keys (`timer`, `timerKind`, `message`, `error`, `errorCode`, `signal`, `escalation`, `escalationCode`, `when`, `link`, `nonInterrupting`; `message` also for `sendTask` / `receiveTask`), `collapsed`, `ifAbsent`, `doc`, `set` (map, nested keys included: `"loop.camunda:collection": "${items}"`), `process`, `blackBox`, `text`, `members` (list) |
| `connect` | `source`, `target` (required), `name`, `id`, `as`, `refAs` (message flows), `condition`, `language`, `default`, `message`, `ifAbsent` |
| `set` | `id` (required), `values` (map), `unset` (list); at least one of the two; `refAs` |
| `remove` | `ids` (required list), `bridge` (default true), `bridgeAll`, `withBranch`, `ifExists` |
| `retype` | `id`, `kind` (required), trigger keys, `refAs` |
| `move` | `ids` (required list), `after`, `before`, `flow`, `in`, `lane`, flow keys |
| `order` | `id` (required), exactly one of `flows` (outgoing flows of a node), `lanes` (lanes of a pool / process / parent lane) or `pools` (participants of the collaboration `id`) |
| `ext` | `id`, `action` (`add` / `remove`, required), `type` (add: type or path; remove: selector such as `camunda:inputParameter[name=x]`, or an index from `ext list` such as `"2"`, `"loop.0"`, `"definition[1].0"`; a `definition.` / `loop.` / `condition.` prefix addresses the nested element, `definition[<n>].` / `definition[<trigger>].` one of several event definitions), `attrs` (map), `body`, `xml`, `replace`, `index`, `slot` (`definition` / `loop` / `condition` / `definition[<n>]`, the same as the type prefix) |
| `place` | `ids` (list; moved as one group, the first is the reference) and / or selectors, at most one of `rowOf` / `below` / `above` and at most one of `columnOf` / `after` / `before` (at least one key) |
| `align` | `ids` (list) and / or selectors, `axis` (`row` / `column`, required), `to` (reference; default the first id; without it and without selectors two ids are needed) |
| `color` | `ids` (list) and / or selectors, `color` (`blue` / `orange` / `green` / `red` / `purple` / `default`, required) |
| `label` | `id`, `side` (`above` / `below` / `left` / `right`) (required) |
| `route` | `id` (required), `exit`, `entry` (`right` / `top` / `bottom` / `left`) |
| `space` | exactly one of `after` / `below`, `by` (`"column"`, `"row"` or pixels; `"-column"`, `"-row"` or negative pixels close space) |
| `tidy` | `ids` (list; default every shape), selectors |
| `compact` | `ids` (list of pools, lanes, expanded sub-processes; default the whole drawing) |
| selectors | `path` (`[fromId, toId]`), `via` (flow ids, with `path`), `kind`, `branch` (a sequence flow id), on `place`, `align`, `color`, `tidy` |
| `split` | `after` (required), `kind` (gateway, default `exclusiveGateway`), `name`, `id`, `as`, `join` (default true), `joinId`, `joinAs`, `joinName`, `branches` (required): `[{ flowName?, flowId?, condition?, language?, default?, nodes: [ add-like objects without placement, `as` / `flowAs` included ] }]` |

`split` is a macro without CLI counterpart: it places a gateway after the
anchor (splicing into its single outgoing flow if it has one), creates every
branch (the first node gets the branch's flow options, following nodes are
chained), and a join gateway of the same kind (`<gatewayId>_join`) that every
branch end connects to; when the anchor was spliced, the join continues to the
old successor. An empty `nodes` list is a direct gateway -> join flow.

**Batch aliases.** An op names what it creates with `"as": "$name"` (`add`,
`connect`, `split` and the nodes of a split branch); `add` and split nodes
also take `"flowAs"` (the flow into the new node, the one the flow options
describe; a prepend before a join or an unconnected node: the flow out of
it) and `split` takes `"joinAs"` (its join gateway). `add`, `connect` (a
message flow), `set` and `retype` take `"refAs"`: the bpmn:Message, Error,
Signal or Escalation the element references after the op (the one its
`message` / `error` / `signal` / `escalation` key created or found by name;
`E_USAGE` when it references none or several), so a batch can give the
message its correlation key without guessing the message's id. Later ops of the batch
use the alias wherever an element id goes: `after`, `before`, `flow`, `in`,
`on`, `to`, `lane`, `process`, `members`, `source`, `target`, the `id` /
`ids` of `set`, `remove`, `retype`, `move`, `order` (and its `flows`,
`lanes`, `pools`), `ext` and the format ops (their selectors `path`, `via`,
`branch` and the `ids` of `compact` included), and the `default`, `source`,
`target`, `lane` values of `set`. An alias follows its element through a
rename later in the batch (a flow renamed after its new ends). So a batch
never guesses a generated id:

```json
[
  { "op": "add", "kind": "userTask", "name": "Vollständigkeit prüfen", "after": "Event_RechnungEingegangen", "as": "$check" },
  { "op": "split", "after": "$check", "name": "Vollständig?", "as": "$ok",
    "branches": [
      { "flowName": "ja", "nodes": [{ "kind": "serviceTask", "name": "Buchen", "flowAs": "$yes" }] },
      { "flowName": "nein", "nodes": [{ "kind": "userTask", "name": "Nachfordern", "flowAs": "$no" }] } ] },
  { "op": "set", "id": "$ok", "values": { "default": "$no" } },
  { "op": "set", "id": "$yes", "values": { "condition": "${vollstaendig}" } },
  { "op": "color", "ids": ["$check"], "color": "green" }
]
```

In a Camunda 8 file, `refAs` names the message an op creates:

```json
[
  { "op": "add", "kind": "intermediateCatchEvent:message", "name": "Antwort erhalten", "after": "$check",
    "message": "Antwort", "as": "$reply", "refAs": "$msg" },
  { "op": "ext", "id": "$msg", "action": "add", "type": "zeebe:subscription", "attrs": { "correlationKey": "= id" } }
]
```

An alias is `$` and a letter or `_`, then letters, digits, `_` or `-`
(`${...}` expressions are not aliases). It is defined once and used only
after the op that defines it; both are checked before anything runs
(`E_UNKNOWN_ALIAS` lists the aliases defined so far, `E_DUPLICATE_ALIAS`; an
alias in `id`, `flowId` or `joinId` is a usage error pointing to `as`). An
alias names the element itself, so it follows a rename later in the batch (a
flow whose id named its ends, [Ids](#ids)); an alias of an element a later
op removed is `E_NOT_FOUND`. The format ops see the ids at the end of the
batch. The result lists every alias with the final id of its element
(`aliases: $check = Activity_VollstaendigkeitPruefen, ...`; `"aliases"` in
`--json` and in the library's `MutationResult`).

Validation is strict: unknown ops or keys (with a "did you mean" for
kebab-case spellings and small typos: `rowof` -> `rowOf`, `colour` ->
`color`), wrong value types, conflicting placements
(`flow` + `in`, `after` + `on`, ...), flow options without a flow-creating
placement, `default` together with `condition`, trigger keys on non-event
kinds, and unknown kinds are all rejected before anything runs. Numbers and
booleans inside `values` / `set` / `attrs` maps are converted to strings;
`null` values are treated as absent. The JSON Schema (draft 2020-12) is
available as `bpmn kinds --json` -> `ops`.

A complete example, assuming `bpmn new order.bpmn --name "Order handling"
--target camunda8` followed by a start event, a "Check invoice" user task and
an end event:

```json
{
  "ops": [
    {
      "op": "split",
      "after": "Activity_CheckInvoice",
      "kind": "exclusiveGateway",
      "name": "Invoice ok?",
      "as": "$ok",
      "branches": [
        { "flowName": "yes", "condition": "= ok", "nodes": [{ "kind": "serviceTask", "name": "Book invoice", "as": "$book" }] },
        {
          "flowName": "no",
          "default": true,
          "nodes": [{ "kind": "userTask", "name": "Clarify invoice", "as": "$clarify", "set": { "doc": "Call the customer and clarify the open positions." } }]
        }
      ]
    },
    { "op": "add", "kind": "boundaryEvent:timer", "name": "Reminder", "on": "$clarify", "timer": "P2D", "nonInterrupting": true, "as": "$reminder" },
    { "op": "add", "kind": "sendTask", "name": "Remind customer", "after": "$reminder", "as": "$remind" },
    { "op": "add", "kind": "endEvent", "name": "Reminder sent", "in": "Process_OrderHandling", "as": "$sent" },
    { "op": "connect", "source": "$remind", "target": "$sent" },
    { "op": "set", "id": "$book", "values": { "name": "Book invoice in ERP", "doc": "Posts the invoice to the ledger." } },
    { "op": "ext", "id": "$book", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "book-invoice", "retries": "3" } },
    { "op": "ext", "id": "$remind", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "remind-customer" } }
  ]
}
```

`bpmn kinds --json` -> `opsExample` returns exactly this object; the result
is a valid Camunda 8 file (FEEL condition, ISO duration, a job type for every
service and send task).

## Output, errors and exit codes

Text result of a mutating command: one line per created / changed / removed
element (`created userTask Activity_CheckInvoice "Check invoice" - after
Event_OrderReceived`), then notes (`note: inserted between A and B`), the
batch aliases of an `apply` (`aliases: $check = Activity_CheckInvoice, ...`),
the errors a `--force` write let through (`forced E_CODE element: message`),
the warnings the change **added** (`warning W_CODE element: message
(hint)`; a validator's finding names it: `warning [design]
W_DESIGN_COMPLEXITY ...`; three or more of one code are one line with the
ids: `warning W_UNREACHABLE x20 [Activity_A, Activity_B, ...]: <the first
one's message>  (<its hint>)`), `resolved: W_DEAD_END Activity_A, ...` for
the findings it fixed, and one line counting the warnings the file already
had (``12 warnings already in the file (not repeated: `bpmn validate <file>`
lists them)``; a pre-existing error, `W_PREEXISTING_ERROR`, counts among
them, and so do the findings of the platform profile, `W_C7_*` / `W_C8_*`,
the file had: the count is what `bpmn validate` lists). A warning keeps its
identity through a rename (same code, element and related elements); a
warning about a group (`W_DUPLICATE_NAME`: every element of one name) is
the same warning while the group only shrinks (one of three equally named
tasks removed), and is added when it takes in another element. The warnings
of an `apply` batch are those of its final state: lanes added before the
pool that wraps their process give no `W_LANES_WITHOUT_POOL`, a second
incoming flow a later op moves to a join gateway no `W_IMPLICIT_JOIN`.
One `validator <name> (<why it ran>): n error(s), m warning(s) in the
result` line per validator that ran (the design profile), then the layout
block, then `written: <file>`
(`dry run: <file> not written` with `--dry-run`; `unchanged: <file> (the
result equals the file; nothing written)` when the change left the file as
it was). With `--show` the model view follows. A new file (`new`) has no
warnings of its own yet: its result lists them all, the platform profile's
findings as an edit reports them (`new --target camunda8` lists
`W_C8_DEPLOY_START_EVENT`, which the edit that adds the start then
resolves). The layout block:

```
layout: ok - incremental (hand-made diagram: kept, changes placed locally)
  placed: Activity_Review, Flow_ReviewToDone
  moved: Event_Done
  rerouted: Flow_4
  format place #1: moved Activity_Review; rerouted Flow_ReviewToDone
layout quality: score 12 -> 10; resolved: crossings [Flow_3, Flow_7]
```

`layout: ok - full (<reason>)` after a redraw, `layout: skipped` with
`--no-layout`; `placed` / `moved` / `rerouted` / `pruned` / `note` lines come
from the incremental layout, one `format <op> #<index>` line per format op
(what it colored, placed a label for, moved and rerouted, or `no change`),
and `layout quality` compares the layout problems before and after (`added:`
and `resolved:` name them with ids).

`--summary` prints a short result instead: `created <kind>: <ids>` per kind,
the batch aliases (`aliases: $archive = Activity_Archive`), `changed:` (an
element the change created is listed under `created` only),
`renamed: <old> -> <new>` (a flow whose id named its old ends, renamed after
its new ones: use the new id from now on) and `removed:` with the ids (every
id once: when a bridge takes over the id of the flow the change removed,
the bridged flow's old id is removed and the taken id changed, not
renamed), one
`format <op> #<index>: ...` line per format op (what it moved, rerouted or
coloured, or why it changed nothing), forced errors, the added warnings
(floods as one line), `warnings: n added, n resolved, n already in the
file`, one layout line (`layout: incremental, score 12 -> 14; added:
crossings [Flow_1, Flow_3]`; without a drawing before, the number of layout
problems instead of the list) and the file line (the worked session's file
after its last step):

```
$ bpmn add order.bpmn userTask "Archive" --after Activity_CheckInvoice --summary
created userTask: Activity_Archive
created sequenceFlow: Flow_ArchiveToInvoiceOk
changed: Flow_CheckInvoiceToArchive
renamed: Flow_CheckInvoiceToInvoiceOk -> Flow_CheckInvoiceToArchive
layout: incremental, score 0 -> 0
written: order.bpmn

$ bpmn apply order.bpmn ops.json --summary      # the same add with "as": "$archive", then color "$archive"
created userTask: Activity_Archive
created sequenceFlow: Flow_ArchiveToInvoiceOk
aliases: $archive = Activity_Archive
changed: Flow_CheckInvoiceToArchive
renamed: Flow_CheckInvoiceToInvoiceOk -> Flow_CheckInvoiceToArchive
format color #1: colored Activity_Archive
layout: incremental, score 0 -> 0
written: order.bpmn
```

`--json` on stdout, compact on one line (`--pretty` indents it; shown
indented here):

```json
{
  "ok": true, "file": "order.bpmn", "written": true, "unchanged": false,
  "created": [{ "id": "Activity_X", "kind": "userTask", "name": "...", "detail": "after Event_Y" }],
  "changed": [], "removed": [],
  "warnings": {
    "added": [{ "code": "W_...", "message": "...", "element": "...", "hint": "..." }],
    "resolved": [{ "code": "W_DEAD_END", "message": "...", "element": "Activity_Y" }],
    "preexistingCount": 12
  },
  "notes": ["..."],
  "aliases": { "$check": "Activity_X" },
  "renamed": { "Flow_CheckInvoiceToDone": "Flow_CheckInvoiceToX" },
  "layout": {
    "status": "ok", "mode": "incremental", "reason": "hand-made diagram: kept, changes placed locally",
    "warnings": [], "expanded": [],
    "placed": ["Activity_X", "Flow_XToY"], "moved": [], "rerouted": ["Flow_4"], "pruned": [], "notes": [],
    "format": [{ "op": "color", "index": 1, "moved": [], "rerouted": [], "colored": ["Activity_X"] }],
    "metrics": {
      "before": { "counts": { "crossings": 1, "...": 0 }, "score": 5 },
      "after": { "counts": { "crossings": 0, "...": 0 }, "score": 0 },
      "added": [], "resolved": [{ "kind": "crossings", "ids": ["Flow_3", "Flow_7"] }]
    }
  },
  "validation": { "errors": [], "platform": { "...": "the engine profile" }, "validators": [{ "name": "design", "detail": "...", "errors": [], "warnings": [], "preexisting": [], "resolved": [], "counts": { "errors": 0, "warnings": 0 } }] },
  "importWarnings": [],
  "view": { "...": "only with --show" }
}
```

`warnings.added` holds the op warnings, the validation findings the change
introduced (lint, the platform profile, validators) and the layout warnings
(`W_LAYOUT_<code>`); `warnings.resolved` the findings it fixed;
`warnings.preexistingCount` how many warnings the file already had and still
has, the platform profile's findings included (they are not repeated; `bpmn
validate --json` lists every finding).
`written` is `false` with `--dry-run`, and when `unchanged` is `true`: the
result equals the input file byte for byte, so nothing is written over it
(`--out <other file>` still writes the copy). `importWarnings` lists what
bpmn-moddle reported while reading the input file (informational, first line
of each warning; a design model's `calledDecision` is not one).
`validation.validators` is there when a validator ran (the design profile,
library validators); their findings in `validation.errors` /
`warnings.added` carry `"validator"` and `"severity"`. `aliases` (batch
aliases -> final ids) and `renamed` (old id -> new id of what the change
renamed) are there when the change has any. With `--summary --json`: `{ok,
file, written, unchanged, created: {<kind>: [ids]}, aliases?, changed,
renamed?, removed, forced?, warnings: {added, resolvedCount,
preexistingCount}, layout: {status, mode?, score?: {before?, after},
added?, problems?}, format?: [{op, index, moved, rerouted, reshaped?,
colored?, labels?, notes?}]}`.
`--strict` still exits 5 when the result has any warning (also one the file
already had).

### stdin and stdout

`-` as the file reads the model from stdin: `show -`, `find - <text>`,
`validate -`, `metrics -`, `ext list - <id>`. A mutating command on `-`
(`add -`, `set -`, `apply - ops.json`, `layout -`, `new -`, ...) writes its
result to stdout unless `-o <file>` names a file; `-o -` writes the result of
any mutating command to stdout and leaves its input file as it was. When the
XML goes to stdout the report (text or `--json`) goes to stderr and says
`written: -`; a `--dry-run` writes no XML and reports on stdout. stdin holds
one input: `apply - -` (model and ops) is `E_USAGE`; pass the ops as a file
(`bpmn apply - ops.json < model.bpmn > new.bpmn`) or the model as a file
(`bpmn apply model.bpmn - < ops.json`). A model from stdin has no file name,
so the design-iq repository lookup (`--profile auto`) does not apply to it.

Errors go to stderr: `error E_CODE: message`, then `  hint: ...` and the
candidate ids when a reference could not be resolved; with `--json`:
`{"ok": false, "error": {"code", "message", "element?", "related?",
"candidates?", "hint?", "op?"}}`.

| exit | meaning |
| --- | --- |
| 0 | ok (warnings allowed) |
| 1 | usage error: unknown command / option, bad ops JSON (`E_USAGE`) |
| 2 | model or validation error (`E_NOT_FOUND`, `E_CROSS_SCOPE`, `E_VALIDATION`, ...) |
| 3 | layout error (`E_LAYOUT_*`) |
| 4 | I/O or parse error (`E_FILE_NOT_FOUND`, `E_PARSE`, `E_IMPORT_LOSSY`, `E_FILE_EXISTS`) |
| 5 | `--strict` and the result has warnings (`validate`: also import warnings) |
| 70 | internal error (`E_INTERNAL`; `BPMN_DEBUG=1` prints the stack) |

The full error catalogue with a fix for every code: `bpmn kinds` (section
"ERRORS AND WARNINGS") or `bpmn kinds --json` -> `errors`.

## Quoting

- Expressions and anything containing `$`: **single quotes**, e.g.
  `--condition '${amount > 100}'`, `set Flow_InvoiceOkToBookInvoice condition='${ok}'`. In double
  quotes the shell expands `${...}` to nothing and the CLI rejects the empty
  expression (`E_INVALID_VALUE`).
- Names with spaces: quote them, `add userTask "Check invoice"`.
- `key=value` with spaces: quote the whole pair, `name="Check the invoice"`.
- In JSON nothing is expanded; ops files are the safest place for
  expressions.

## The DI contract

- **The CLI keeps hand layouts.** A drawing made in a modeler (or changed with
  the format commands) is never thrown away by a semantic edit: existing
  shapes keep their bounds, existing connections their waypoints, and every
  other DI attribute (colours, foreign attributes, `isMarkerVisible`, ...)
  survives. New elements are placed into it locally, removed ones pruned,
  affected connections rerouted ([Layout modes](#layout-modes)). The file's
  DI id style (`<id>_di`, `BPMNShape_<id>`, `Shape_<id>`) is kept for new DI.
- **The engine draws** a new file, a file without diagram, a drawing it made
  itself and nobody changed (`auto`), and everything on request
  (`--relayout`, `--layout full`, `bpmn layout`). Then all shapes, edges,
  waypoints and labels are derived from the semantic model; colours are
  carried over by element id, manual positions are not. The ids stay: every
  BPMNShape / BPMNEdge keeps the id it had, every plane and diagram keeps its
  id (a plane named after the old root, `BPMNPlane_<processId>`, follows a new
  collaboration root), and new DI takes the file's DI id style, so a redraw
  changes coordinates, not ids.
- **design-iq stickies follow their node.** A `bpmiq:sticky` extension
  element of a process (workshop notes of Miragon design-iq, absolute
  `x` / `y` on the element, no DI) belongs to the flow node nearest to it.
  When a write moves that node (incremental placement, a format command, a
  redraw), the sticky moves by the same shift; a write that moves no node
  never touches it. The result lists them (`stickies moved: Sticky_1 (with
  Activity_Check)`, JSON `layout.stickies`).
- **You still never write coordinates.** The picture is changed with the
  [format commands](#formatting-without-xml), which name elements (rows,
  columns, sides), and read back with `show --layout` and `metrics`.
- **Expanded / collapsed** is kept from the existing DI: a sub-process is
  expanded by default; it is collapsed only when the existing DI says so or
  when you ask (`add ... --collapsed`, `set <id> expanded=false`,
  `layout --collapse <id>`). `layout --expand <id>` re-expands it; in a kept
  drawing collapsing moves the content to its own diagram and closes the gap,
  expanding makes room.
- **`--no-layout`** writes the semantic model with the old DI left in place
  (DI of removed elements is pruned). The diagram is then stale: new elements
  have no shape until the next write or `bpmn layout`.
- **Branches.** At a split the layouter picks one outgoing flow as the
  straight continuation ("spine"): the default flow, or without one the first
  declared flow that leads to an end event (else simply the first). The other
  branches are placed alternately below and above the spine in declaration
  order; with a default flow they all go below it. So for a plain two-way
  gateway the first flow is on top and the second below, but as soon as a
  default exists it is the one drawn straight, wherever it was declared. The
  CLI keeps the declaration order tidy (a new node is declared right after
  its anchor, flows right after their source); `bpmn order` reorders the
  flows explicitly and `set <flowId> default=true` picks the spine. In a kept
  drawing a new branch goes one row below the existing branches of its split.
- **Lanes** are only drawn inside a pool (`W_LANES_WITHOUT_POOL`): add a
  participant, it wraps the existing process.

### Layout conventions of the built-in engine

The default engine (`--engine clean`) draws every diagram the same way, so an
agent can predict the picture from the semantics:

- left to right; the **happy path** (the branch that reaches farthest) is a
  straight line on the top row; every other branch of a split becomes a band
  **below** it, in declaration order (`bpmn order` changes it);
- branches are packed: a band is reused when its column range is free, and a
  new band is inserted only where a straight drop line from the split would
  otherwise be blocked;
- **boundary event** handler paths hang below their host activity; the events
  sit on the host's bottom border, labels to their right;
- **loops** (flows that close a cycle) are routed underneath the elements they
  span and enter their target from below (over the top only when that avoids
  a crossing); joins are entered from below;
- **sub-processes** are laid out recursively (expanded by default, own plane
  when collapsed); **event sub-processes** sit below the content of their own
  lane (below the main content without lanes) and are expanded or collapsed
  like any other sub-process (`set expanded=false`, `layout --collapse`);
- **text annotations** go above their element, **data objects/stores** below;
  **compensation handlers** hang under their boundary event; annotations
  owned by the collaboration go next to their element (inside its lane or
  pool, outside the pools for a pool, in the gap between the pools for a
  message flow);
- **pools** stack vertically, in the declared order unless another order lets
  fewer message flows cut through shapes (with up to six pools); **lanes** are
  horizontal bands that fill their pool; message flows run on their own
  channel in the gap between two pools, and around the outside (right of all
  pools) when another pool lies between them; they leave and enter their
  elements vertically and jog into a free column gap when the straight line
  would cut a shape;
- **associations** (to annotations and data objects) are routed orthogonally
  around the shapes; they fall back to the straight line BPMN normally draws
  when that is free; an association between scope levels (a note on the
  process connected to a task in an expanded sub-process) is drawn as a
  straight line when both ends are on one plane, and reported as
  `W_LAYOUT_DI_NOT_CREATED` when they are not;
- gateway names are placed above the gateway, event names below, flow names
  above the longest horizontal segment near its start. Labels that would land
  on a shape, on another label or on a line are moved to the next free spot.

`bpmn validate` runs the engine as a dry run; the engine reports elements it
could not draw as `W_LAYOUT_DI_NOT_CREATED`.

## What a write changes

BPMN files live in git or are synced live by a host that replaces one text
region per save (design-iq). So a write rewrites only the elements the change
touched, in the file's own style:

- **Everything else keeps its text**, byte for byte: the XML declaration and
  the comments before the root, the root start tag with its namespace
  declarations in their order, vendor attributes before or between the typed
  ones, quoting, entities (`&amp;` stays `&amp;`), CDATA sections, comments,
  blank lines, indentation, a missing final line break. A rename changes one
  line (of a labelled event or gateway, the layout also fits its label's
  bounds).
- **A changed element keeps its style**: its start tag as written when only
  its children changed, else its attributes in their order with the new
  values (a new attribute goes after the one bpmn-moddle writes before it); a
  script or condition written as CDATA stays CDATA; a label on one line stays
  on one line; a retype keeps the attributes and renames both tags.
- **A new element follows the file**: its indentation unit (two or four
  spaces, tabs), its line breaks, `/>` with or without a space. A namespace
  the change needs is added to the root tag, which otherwise stays as written.
- **No-op**: when the result equals the file (a rename to the current name,
  `set` to the current value, `tidy` on a tidy drawing), nothing is written
  and the file keeps its modification time: `unchanged: <file>` (JSON
  `"written": false, "unchanged": true`). `--out <other>` still writes the
  copy; `--dry-run` says `(unchanged)`.
- **`incoming` / `outgoing` lists** are derived data (optional in BPMN 2.0).
  The CLI completes them in memory (the placement grammar, the views and the
  lint read them) and writes them the way the file keeps them: a file that
  never lists them never gets them; a file that lists them (Camunda Modeler,
  bpmn-js) gets the entries of new and changed flows; a missing entry of an
  unchanged flow is not added. A new file, and one without any sequence flow
  yet, gets them the way the Modeler writes them.
- **Comments** on the lines right before an element the change removes, after
  it on its last line, or inside it, go with it, and the result says so:
  `note: 1 XML comment(s) dropped: they were inside or next to elements the
  change removed or rewrote`. All other comments stay where they are.
- **Encoding**: a file is read in the encoding its XML declaration names
  (UTF-8 without one, UTF-16 by its byte order mark, ISO-8859-1 /
  Windows-1252 and the other encodings a browser knows; one it cannot decode
  is `E_IO` unless the file is plain ASCII), and every write is UTF-8. A
  written file whose declaration named another encoding declares UTF-8 (note:
  `the XML declaration named the encoding ISO-8859-1; ...`), so a parser that
  honours the declaration reads every character as written. Re-encoding in
  the declared encoding is not done: it cannot write every character (an
  ISO-8859-1 file has no `€`, names and comments cannot use character
  references). A no-op is not written, so such a file keeps its bytes. The
  in-memory API does the same on strings: a changed result declares UTF-8;
  store it as UTF-8.
- **Safety**: the result must read back (with bpmn-moddle) as exactly the
  changed model. If it does not, or the file has something the text reader
  does not support (a DOCTYPE), the whole file is written the way
  bpmn-moddle serialises it, with the note `the file's formatting was not
  kept (<reason>) ...` and the number of comments dropped. A forced write of
  a lossy import (`--force` on `E_IMPORT_LOSSY`) is always written that way:
  it drops what bpmn-moddle could not read.
- **The layout still changes the drawing** where it acts: in `auto` mode a
  file without a diagram is drawn on its first write, missing DI (an edge
  without a `BPMNEdge`, a plane without `bpmnElement`) is completed, and a
  name that no longer fits grows its task. `--no-layout` changes no DI
  except removing that of removed elements. A full redraw (`bpmn layout`,
  `--relayout`) rewrites the geometry of the DI section; its DI elements keep
  their ids (new ones get the file's id style).

`npm run roundtrip` measures this on a corpus (no-ops, renames, inserts; see
[docs/testing.md](docs/testing.md#roundtrip-fidelity)).

## Limitations

- Only **one root** is laid out: the collaboration when pools exist, otherwise
  the single process. Several root processes without pools are a validation
  error (`E_MULTIPLE_ROOTS`); a process not referenced by any pool while a
  collaboration exists is one too (`E_ORPHAN_PROCESS`).
- `complexGateway` is not supported, nor are choreographies, implicit throw
  events and groups. A file that already has one can still be edited (the
  error is reported as `W_PREEXISTING_ERROR`), and `retype` turns it into a
  supported gateway.
- The built-in engine draws conventional, readable diagrams, not pretty ones:
  expect long edges in models with many re-joins, and dotted association lines
  that cross a sequence flow where no free route exists. `--engine auto` uses
  `bpmn-auto-layout@2.0.0-alpha.2` (pinned) as a fallback.
- The format commands grow frames when they need room; `compact` (or
  `space --by -<amount>`) closes empty rows and columns and shrinks them
  again, but only strip by strip (rows and columns that are empty across the
  whole pool / lane band), so a drawing with content spread over many rows
  shrinks less than a full redraw (`bpmn layout`) would. Groups (`bpmn:Group` boxes) are not frames: shapes may be
  placed into or out of a group's box (a node placed next to an element
  inside a group goes into that group, which grows). Vertical pools and lanes
  (`isHorizontal="false"`) are not supported by the incremental layout and
  the format commands: an edit that would place, move or route anything on
  such a diagram is redrawn in full in `auto` mode
  (`W_LAYOUT_INCREMENTAL_FAILED`) and refused with `--layout incremental`
  (`E_LAYOUT_INCREMENTAL`); renames and property changes keep the drawing
  (except a name that no longer fits its task, which grows it).
- A second `BPMNDiagram` showing a process or collaboration that another
  diagram already shows is treated as a read-only view by the incremental
  layout: DI of removed elements is pruned there, nothing else changes.
- Files with content bpmn-moddle cannot represent (unknown elements,
  unresolved references, duplicate ids, an element the schema allows once
  appearing twice, such as two `loopCharacteristics` on one task: the reader
  keeps only the last) are refused with `E_IMPORT_LOSSY`; `--force` writes
  anyway and drops that content (of a duplicate element the last one stays);
  that write uses bpmn-moddle's own formatting (the file's comments and
  formatting are not kept, the result says so). `show` and `validate` print
  it as `import:` lines. The library refuses them
  the same way (`Doc.fromXml` + `mutateDoc` without `force: true`).
- A write keeps the order of the file's elements ([What a write
  changes](#what-a-write-changes)), so it no longer repairs an element the
  file has in a place the BPMN XSD does not allow (0.2 rewrote every file in
  bpmn-moddle's order, which fixed such a file as a side effect). The engines
  refuse such a file before and after the edit; `bpmn layout` does not
  reorder either. A new element goes after the sibling bpmn-moddle writes
  before it (in a file in XSD order, its place in that order).
- New ids come from names and places, so two branches of a file (git, two
  agents) that each add an element of the same name, or an unnamed element
  next to anchors of the same name, produce the same id; merging both gives
  a duplicate id, which the next read refuses (`E_IMPORT_LOSSY`: rename one
  of them while resolving the merge). A flow whose id names its ends is renamed when an edit changes
  its ends (the one exception to "existing ids never change"); the library
  keeps every id with `Doc.followFlowEnds = false`, the CLI has no switch.
- The Camunda 8 profile checks FEEL syntax, not meaning: an unknown
  variable or function, a type error or a FEEL value of an attribute
  Camunda 8 parses only when the process runs is found by the engine only.
  The FEEL check follows the 762 engine-checked expressions; where Camunda's
  grammar was not probed it accepts (a missed error costs a deploy round
  trip, a false one would block a valid file). An event-based gateway of
  a file that leaves out the `<bpmn:outgoing>` lists is refused by Camunda 8
  (it counts the listed flows; the profile reports it), and a write keeps
  the file's way of listing them. `zeebe:publishMessage` (accepted by
  Camunda 8.9, not run) is not in the Zeebe descriptor and known to the
  profile only.
- `bpmn-moddle` never sets `$parent` for elements created in memory; the CLI
  maintains containment, `incoming`/`outgoing` (complete in memory, written
  the way the file keeps them) and every reference itself. A hand-edited file
  with broken links is reported by `bpmn validate` (`E_DANGLING_REF`,
  `E_FLOW_LINKS`).

## A worked session

```
$ bpmn new order.bpmn --name "Order handling" --target camunda8
created process Process_OrderHandling "Order handling"
warning W_NO_START Process_OrderHandling: Process Process_OrderHandling has no start event  (Add one: `bpmn add <file> startEvent "<Name>" --in Process_OrderHandling` (or --before <firstNodeId>).)
warning W_NO_END Process_OrderHandling: Process Process_OrderHandling has no end event  (Add one after the last node: `bpmn add <file> endEvent "<Name>" --after <nodeId>`.)
layout: ok - full (no diagram before: drawn from scratch)
layout quality: score 0
written: order.bpmn

$ bpmn add order.bpmn start "Order received" --message OrderReceived
created startEvent:message Event_OrderReceived "Order received" - in Process_OrderHandling
created message Message_OrderReceived "OrderReceived" - root element
warning W_DEAD_END Event_OrderReceived: startEvent:message Event_OrderReceived "Order received" has no outgoing flow  (Continue the flow (`bpmn add <file> <kind> "<Name>" --after Event_OrderReceived`) or end it (`bpmn add <file> endEvent "<Name>" --after Event_OrderReceived`).)
resolved: W_C8_DEPLOY_START_EVENT Process_OrderHandling
1 warning already in the file (not repeated: `bpmn validate <file>` lists them)
layout: ok - full (no diagram before: drawn from scratch)
layout quality: score 0
written: order.bpmn

$ bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived
created userTask Activity_CheckInvoice "Check invoice" - after Event_OrderReceived
created sequenceFlow Flow_OrderReceivedToCheckInvoice - Event_OrderReceived -> Activity_CheckInvoice
note: appended after Event_OrderReceived
note: Activity_CheckInvoice is a Camunda user task (zeebe:userTask), like Camunda Modeler creates them
warning W_DEAD_END Activity_CheckInvoice: userTask Activity_CheckInvoice "Check invoice" has no outgoing flow  (Continue the flow (`bpmn add <file> <kind> "<Name>" --after Activity_CheckInvoice`) or end it (`bpmn add <file> endEvent "<Name>" --after Activity_CheckInvoice`).)
resolved: W_DEAD_END Event_OrderReceived
1 warning already in the file (not repeated: `bpmn validate <file>` lists them)
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn add order.bpmn end "Invoice handled" --after Activity_CheckInvoice
created endEvent Event_InvoiceHandled "Invoice handled" - after Activity_CheckInvoice
created sequenceFlow Flow_CheckInvoiceToInvoiceHandled - Activity_CheckInvoice -> Event_InvoiceHandled
note: appended after Activity_CheckInvoice
resolved: W_NO_END Process_OrderHandling, W_DEAD_END Activity_CheckInvoice
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ cat > ops.json <<'EOF'
{ "ops": [
  { "op": "split", "after": "Activity_CheckInvoice", "name": "Invoice ok?", "as": "$ok",
    "branches": [
      { "flowName": "yes", "condition": "= ok", "nodes": [{ "kind": "serviceTask", "name": "Book invoice", "as": "$book" }] },
      { "flowName": "no", "default": true, "nodes": [{ "kind": "userTask", "name": "Clarify invoice", "as": "$clarify" }] } ] },
  { "op": "add", "kind": "boundary:timer", "name": "Reminder", "on": "$clarify", "timer": "P2D", "nonInterrupting": true, "as": "$reminder" },
  { "op": "add", "kind": "sendTask", "name": "Remind customer", "after": "$reminder", "as": "$remind" },
  { "op": "add", "kind": "end", "name": "Reminder sent", "after": "$remind" },
  { "op": "ext", "id": "$book", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "book-invoice" } },
  { "op": "ext", "id": "$remind", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "remind-customer" } }
] }
EOF
$ bpmn apply order.bpmn ops.json
created exclusiveGateway Gateway_InvoiceOk "Invoice ok?" - between Activity_CheckInvoice and Event_InvoiceHandled
created serviceTask Activity_BookInvoice "Book invoice" - after Gateway_InvoiceOk
created sequenceFlow Flow_InvoiceOkToBookInvoice "yes" - Gateway_InvoiceOk -> Activity_BookInvoice
created userTask Activity_ClarifyInvoice "Clarify invoice" - after Gateway_InvoiceOk
created sequenceFlow Flow_InvoiceOkToClarifyInvoice "no" - Gateway_InvoiceOk -> Activity_ClarifyInvoice
created exclusiveGateway Gateway_InvoiceOk_join - join of Gateway_InvoiceOk
created sequenceFlow Flow_BookInvoiceToInvoiceOkJoin - Activity_BookInvoice -> Gateway_InvoiceOk_join
created sequenceFlow Flow_ClarifyInvoiceToInvoiceOkJoin - Activity_ClarifyInvoice -> Gateway_InvoiceOk_join
created sequenceFlow Flow_InvoiceOkJoinToInvoiceHandled - Gateway_InvoiceOk_join -> Event_InvoiceHandled
created boundaryEvent:timer Event_Reminder "Reminder" - on Activity_ClarifyInvoice
created sendTask Activity_RemindCustomer "Remind customer" - after Event_Reminder
created sequenceFlow Flow_ReminderToRemindCustomer - Event_Reminder -> Activity_RemindCustomer
created endEvent Event_ReminderSent "Reminder sent" - after Activity_RemindCustomer
created sequenceFlow Flow_RemindCustomerToReminderSent - Activity_RemindCustomer -> Event_ReminderSent
changed sequenceFlow Flow_CheckInvoiceToInvoiceOk - Activity_CheckInvoice -> Gateway_InvoiceOk (was -> Event_InvoiceHandled) (renamed from Flow_CheckInvoiceToInvoiceHandled: its id named its old ends)
changed serviceTask Activity_BookInvoice "Book invoice" - ext added zeebe:taskDefinition
changed sendTask Activity_RemindCustomer "Remind customer" - ext added zeebe:taskDefinition
note: inserted Gateway_InvoiceOk between Activity_CheckInvoice and Event_InvoiceHandled
note: appended after Gateway_InvoiceOk
note: appended after Gateway_InvoiceOk
note: Activity_ClarifyInvoice is a Camunda user task (zeebe:userTask), like Camunda Modeler creates them
note: split Gateway_InvoiceOk: 2 branch(es) ending at Activity_BookInvoice, Activity_ClarifyInvoice, joined at Gateway_InvoiceOk_join, continues to Event_InvoiceHandled
note: attached to Activity_ClarifyInvoice
note: appended after Event_Reminder
note: appended after Activity_RemindCustomer
aliases: $ok = Gateway_InvoiceOk, $book = Activity_BookInvoice, $clarify = Activity_ClarifyInvoice, $reminder = Event_Reminder, $remind = Activity_RemindCustomer
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn show order.bpmn
namespaces: zeebe, modeler
process Process_OrderHandling "Order handling" executable
  startEvent:message Event_OrderReceived "Order received" [message OrderReceived] -> Activity_CheckInvoice (Flow_OrderReceivedToCheckInvoice)
  userTask Activity_CheckInvoice "Check invoice" [ext: zeebe:userTask] -> Gateway_InvoiceOk (Flow_CheckInvoiceToInvoiceOk)
  exclusiveGateway Gateway_InvoiceOk "Invoice ok?" -> Activity_BookInvoice (Flow_InvoiceOkToBookInvoice "yes" if = ok), Activity_ClarifyInvoice (Flow_InvoiceOkToClarifyInvoice "no" default)
  serviceTask Activity_BookInvoice "Book invoice" [job=book-invoice, ext: zeebe:taskDefinition] -> Gateway_InvoiceOk_join (Flow_BookInvoiceToInvoiceOkJoin)
  exclusiveGateway Gateway_InvoiceOk_join -> Event_InvoiceHandled (Flow_InvoiceOkJoinToInvoiceHandled)
  endEvent Event_InvoiceHandled "Invoice handled"
  userTask Activity_ClarifyInvoice "Clarify invoice" [ext: zeebe:userTask] -> Gateway_InvoiceOk_join (Flow_ClarifyInvoiceToInvoiceOkJoin)
    boundaryEvent:timer Event_Reminder "Reminder" [P2D, non-interrupting] -> Activity_RemindCustomer (Flow_ReminderToRemindCustomer)
  sendTask Activity_RemindCustomer "Remind customer" [job=remind-customer, ext: zeebe:taskDefinition] -> Event_ReminderSent (Flow_RemindCustomerToReminderSent)
  endEvent Event_ReminderSent "Reminder sent"
root: message Message_OrderReceived "OrderReceived"
problems: none

$ bpmn set order.bpmn Activity_ClarifyInvoice "name=Clarify invoice with customer" "doc=Call the customer."
changed userTask Activity_ClarifyInvoice "Clarify invoice with customer" - name=Clarify invoice with customer
changed userTask Activity_ClarifyInvoice "Clarify invoice with customer" - doc=Call the customer.
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn add order.bpmn participant "Order handling"
created collaboration Collaboration_OrderHandling
created participant Participant_OrderHandling "Order handling" - wraps process Process_OrderHandling
note: collaboration Collaboration_OrderHandling created; Participant_OrderHandling wraps the existing process Process_OrderHandling
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn add order.bpmn participant "Customer" --black-box
created participant Participant_Customer "Customer" - black box (no process)
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn connect order.bpmn Activity_RemindCustomer Participant_Customer --message Reminder
created message Message_Reminder "Reminder" - root element
created messageFlow Flow_RemindCustomerToCustomer - Activity_RemindCustomer -> Participant_Customer
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn show order.bpmn --layout
diagram BPMNPlane_Collaboration_OrderHandling (Collaboration_OrderHandling)
  columns: c0..c5
  participant Participant_OrderHandling "Order handling"
    row 1: c0 Event_OrderReceived, c1 Activity_CheckInvoice, c2 Gateway_InvoiceOk, c3 Activity_BookInvoice, c4 Gateway_InvoiceOk_join, c5 Event_InvoiceHandled
    row 2: c3 Activity_ClarifyInvoice
    row 3: c4 Activity_RemindCustomer, c5 Event_ReminderSent
  participant Participant_Customer "Customer"
layout quality: score 0: no layout problems

$ bpmn color order.bpmn Activity_CheckInvoice Flow_CheckInvoiceToInvoiceOk Gateway_InvoiceOk --color red
layout: ok - incremental (format operations only: drawing kept)
  format color #0: colored Activity_CheckInvoice, Flow_CheckInvoiceToInvoiceOk, Gateway_InvoiceOk
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn label order.bpmn Gateway_InvoiceOk --side below
layout: ok - incremental (format operations only: drawing kept)
  format label #0: label placed Gateway_InvoiceOk
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn place order.bpmn Activity_RemindCustomer Event_ReminderSent --row-of Activity_ClarifyInvoice --after Activity_ClarifyInvoice
layout: ok - incremental (format operations only: drawing kept)
  format place #0: moved Activity_RemindCustomer, Event_ReminderSent; rerouted Flow_ReminderToRemindCustomer, Flow_ClarifyInvoiceToInvoiceOkJoin, Flow_RemindCustomerToCustomer
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn add order.bpmn serviceTask "Archive invoice" --after Activity_BookInvoice
created serviceTask Activity_ArchiveInvoice "Archive invoice" - after Activity_BookInvoice
created sequenceFlow Flow_ArchiveInvoiceToInvoiceOkJoin - Activity_ArchiveInvoice -> Gateway_InvoiceOk_join
changed sequenceFlow Flow_BookInvoiceToArchiveInvoice - Activity_BookInvoice -> Activity_ArchiveInvoice (was -> Gateway_InvoiceOk_join) (renamed from Flow_BookInvoiceToInvoiceOkJoin: its id named its old ends)
note: inserted between Activity_BookInvoice and Gateway_InvoiceOk_join
warning W_C8_DEPLOY_IMPLEMENTATION Activity_ArchiveInvoice: serviceTask Activity_ArchiveInvoice has no zeebe:taskDefinition: Camunda 8 needs the job type a worker subscribes to and refuses the file  (Give it a job type: `bpmn ext add <file> Activity_ArchiveInvoice zeebe:taskDefinition type=<jobType>`.)
layout: ok - incremental (hand-made diagram: kept, changes placed locally)
  placed: Activity_ArchiveInvoice, Flow_ArchiveInvoiceToInvoiceOkJoin
  moved: Participant_OrderHandling, Event_InvoiceHandled, Activity_RemindCustomer, Event_ReminderSent, Gateway_InvoiceOk_join, Participant_Customer
  rerouted: Flow_BookInvoiceToArchiveInvoice
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn metrics order.bpmn
score 0: no layout problems

$ bpmn validate order.bpmn
W_C8_DEPLOY_IMPLEMENTATION Activity_ArchiveInvoice: serviceTask Activity_ArchiveInvoice has no zeebe:taskDefinition: Camunda 8 needs the job type a worker subscribes to and refuses the file  (Give it a job type: `bpmn ext add <file> Activity_ArchiveInvoice zeebe:taskDefinition type=<jobType>`.)
platform: c8 (modeler:executionPlatform "Camunda Cloud") - 1 refused at deploy, 0 runtime, 0 practice finding(s)
layout: ok
valid, 1 warning(s)

$ bpmn ext add order.bpmn Activity_ArchiveInvoice zeebe:taskDefinition type=archive-invoice --summary
changed: Activity_ArchiveInvoice
warnings: 0 added, 1 resolved, 0 already in the file
layout: incremental, score 0 -> 0
written: order.bpmn
```

The first participant must be a normal pool: it wraps the existing process
(`Participant_OrderHandling = Process_OrderHandling`). A `--black-box` pool
never wraps, so adding it first on a pool-less file fails with
`E_EMPTY_COLLABORATION` / `E_ORPHAN_PROCESS` and nothing is written.

The last steps format the drawing without XML: `show --layout` reads it,
`color` / `label` / `place` change it (the drawing is now hand-made), and the
following `add` therefore keeps it and places "Archive invoice" locally
between "Book invoice" and the join (`layout: ok - incremental`) instead of
redrawing; the flow it was spliced into named its old ends and is renamed
after its new ones. `metrics` confirms that no layout problem was
introduced. The file targets Camunda 8, so `validate` (and already the
`add`) reports that the new service task has no job type; the `ext add`
from the hint fixes it (`--summary`: one line per change, the warning it
resolved counted), and the result deploys to Camunda 8.9.

(The result lines and the `show` views above are copied from the real output
of this version; wording may change between versions, ids and structure are
what matters. `test/batch.test.ts` checks the quick-start `show` block
against the live renderer.)

## Library use

The package has two entries:

- **`@miragon/bpmn-cli`**: the core. It runs in Node and in the browser:
  nothing it imports reads a file, `process`, `Buffer` or a Node builtin
  (checked on every change, see [Browser bundles](#browser-bundles)).
  Strings in, strings and data out.
- **`@miragon/bpmn-cli/node`**: the core plus the file helpers the CLI uses
  (Node only).

### The in-memory API

Every function runs the code of the CLI command it names, without a file:

| function | like | returns |
| --- | --- | --- |
| `applyToXml(xml, ops, opts?)` | `bpmn apply` | `EditResult` |
| `newXml(opts?)` | `bpmn new` | `EditResult` |
| `layoutXml(xml, opts?)` | `bpmn layout` | `EditResult` |
| `validateXml(xml, opts?)` | `bpmn validate --json` | `ValidationReport` |
| `viewXml(xml, opts?)` | `bpmn show --json` | `ModelView`, `ElementDetail` (with `id`), `ElementContext` (with `id` and `context: true`), `AroundView` (with `around`), `LayoutView` (with `layout: true`) |
| `showXml(xml, opts?)` | `bpmn show` | the text |
| `metricsXml(xml)` | `bpmn metrics --json` | `{ score, counts, problems }` |
| `findXml(xml, text, { kind? })` | `bpmn find --json` | `FindHit[]` |
| `extensionsXml(xml, id)` | `bpmn ext list <file> <id> --json` | `ExtensionInfo[]` |

- `ops` is the [ops JSON](#ops-json-bpmn-apply) of `bpmn apply`: an array,
  `{ "ops": [...] }`, or the JSON text of either (schema: `OPS_SCHEMA`, also
  `bpmn kinds --json` -> `ops`). It is checked like `apply` checks it
  (`E_USAGE` naming `ops[<i>]`; values are normalised, `"by": "80"` is 80
  pixels).
- Options of the writing functions (`EditOptions`): `layout` (`'auto'`, the
  default, `'incremental'`, `'full'` or `false`, see
  [Layout modes](#layout-modes)), `engine` (`'clean'` or `'auto'`), `force`,
  `platform` (`'auto'`, `'c7'`, `'c8'`, `'none'`), `profile` (`'auto'`,
  `'design'`, `'none'`), `contentRepo` and `validators` (see
  [design-iq](#design-iq-the-design-profile-and-validators)), `file` (the
  document's name for the validators), `show` (add the model view) and
  `debug` (below). `layoutXml` takes `expand`, `collapse` and `tidy` instead
  of `layout`; `newXml` takes `processName`, `processId`, `executable` and
  `target`; `viewXml` and `showXml` take `id`, `context`, `around`,
  `depth`, `inner`, `scope` and `layout` like `show` (`viewDoc(doc, opts)`
  and `renderShown(view)` do the same on a parsed `Doc`; `aroundView`,
  `elementContext` and `implementationOf` are the builders); `validateXml`
  takes `platform`, `profile`, `contentRepo`, `validators` and `file`.
- `EditResult` is `{ xml, unchanged, result }`: the new document, which
  keeps the input's text wherever the ops changed nothing ([What a write
  changes](#what-a-write-changes)); `unchanged` is `true` when it is
  byte-identical to the input (then `xml` is the input string itself and
  there is nothing to save; a rename to the current name, `tidy` on a tidy
  drawing); `result` is what the CLI prints with `--json`
  ([Output](#output-errors-and-exit-codes)) without `file`, `written` and the
  XML: the warnings as a delta (`result.warnings.added`, `resolved`,
  `preexistingCount`; with batch aliases, `result.aliases` maps each to the
  final id of its element). `renderMutation(result)` gives the CLI's text for it,
  `mutationSummary(result)` / `renderSummary(summary)` the `--summary`
  form, `renderValidation(report)` the text of `validate`.
- The CLI's guards apply: a lossy import (`E_IMPORT_LOSSY`), validation
  errors the ops would introduce (`E_VALIDATION`, also those of the design
  profile and of `validators`) and content a retype would delete
  (`E_WOULD_DROP_CONTENT`) are refused unless `force: true`. The layout
  modes, the format ops, the file's id style for new ids
  ([Ids](#ids)) and the platform profile's new findings
  (`result.validation.platform`) work as on the command line.
- A failure throws a `CliError`: `code`, `category`, `details` (`element`,
  `related`, `candidates`, `hint`, `op`); `toJSON()` is the CLI's `--json`
  error. Nothing is half done: the caller still has its input.

```ts
import { applyToXml, CliError, newXml, renderMutation, showXml } from '@miragon/bpmn-cli';

let { xml } = await newXml({ processName: 'Order handling' });
const edit = await applyToXml(xml, [
  { op: 'add', kind: 'start', name: 'Order received' },
  { op: 'add', kind: 'userTask', name: 'Check invoice', after: 'Event_OrderReceived' },
  { op: 'add', kind: 'end', name: 'Done', after: 'Activity_CheckInvoice' },
]);
if (!edit.unchanged) xml = edit.xml; // and save it
edit.result.created.map((c) => c.id); // ['Event_OrderReceived', 'Activity_CheckInvoice', 'Flow_OrderReceivedToCheckInvoice', 'Event_Done', 'Flow_CheckInvoiceToDone']
edit.result.layout.mode;              // 'full' (no diagram before: drawn from scratch)
renderMutation(edit.result);          // the text `bpmn apply` prints: created ... / layout: ok - full (...)
await showXml(xml);                   // the `bpmn show` text of the quick start above

try {
  await applyToXml(xml, [{ op: 'add', kind: 'userTask', name: 'Ship', after: 'Activity_Check' }]);
} catch (err) {
  if (!(err instanceof CliError)) throw err;
  err.code;               // 'E_NOT_FOUND'
  err.details.candidates; // ['Activity_CheckInvoice']
}
```

The layout engines' diagnostic lines (placement candidates, reroute reasons,
`[strip]` / `[rows]` lines) go to a `debug: (line) => ...` option of one
call, or to `setLayoutDebug(sink)` for the whole process; the CLI sets the
latter when `BPMN_LAYOUT_DEBUG=1` and writes them to stderr.

### File helpers (`@miragon/bpmn-cli/node`)

`readXml(file)` and `readDoc(file)` (`E_FILE_NOT_FOUND`, `E_IO`, `E_PARSE`;
no lossy-import guard), `loadDoc(file, { force })` (`E_IMPORT_LOSSY`),
`writeAtomic(file, text)` (temp file, then rename), `mutateFile(file, ops,
opts)` (typed ops, what every mutating command runs), `mutateDocToFile(doc,
ops, opts)` (`new`), `layoutFile(file, opts)` (`layout`), `layoutDocToFile(doc,
opts)` (`layout` on a loaded document, e.g. one read from stdin) and
`checkFile(file, { platform, profile, validators })` (`validate`).
`FileMutationOptions` adds the file options to the core options: `out`,
`dryRun`, `backup` and `mustNotExist` (`E_FILE_EXISTS` unless `force`); the
result says `written: true` and names the file. A result equal to the file
it was read from is not written back (`written: false`, `unchanged: true`;
`out` to another file still writes the copy). For the validation profile
the helpers look up the design-iq content repository of the file they write
or check (`contentRepoOf(file)`: the nearest `bpmiq.yml`, the model ids of
its models folder) unless `contentRepo` is given or the profile is `none`,
and tell the validators that file (`ctx.file`, the `out` target with
`out`).

### Building blocks

The in-memory API is made of exported parts. `Doc` (`Doc.fromXml(xml)`,
`Doc.create({ target })` with `TARGETS`; query the model), `parseOps` and
`OPS_SCHEMA`, `runOps` (the ops alone, without any guard), the pipeline on a
`Doc`: `mutateDoc(doc, ops, opts)` / `layoutDoc` / `checkDoc` (never write;
`written` is `false`; typed ops, not checked by `parseOps`), with the types
`MutationOptions`, `MutationResult`, `LayoutMode`, `LayoutStatus` and
`LAYOUT_MODES`, and `assertLossless`. What the CLI prints: `mutationReport`,
`mutationWarnings`, `validationReport`, `renderMutation`, `renderValidation`,
`renderView`, `renderDetail`, `renderLayoutView`, `renderFind`,
`renderMetrics`, `renderExtensionList`, `renderProblems`; `guideText`,
`kindsText`, `kindsJson` and `ERROR_CATALOGUE`. Views: `validateDoc`,
`buildView` / `scopeView` / `elementDetail` / `findElements`, `layoutModel`
and the `KINDS` vocabulary. The diagram API: `layoutProblems` /
`layoutProblemsOfXml` / `diffProblems` / `metricsDelta` (layout metrics with
ids, `METRIC_KEYS`, `METRIC_WEIGHTS`), `layoutView` (what `show --layout`
prints), `runFormatOps` (the format operations on a loaded document;
`FORMAT_OP_NAMES`, `isFormatOp`, the op types `PlaceOp`, `AlignOp`,
`ColorOp`, `LabelOp`, `RouteOp`, `SpaceOp`, `TidyOp`) and the colour palette
`SWATCHES`. The platform profile: `validateDoc(doc, { platform: 'auto' |
'c7' | 'c8' | 'none' })` (findings among the warnings, `result.platform`
with the platform, its source and the counts), `MutationOptions.platform`
(default auto; `'none'` switches it off; an explicit choice also decides the
engine rules of the ops, e.g. which event-gateway rule a bridge follows),
`runProfile`, `detectPlatform`, `PLATFORM_CHOICES` and the types
`ProfileFinding`, `PlatformSummary`, `Severity`; `listExtensions` /
`listAllExtensions` (what `ext list` prints).

Validation in the transaction (see
[design-iq](#design-iq-the-design-profile-and-validators)):
`MutationOptions.validators` / `CheckOptions.validators` (also `validators`
of `applyToXml`, `validateXml` and `checkFile`) with the types `Validator`,
`ValidatorFn`, `NamedValidator`, `ValidatorFinding`, `ValidatorContext`,
`ValidatorIssue`, `ValidatorReport`; `profile` (`'auto' | 'design' |
'none'`, `PROFILE_CHOICES`, `resolveProfile`, `ProfileInfo`) and
`contentRepo` (`ContentRepo`: the design-iq content repository the document
is a model of, with its `processIds` / `decisionIds` for the link checks; in
memory `auto` runs the design profile only when it is given; the file
helpers find it on disk: `findContentRepo`, `contentRepoOf`,
`resolveFileProfile` in `@miragon/bpmn-cli/node`), the design profile itself
as `designFindings(doc, { processIds, decisionIds })` / `designValidator(...)`
(`DESIGN_VALIDATOR` is its name), and `decisionLinkOf(element, doc)` (a
business rule task's decision link in any spelling).

Text preservation: `mutateDoc` returns the text to store as `result.xml`:
the original text of everything the ops did not change (see [What a write
changes](#what-a-write-changes)); `result.unchanged` is true when it equals
the input (the file helpers then do not write over the file: `written:
false`). `Doc.fromXml` keeps what it read as `doc.source` (`DocSource`: the
text and the incoming / outgoing lists as read); `preserveText(original,
asRead, changed)` is the text-preserving step on its own, for a host that
serialises a model itself (two serialisations by bpmn-moddle, of the model as
read and as changed).

### Browser bundles

`npm run gate` (and so CI) runs `tools/iso/check.mjs` after the build: it
bundles `dist/index.js` with esbuild for `platform=browser` and fails on an
import of a Node builtin or a reference to `process`, `Buffer`, `global`,
`require`, `__dirname`, `__filename` or `setImmediate`, naming the module; it
also checks that both entries and their types resolve for a strict
TypeScript consumer (`skipLibCheck: false`, no `@types/node`).
`test/isomorphic.test.ts` runs the browser bundle in a vm context without any
Node global and compares `applyToXml` (also with the design profile and a
host validator), `layoutXml` (both engines), `validateXml`, `showXml`,
`findXml` and `metricsXml` with Node, byte for byte.

Sizes (esbuild, minified, split like a host's bundler would):

| entry | minified | gzip | loaded on demand |
| --- | --- | --- | --- |
| everything `@miragon/bpmn-cli` exports | 922 KB | 284 KB | bpmn-auto-layout, 82 KB (only for `engine: 'auto'`) |
| `applyToXml` only (tree-shaken) | 733 KB | 227 KB | the same |

`package.json` declares only the CLI files as having side effects, so a
bundler drops what a host does not import.

### Changes from 0.2

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
  [What a write changes](#what-a-write-changes)).
- New ids follow the file's id style ([Ids](#ids)); since 0.3 they also
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

### Changes from 0.3

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
- New ids speak ([Ids](#ids)): names, a kind and a place for unnamed
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
  200 KB minified / 57 KB gzip ([Browser bundles](#browser-bundles); the
  FEEL check and the schema-text rules about 23 KB / 7 KB of it).
