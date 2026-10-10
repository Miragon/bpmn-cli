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
`space`, `tidy`, `order` of lanes) and reads the drawing back with
`show --layout` and `metrics`: formatting without XML.

```
$ bpmn new order.bpmn --name "Order handling"
$ bpmn add order.bpmn start "Order received"
$ bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived
$ bpmn add order.bpmn end "Done" --after Activity_CheckInvoice
$ bpmn show order.bpmn
process Process_OrderHandling "Order handling" executable
  startEvent Event_OrderReceived "Order received" -> Activity_CheckInvoice (Flow_1cat8ax)
  userTask Activity_CheckInvoice "Check invoice" -> Event_Done (Flow_18s39x0)
  endEvent Event_Done "Done"
problems: none
```

The result is a normal `.bpmn` file that opens in Camunda Modeler / bpmn-js
with a laid-out diagram.

## Contents

- [Install](#install)
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
bpmn guide                         # the agent cheat sheet
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
3. **Ids follow the file.** New ids take the id style the file already uses
   ([Ids](#ids)): Camunda Modeler ids (`Activity_0k3x9qa`), type-named ones
   (`serviceTask_checkStock`), `Task_check_stock`, numbered `Task_12`, flows
   like `flow_checkStockToShip` or `Flow_<from>_<to>`. A new file gets
   readable `<Prefix>_<NameSlug>` ids following the bpmn-js conventions:
   `Activity_CheckInvoice`, `Event_OrderReceived`, `Gateway_InvoiceOk`,
   `Participant_Customer`, `Lane_Sales`, `DataObjectReference_Order`; flows
   and unnamed elements get a short hash of their ends or position
   (`Flow_1cat8ax`), so independent edits on two branches of a file do not
   produce the same id.
   Name collisions get `_2`, `_3` (with a `W_ID_SUFFIXED` warning). Every
   result lists the ids it created.
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

New ids follow the conventions of the file they are written into (the
modeler, a team convention, a generator): `bpmn` reads the ids the file has
and generates new ones the same way. Explicit ids (`--id`, `"id"` in ops
JSON) are always taken as given.

| what | learned from the file | examples |
| --- | --- | --- |
| prefix | per kind (and trigger); else what its family shares (`Task_` for every task kind); else the type when prefixes name types; else the bpmn-cli prefix in the file's case. No prefix is a convention too: where a kind's or family's ids have none, or the file's flow nodes mostly have none, a named element gets a bare id (camelCase, PascalCase in a PascalCase file); an unnamed one keeps a prefix | `Activity_`, `Task_`, `serviceTask_`, `End_`, `messageBoundaryEvent_`, `event_`; bare `reviewOrder` |
| body of named elements | the case style of the named flow nodes' ids (of the other named elements when the flow nodes show none) | `CheckInvoice` (default), `checkInvoice`, `check_invoice`, `Check_Invoice`, a modeler hash `0k3x9qa`, a number `12` |
| unnamed elements | numbered when the file numbers them, else a hash | `Gateway_0k3x9qa`, `Gateway_3` |
| sequence / message flows | the form of at least half of the flows | `Flow_0k3x9qa` (default), `SequenceFlow_1abc2de`, `Flow_12`, `flow12`, `flow_checkStockToShipGoods`, `Flow_<from>_<to>`, `Flow_<from>_to_<to>`, `Flow_<scope>_<A>To<B>` (`Flow_KotO_ValidateToReserve`: the scope the flows share, the first word of each end, `Start` / `End` for start and end events) |
| diagram (DI) | the form of the file's DI ids; a full redraw keeps every existing DI, plane and diagram id | `<id>_di`, `BPMNShape_<id>`, `Shape_<id>` |

One id is not a convention: a rule needs two ids that follow it (in a file
whose ids are mostly prefixed, one id of a kind is enough for that kind). A
file without a convention gets the bpmn-cli default.

Hashed ids look like Camunda Modeler ids (`<Prefix>_` and seven base-36
characters) but are not random: they hash stable inputs (the ends of a flow,
the kind, name and placement of a node, the owner of a lane set), so the same
edit on the same file always gives the same id, and edits made independently
on two branches of a file (git, two agents) do not produce the same new id.
Earlier versions numbered flows and unnamed elements (`Flow_3`); a file
numbered like that keeps being numbered. In an `apply` batch, give an
explicit `id` to an element a later op refers to: generated ids are not
meant to be guessed. Ids of existing elements never change (a spliced or
bridged flow keeps its id even when it names its old ends).

Names become ASCII words: German umlauts are transliterated (`ä` -> `ae`,
`ö` -> `oe`, `ü` -> `ue`, `ß` -> `ss`; `Prüfung` -> `Activity_Pruefung`),
other accents dropped (`Café` -> `Cafe`). An id that is not found is
matched against the other spellings (`Activity_Prufung`, `Activity_Prüfung`
suggest `Activity_Pruefung`).

## Command reference

```
bpmn new <file> [--name <text>] [--id <processId>] [--no-executable] [--target camunda8|camunda7]
bpmn show <file> [<id>] [--json] [--scope <id>]
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
bpmn remove <file> <id...> [--no-bridge] [--if-exists]                       (alias: rm)
bpmn retype <file> <id> <kind[:trigger]> [trigger options as in add]        (alias: replace)
bpmn move <file> <id...> [--after <id>] [--before <id>] [--flow <flowId>] [--in <scopeId>] [--on <activityId>] [--lane <laneId>]
bpmn order <file> <nodeId> <flowId...>
bpmn order <file> <poolId|processId|laneId> <laneId...>
bpmn ext add <file> <id> <type|path> [attr=value ...] [--body <text>] [--xml <snippet>] [--replace]
bpmn ext remove <file> <id> <selector|index>
bpmn ext list <file> <id> [--json]
bpmn apply <file> [<ops.json> | -]                                           (- = stdin)
bpmn place <file> <id...> [--row-of <id> | --below <id> | --above <id>] [--column-of <id> | --after <id> | --before <id>]
bpmn align <file> <id...> --axis row|column [--to <id>]
bpmn color <file> <id...> --color blue|orange|green|red|purple|default   (alias: colour)
bpmn label <file> <id> --side above|below|left|right
bpmn route <file> <flowId> [--exit right|top|bottom|left] [--entry left|top|bottom|right]
bpmn space <file> (--after <id> | --below <id>) [--by column|row|<px>]
bpmn tidy <file> [<id>...]
bpmn validate <file> [--json] [--strict] [--platform auto|c7|c8|none] [--profile auto|design|none]
bpmn layout <file> [--expand <id,...>] [--collapse <id,...>]
bpmn layout <file> --tidy
bpmn metrics <file> [--json]
bpmn kinds [--json]
bpmn guide
```

Common options of every mutating command (`new`, `add`, `connect`, `set`,
`remove`, `retype`, `move`, `order`, `ext add/remove`, `apply`, `place`,
`align`, `color`, `label`, `route`, `space`, `tidy`, `layout`; `layout`
always redraws, so it has no layout mode options):

| option | effect |
| --- | --- |
| `--json` | machine-readable result on stdout, errors as JSON on stderr |
| `-o, --out <file>` | write to another file instead of in place |
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
drives its id (`Process_OrderHandling`); `--id` sets it explicitly; the process
is executable unless `--no-executable`. `--target camunda8` declares the
`zeebe:` and `modeler:` namespaces with `modeler:executionPlatform="Camunda
Cloud"` and `modeler:executionPlatformVersion="8.9.0"` (in such a file new
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
if any) and the collaboration (pools, message flows) when there is one, then
prints every process in flow order: depth-first from the start events,
following the outgoing flows in declaration order (so a join and what follows
it appear under the first branch that reaches it); unreachable nodes follow,
flagged. Every flow is written as `-> Target (Flow_n "label" if condition)`.
Boundary events are indented under their host, sub-process children under the
sub-process. Then lanes, data, annotations, root messages/errors/signals and
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
sub-processes) and in each frame the flow nodes as rows, `row 1: id, id, ...`
top to bottom and left to right (centres within a quarter row spacing share a
row; boundary events follow their host and are not listed), then the
coloured elements, the labels that are not on their default side, and the
layout problems with ids (the same list as `bpmn metrics`). `--json` gives the
same data (`diagrams[].groups[] {id, kind, name, parent, rows}`, `colors`,
`labels`, `metrics`).

```
$ bpmn show order.bpmn --layout
diagram BPMNPlane_Collaboration_17c2kqg (Collaboration_17c2kqg)
  participant Participant_OrderHandling "Order handling"
    lane Lane_Sales "Sales"
      row 1: Event_OrderReceived, Activity_CheckInvoice, Gateway_InvoiceOk, Activity_BookInvoice, Event_Done
      row 2: Activity_ClarifyInvoice, Event_Clarified
    lane Lane_Backoffice "Backoffice"
colors: Activity_CheckInvoice red, Flow_024yl5b red
labels off their default side: Gateway_InvoiceOk below (default above)
layout quality: score 0: no layout problems
```

### `add`

`add <file> <kind[:trigger]> [name]` creates one element and wires it in
(see [Kinds](#kinds), [Triggers](#triggers) and the
[placement grammar](#placement-grammar)). Trailing `key=value` pairs are
applied like `set` (`camunda:assignee=kermit`). `--doc` sets the
documentation, `--lane` the lane (default: the lane of the anchor or host),
`--collapsed` draws a sub-process collapsed, `--if-absent` together with
`--id` makes the command idempotent. `--message <name>` also works for
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
zeebe extension element (`zeebe:assignee`, `zeebe:correlationKey`,
`loop.zeebe:inputCollection`) is refused with `E_WRONG_HOST`; the hint is
the `ext add` that writes it (see [Camunda 8](#camunda-8)).

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
label/condition over) unless `--no-bridge`. A lane un-assigns its members; a
participant takes its process and message flows along (the collaboration is
dropped when no pool remains); a data object reference also removes its
`bpmn:DataObject` when unused. Associations on a flow that bridging replaces
(a note on the removed node's outgoing flow) move to the bridging flow; a
flow removed without a bridge takes its associations along. A removed flow is
also dropped from stale `incoming` / `outgoing` entries of other nodes (files
from other tools sometimes carry them). `--if-exists` skips unknown ids with
a note.

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
`--lane` assigns a lane and may be combined with a placement. Boundary events
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
and a kept drawing gets its bands reordered with their content.

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
beside a shape does not count). `--json` gives `{file, score, counts,
problems: [{kind, ids, detail?}]}`. Every mutation reports the same
measurement before and after in its `layout.metrics` block, with the
problems it added and resolved.

### `kinds` and `guide`

`kinds` prints the kind table, trigger options, set keys, placement grammar
and the error catalogue; `kinds --json` adds the JSON Schema of the ops
format (`ops`), the example (`opsExample`), the validation profiles
(`profiles`) and the exit codes. `guide` is the
cheat sheet for agents.

## Layout modes

Every mutating command updates the diagram in one of three modes
(`--layout <mode>`; `--relayout` is `--layout full`, `--no-layout` skips it):

| mode | what happens |
| --- | --- |
| `auto` (default) | A file without diagram is drawn from scratch. A drawing that the engine made and nobody changed since (re-running the engine on the model as it was before the command reproduces every shape, label and connection within 2 px; flow nodes added with `--no-layout` are left out of that check) is redrawn in full, so it keeps the best global layout while the CLI owns it. Any other drawing, hand-made in a modeler or changed by a format command (also one that only reroutes a flow or moves a label), is kept: `incremental`. |
| `incremental` | Keep every existing shape and connection. New elements are placed next to their neighbours (splice: between predecessor and successor; a new branch: one row below the existing branches; a boundary event: on the host's bottom border; ...), room is made like the modeler's space tool (everything right of / below the spot moves, pools, lanes and the sub-processes holding the spot grow; another expanded sub-process the line crosses moves as a whole or stays, it is never stretched; connection labels move with their connection), removed elements' DI is pruned (and an empty column closed; when shapes in other rows reach into it, only the removed node's own row closes, if that tears nothing apart), lane changes move a node into its new lane, an activity whose new name does not fit grows (wider in steps of 20 px up to 200, then higher; never smaller), and only the connections that need it are rerouted (a gateway docks on its vertices, one connection per vertex while one is free). Untouched shapes keep their exact bounds, untouched connections their waypoints. If it fails, `auto` falls back to a full redraw (`W_LAYOUT_INCREMENTAL_FAILED`), an explicit `--layout incremental` fails with `E_LAYOUT_INCREMENTAL` instead. |
| `full` | Redraw everything with the engine (`--engine clean`, default, or `auto`). Colours (`bioc:` / `color:` attributes) and the DI ids are carried over by element id (new DI gets the file's id style); positions are not. `bpmn layout <file>` always does this. |

The result says which mode ran and why (`layout: ok - incremental (hand-made
diagram: kept, changes placed locally)`), lists what was placed / moved /
rerouted / pruned, and compares the layout quality before and after with the
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
| `place <id...>` with `--row-of` / `--below` / `--above <id>` and/or `--column-of` / `--after` / `--before <id>` | Move the shapes as one rigid group so the first lands on the row (vertical centre) and/or column (horizontal centre) of another element; `below` / `above` keep one row of the drawing and clear the element, `after` / `before` one gap. Boundary events, labels and the content of an expanded sub-process follow; shapes in the way give way, frames grow, flows are rerouted. |
| `align <id...> --axis row\|column [--to <id>]` | Put the shapes on one horizontal / vertical centre line, the one of `--to` (default: the first id). Shapes that would land on each other give way along the free axis. |
| `color <id...> --color blue\|orange\|green\|red\|purple\|default` | The bpmn-js colour picker colours on shapes and connections (`bioc:fill` / `bioc:stroke` / `color:background-color` / `color:border-color`, labels `color:color`); `default` removes them. |
| `label <id> --side above\|below\|left\|right` | The external label of an event, gateway, data object / store or flow on that side (flows: of their longest horizontal / vertical segment), off lines and other labels where possible. |
| `route <flowId> [--exit <side>] [--entry <side>]` | Route one sequence / message flow again, optionally forcing the side it leaves its source and enters its target by (`--exit bottom --entry bottom` draws a loop below). |
| `space --after <id> \| --below <id> [--by column\|row\|<px>]` | The space tool: everything starting right of (within the element's pool) / below the element moves by one column / row of the drawing or `<px>`; pools, lanes and the sub-processes holding the element grow, any other expanded sub-process crossing the line moves as a whole (mostly beyond it) or stays. On a lane or pool it makes that frame wider / taller. |
| `tidy [<id>...]` (also `bpmn layout --tidy`) | Remove overlaps and gaps < 20 px with minimal moves, keeping the reading order (nothing moves left), default every shape. |
| `order <poolId\|processId\|laneId> <laneId...>` | Lanes top to bottom; the bands move with their content. |

Refusals: a node never leaves its lane, pool or expanded sub-process
(`E_LEAVES_CONTAINER`; its hint names the lane at the target position:
`move <id> --lane <laneId>` first, or `space --below <laneId>` to make room).
When the shapes in the way cannot give way without moving the reference off
the requested row / column, a sub-process would have to grow over a
reference outside it, or the reference's own pool, lane or sub-process would
be pushed away (a reference in another pool), the command fails with
`E_NO_ROOM` and writes nothing. Making room never leaves two shapes on each
other: a reference the neighbours would be pushed onto moves along with them
when its row / column still holds, otherwise the command fails with
`E_NO_ROOM`. Elements without a
shape fail with `E_NO_SHAPE` (for a pool use the participant id, not the
process id), a reference on another diagram (inside a collapsed sub-process)
with `E_DIFFERENT_DIAGRAM`, a task given to `label` with `E_WRONG_KIND`, an
unnamed element with `E_NO_LABEL`.

Each format op reports `{op, index, moved, rerouted, colored?, labels?,
notes?}` in `layout.format`, and `layout.metrics` measures the drawing after
the last of them. A typical agent loop:

```
$ bpmn show order.bpmn --layout                          # rows per lane, colours, problems
$ bpmn color order.bpmn Activity_CheckInvoice Flow_024yl5b Gateway_InvoiceOk --color red
$ bpmn align order.bpmn Event_InvoiceHandled Event_ReminderSent --axis column
$ bpmn place order.bpmn Activity_ClarifyInvoice --below Activity_BookInvoice
$ bpmn order order.bpmn Participant_OrderHandling Lane_Backoffice Lane_Sales
$ bpmn route order.bpmn Flow_02tom5g --exit bottom --entry bottom
$ bpmn metrics order.bpmn                                # no overlaps / through / outsideLane added?
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
| `--flow <F>` | `flow` | Splice into sequence flow F: `A -> B` becomes `A -> node -> B`. F keeps its id, name and condition and now ends at the node. |
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
| activities | `loop` (`none`/`standard`/`parallel`/`sequential`), `cardinality`, `completion` (completion condition) |
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
  startEvent Event_ClaimReceived "Claim received" -> Activity_CheckCoverage (Flow_078nmus)
  serviceTask Activity_CheckCoverage "Check coverage" [camunda:type=external, camunda:topic=check-coverage, ext: camunda:inputOutput, camunda:errorEventDefinition] -> Activity_ApproveClaim (Flow_01d397f)
    boundaryEvent:error Event_NotCovered "Not covered" [error Not covered (NOT_COVERED), definition.camunda:errorCodeVariable=rejectCode] -> Event_ClaimRejected (Flow_1vl2v2v)
  userTask Activity_ApproveClaim "Approve claim" [camunda:candidateGroups=claims, ext: camunda:formData] -> Activity_PayOut (Flow_0y359yr)
  callActivity Activity_PayOut "Pay out" [calledElement=Process_PayOut, camunda:calledElementBinding=latest, ext: camunda:in, camunda:out] -> Activity_InformParty (Flow_1fzbwrx)
  userTask Activity_InformParty "Inform party" [loop=parallel, camunda:assignee=${party}, loop.camunda:collection=${parties}, loop.camunda:elementVariable=party] -> Event_ClaimSettled (Flow_0adcvrj)
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
an id derived from its event (`ConditionalEventDefinition_StockReady`):
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
| message correlation | `bpmn set <file> <id> message=<Name>` (or `add ... --message <Name>`), then `bpmn ext add <file> <messageId> zeebe:subscription correlationKey==<FEEL>` |
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
its correlation key; `show <id>` and `ext list` print the whole tree.

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
static value where Camunda 8 wants FEEL, a FEEL slip it refuses (`&&`, `||`,
`==`, `!`, single quotes, unbalanced brackets, a dangling operator), a
timer value it cannot parse (`PT2D` instead of `P2D`, a date without
offset, a 5-field cron), a cycle on an intermediate or interrupting timer,
a multi-instance loop without `zeebe:loopCharacteristics` or
`inputCollection`, two of a zeebe element it reads once, form, priority,
date, listener and mapping content it refuses, event and start-event
combinations it does not support (several definitions, a triggered start
in an embedded sub-process, two none starts, error codes or message names
twice in a scope, an escalation boundary event on a task, a link without
catch), unsupported elements (transaction, cancel events), an unprefixed
attribute BPMN does not define, and a file without an executable process.
The runtime rules: a flow without condition out of an exclusive or
inclusive gateway with other outgoing flows is never taken, a condition on
a flow out of a task or parallel gateway is ignored, a standard loop runs
once, a JUEL completion condition and non-numeric job retries end in an
incident, Camunda 7 content (`camunda:*`) is ignored, unknown and misplaced
zeebe content (input mappings on start, boundary, none throw and none end
events included) has no effect, `zeebe:publishMessage` is accepted but not
run. Every finding names the command that fixes it (the worked example
below after `set Flow_1p3kapg 'condition=${invoice.amount > 1000}'` and
`ext remove Message_PaymentReceived zeebe:subscription`):

```
$ bpmn validate invoice.bpmn
W_C8_DEPLOY_MESSAGE Activity_WaitForPayment [Message_PaymentReceived]: Message Message_PaymentReceived ("Payment received") of receiveTask Activity_WaitForPayment has no zeebe:subscription: Camunda 8 needs one with the correlation key that matches a message to an instance and refuses the file  (`bpmn ext add <file> Message_PaymentReceived zeebe:subscription correlationKey==<expression>` (e.g. correlationKey==orderId).)
W_C8_DEPLOY_EXPRESSION Flow_1p3kapg: The condition "${invoice.amount > 1000}" of sequence flow Flow_1p3kapg is no FEEL expression; Camunda 8 needs one starting with = and refuses the file  (`bpmn set <file> Flow_1p3kapg 'condition== invoice.amount > 1000'` (check the FEEL syntax: and / or, = for equality).)
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
refused) and the content of ad-hoc sub-processes too. It does not parse
FEEL: other syntax errors are found by the engine only.

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
  startEvent Event_InvoiceReceived "Invoice received" -> Activity_CheckInvoice (Flow_1d9iq3c)
  serviceTask Activity_CheckInvoice "Check invoice" [job=check-invoice, ext: zeebe:taskDefinition, zeebe:ioMapping, zeebe:taskHeaders] -> Gateway_AmountOver1000 (Flow_1j5bfq9)
  exclusiveGateway Gateway_AmountOver1000 "Amount over 1000?" -> Activity_ApproveInvoice (Flow_1p3kapg "yes" if = invoice.amount > 1000), Gateway_Approved (Flow_0rx34hq "no" default)
  userTask Activity_ApproveInvoice "Approve invoice" [form=https://forms.example.com/approve-invoice, candidateGroups=finance, ext: zeebe:userTask, zeebe:assignmentDefinition, zeebe:formDefinition] -> Gateway_Approved (Flow_02hoari)
  exclusiveGateway Gateway_Approved -> Activity_WaitForPayment (Flow_040g1ya)
  receiveTask Activity_WaitForPayment "Wait for payment" [message=Payment received] -> Activity_BookPayment (Flow_1ju8oiv)
  callActivity Activity_BookPayment "Book payment" [calledElement=Process_BookPayment, ext: zeebe:calledElement, zeebe:ioMapping] -> Activity_NotifyParty (Flow_06d0vcw)
  serviceTask Activity_NotifyParty "Notify party" [loop=parallel, job=notify-party, inputCollection==parties, inputElement=party, ext: zeebe:taskDefinition] -> Event_InvoiceSettled (Flow_0ys0mpu)
  endEvent Event_InvoiceSettled "Invoice settled"
root: message Message_PaymentReceived "Payment received" [correlationKey==invoiceId]
problems: none

$ bpmn show invoice.bpmn Activity_CheckInvoice
...
job: check-invoice
extensions:
  zeebe:taskDefinition type="check-invoice" retries="3"
  zeebe:ioMapping
    zeebe:input source="=invoice.amount" target="amount"
  zeebe:taskHeaders
    zeebe:header key="channel" value="mail"

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
warning (it follows its element through a rename), a warning the change
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
`validation.errors` / `validation.warnings` with `validator` and `severity`:

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
format ops (`place`, `align`, `color`, `label`, `route`, `space`, `tidy`, the
band part of a lane `order`) run on the drawing in batch order, and the file
is written once. If any op fails nothing is written and the error names the
op index (`ops[3] (add): ...`, `"op": 3` in `--json`).

The format is "CLI flags spelled as JSON": every op is an object with `"op"`
and the flags of the matching command in lowerCamelCase (`--flow-name` ->
`flowName`, `--if-absent` -> `ifAbsent`, `--non-interrupting` ->
`nonInterrupting`). The input is either an array of ops or `{"ops": [...]}`.

| op | keys |
| --- | --- |
| `add` | `kind` (required), `name`, `id`, `after`, `before`, `flow`, `in`, `on`, `to`, `lane`, `flowName`, `flowId`, `condition`, `language`, `default`, trigger keys (`timer`, `timerKind`, `message`, `error`, `errorCode`, `signal`, `escalation`, `escalationCode`, `when`, `link`, `nonInterrupting`; `message` also for `sendTask` / `receiveTask`), `collapsed`, `ifAbsent`, `doc`, `set` (map, nested keys included: `"loop.camunda:collection": "${items}"`), `process`, `blackBox`, `text`, `members` (list) |
| `connect` | `source`, `target` (required), `name`, `id`, `condition`, `language`, `default`, `message`, `ifAbsent` |
| `set` | `id` (required), `values` (map), `unset` (list); at least one of the two |
| `remove` | `ids` (required list), `bridge` (default true), `ifExists` |
| `retype` | `id`, `kind` (required), trigger keys |
| `move` | `ids` (required list), `after`, `before`, `flow`, `in`, `lane`, flow keys |
| `order` | `id` (required), exactly one of `flows` (outgoing flows of a node) or `lanes` (lanes of a pool / process / parent lane) |
| `ext` | `id`, `action` (`add` / `remove`, required), `type` (add: type or path; remove: selector such as `camunda:inputParameter[name=x]`, or an index from `ext list` such as `"2"`, `"loop.0"`, `"definition[1].0"`; a `definition.` / `loop.` / `condition.` prefix addresses the nested element, `definition[<n>].` / `definition[<trigger>].` one of several event definitions), `attrs` (map), `body`, `xml`, `replace`, `index`, `slot` (`definition` / `loop` / `condition` / `definition[<n>]`, the same as the type prefix) |
| `place` | `ids` (required list; moved as one group, the first is the reference), at most one of `rowOf` / `below` / `above` and at most one of `columnOf` / `after` / `before` (at least one key) |
| `align` | `ids` (required list), `axis` (`row` / `column`, required), `to` (reference; default the first id; without it two ids are needed) |
| `color` | `ids` (required list), `color` (`blue` / `orange` / `green` / `red` / `purple` / `default`, required) |
| `label` | `id`, `side` (`above` / `below` / `left` / `right`) (required) |
| `route` | `id` (required), `exit`, `entry` (`right` / `top` / `bottom` / `left`) |
| `space` | exactly one of `after` / `below`, `by` (`"column"`, `"row"` or pixels) |
| `tidy` | `ids` (list; default every shape) |
| `split` | `after` (required), `kind` (gateway, default `exclusiveGateway`), `name`, `id`, `join` (default true), `joinId`, `joinName`, `branches` (required): `[{ flowName?, flowId?, condition?, language?, default?, nodes: [ add-like objects without placement ] }]` |

`split` is a macro without CLI counterpart: it places a gateway after the
anchor (splicing into its single outgoing flow if it has one), creates every
branch (the first node gets the branch's flow options, following nodes are
chained), and a join gateway of the same kind (`<gatewayId>_join`) that every
branch end connects to; when the anchor was spliced, the join continues to the
old successor. An empty `nodes` list is a direct gateway -> join flow.

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
      "id": "Gateway_InvoiceOk",
      "branches": [
        { "flowName": "yes", "condition": "= ok", "nodes": [{ "kind": "serviceTask", "name": "Book invoice" }] },
        {
          "flowName": "no",
          "default": true,
          "nodes": [{ "kind": "userTask", "name": "Clarify invoice", "set": { "doc": "Call the customer and clarify the open positions." } }]
        }
      ]
    },
    { "op": "add", "kind": "boundaryEvent:timer", "name": "Reminder", "on": "Activity_ClarifyInvoice", "timer": "P2D", "nonInterrupting": true },
    { "op": "add", "kind": "sendTask", "name": "Remind customer", "after": "Event_Reminder" },
    { "op": "add", "kind": "endEvent", "name": "Reminder sent", "in": "Process_OrderHandling" },
    { "op": "connect", "source": "Activity_RemindCustomer", "target": "Event_ReminderSent" },
    { "op": "set", "id": "Activity_BookInvoice", "values": { "name": "Book invoice in ERP", "doc": "Posts the invoice to the ledger." } },
    { "op": "ext", "id": "Activity_BookInvoice", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "book-invoice", "retries": "3" } },
    { "op": "ext", "id": "Activity_RemindCustomer", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "remind-customer" } }
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
errors a `--force` write let through (`forced E_CODE element: message`),
warnings (`warning W_CODE element: message  (hint)`; a validator's finding
names it: `warning [design] W_DESIGN_COMPLEXITY ...`), one `validator <name>
(<why it ran>): n error(s), m warning(s) in the result` line per validator
that ran (the design profile), then the layout block, then `written: <file>`
(`dry run: <file> not written` with `--dry-run`; `unchanged: <file> (the
result equals the file; nothing written)` when the change left the file as
it was). With `--show` the model view follows. The layout block:

```
layout: ok - incremental (hand-made diagram: kept, changes placed locally)
  placed: Activity_Review, Flow_9
  moved: Event_Done
  rerouted: Flow_4
  format place #1: moved Activity_Review; rerouted Flow_9
layout quality: score 12 -> 10; resolved: crossings [Flow_3, Flow_7]
```

`layout: ok - full (<reason>)` after a redraw, `layout: skipped` with
`--no-layout`; `placed` / `moved` / `rerouted` / `pruned` / `note` lines come
from the incremental layout, one `format <op> #<index>` line per format op
(what it colored, placed a label for, moved and rerouted, or `no change`),
and `layout quality` compares the layout problems before and after (`added:`
and `resolved:` name them with ids).

`--json` on stdout:

```json
{
  "ok": true, "file": "order.bpmn", "written": true, "unchanged": false,
  "created": [{ "id": "Activity_X", "kind": "userTask", "name": "...", "detail": "after Event_Y" }],
  "changed": [], "removed": [],
  "warnings": [{ "code": "W_...", "message": "...", "element": "...", "hint": "..." }],
  "notes": ["..."],
  "layout": {
    "status": "ok", "mode": "incremental", "reason": "hand-made diagram: kept, changes placed locally",
    "warnings": [], "expanded": [],
    "placed": ["Activity_X", "Flow_9"], "moved": [], "rerouted": ["Flow_4"], "pruned": [], "notes": [],
    "format": [{ "op": "color", "index": 1, "moved": [], "rerouted": [], "colored": ["Activity_X"] }],
    "metrics": {
      "before": { "counts": { "crossings": 1, "...": 0 }, "score": 5 },
      "after": { "counts": { "crossings": 0, "...": 0 }, "score": 0 },
      "added": [], "resolved": [{ "kind": "crossings", "ids": ["Flow_3", "Flow_7"] }]
    }
  },
  "validation": { "errors": [], "warnings": [], "platform": { "...": "the engine profile" }, "validators": [{ "name": "design", "detail": "...", "errors": [], "warnings": [], "preexisting": [], "resolved": [], "counts": { "errors": 0, "warnings": 0 } }] },
  "importWarnings": [],
  "view": { "...": "only with --show" }
}
```

`written` is `false` with `--dry-run`, and when `unchanged` is `true`: the
result equals the input file byte for byte, so nothing is written over it
(`--out <other file>` still writes the copy). `importWarnings` lists what
bpmn-moddle reported while reading the input file (informational, first line
of each warning; a design model's `calledDecision` is not one).
`validation.validators` is there when a validator ran (the design profile,
library validators); their findings in `validation.errors` /
`validation.warnings` carry `"validator"` and `"severity"`.

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
  `--condition '${amount > 100}'`, `set Flow_1qqra0u condition='${ok}'`. In double
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
- The format commands move and grow, they never shrink: frames that became
  too big after `place` or `space` stay big (`bpmn layout` redraws
  everything). Groups (`bpmn:Group` boxes) are not frames: shapes may be
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
- The Camunda 8 profile does not parse FEEL: it reports a static value
  where FEEL is required and the common slips (`&&`, `||`, `==`, `!`,
  `${...}`, single quotes, unbalanced brackets, a dangling operator); other
  FEEL syntax errors are found by the engine only. An event-based gateway of
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
warning W_NO_END Process_OrderHandling: Process Process_OrderHandling has no end event  (Add one after the last node: `bpmn add <file> endEvent "<Name>" --after <nodeId>`.)
warning W_DEAD_END Event_OrderReceived: startEvent:message Event_OrderReceived "Order received" has no outgoing flow  (Continue the flow (`bpmn add <file> <kind> "<Name>" --after Event_OrderReceived`) or end it (`bpmn add <file> endEvent "<Name>" --after Event_OrderReceived`).)
layout: ok - full (no diagram before: drawn from scratch)
layout quality: score 0
written: order.bpmn

$ bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived
created userTask Activity_CheckInvoice "Check invoice" - after Event_OrderReceived
created sequenceFlow Flow_1cat8ax - Event_OrderReceived -> Activity_CheckInvoice
note: appended after Event_OrderReceived
note: Activity_CheckInvoice is a Camunda user task (zeebe:userTask), like Camunda Modeler creates them
warning W_NO_END Process_OrderHandling: Process Process_OrderHandling has no end event  (Add one after the last node: `bpmn add <file> endEvent "<Name>" --after <nodeId>`.)
warning W_DEAD_END Activity_CheckInvoice: userTask Activity_CheckInvoice "Check invoice" has no outgoing flow  (Continue the flow (`bpmn add <file> <kind> "<Name>" --after Activity_CheckInvoice`) or end it (`bpmn add <file> endEvent "<Name>" --after Activity_CheckInvoice`).)
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn add order.bpmn end "Invoice handled" --after Activity_CheckInvoice
created endEvent Event_InvoiceHandled "Invoice handled" - after Activity_CheckInvoice
created sequenceFlow Flow_024yl5b - Activity_CheckInvoice -> Event_InvoiceHandled
note: appended after Activity_CheckInvoice
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ cat > ops.json <<'EOF'
{ "ops": [
  { "op": "split", "after": "Activity_CheckInvoice", "name": "Invoice ok?", "id": "Gateway_InvoiceOk",
    "branches": [
      { "flowName": "yes", "condition": "= ok", "nodes": [{ "kind": "serviceTask", "name": "Book invoice" }] },
      { "flowName": "no", "default": true, "nodes": [{ "kind": "userTask", "name": "Clarify invoice" }] } ] },
  { "op": "add", "kind": "boundary:timer", "name": "Reminder", "on": "Activity_ClarifyInvoice", "timer": "P2D", "nonInterrupting": true },
  { "op": "add", "kind": "sendTask", "name": "Remind customer", "after": "Event_Reminder" },
  { "op": "add", "kind": "end", "name": "Reminder sent", "after": "Activity_RemindCustomer" },
  { "op": "ext", "id": "Activity_BookInvoice", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "book-invoice" } },
  { "op": "ext", "id": "Activity_RemindCustomer", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "remind-customer" } }
] }
EOF
$ bpmn apply order.bpmn ops.json
created exclusiveGateway Gateway_InvoiceOk "Invoice ok?" - between Activity_CheckInvoice and Event_InvoiceHandled
created serviceTask Activity_BookInvoice "Book invoice" - after Gateway_InvoiceOk
created sequenceFlow Flow_1qqra0u "yes" - Gateway_InvoiceOk -> Activity_BookInvoice
created userTask Activity_ClarifyInvoice "Clarify invoice" - after Gateway_InvoiceOk
created sequenceFlow Flow_0d0nlaf "no" - Gateway_InvoiceOk -> Activity_ClarifyInvoice
created exclusiveGateway Gateway_InvoiceOk_join - join of Gateway_InvoiceOk
created sequenceFlow Flow_08vgc8d - Activity_BookInvoice -> Gateway_InvoiceOk_join
created sequenceFlow Flow_0jz1192 - Activity_ClarifyInvoice -> Gateway_InvoiceOk_join
created sequenceFlow Flow_1y8i3yl - Gateway_InvoiceOk_join -> Event_InvoiceHandled
created boundaryEvent:timer Event_Reminder "Reminder" - on Activity_ClarifyInvoice
created sendTask Activity_RemindCustomer "Remind customer" - after Event_Reminder
created sequenceFlow Flow_02tom5g - Event_Reminder -> Activity_RemindCustomer
created endEvent Event_ReminderSent "Reminder sent" - after Activity_RemindCustomer
created sequenceFlow Flow_1brj5dq - Activity_RemindCustomer -> Event_ReminderSent
changed sequenceFlow Flow_024yl5b - Activity_CheckInvoice -> Gateway_InvoiceOk (was -> Event_InvoiceHandled)
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
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn show order.bpmn
namespaces: zeebe, modeler
process Process_OrderHandling "Order handling" executable
  startEvent:message Event_OrderReceived "Order received" [message OrderReceived] -> Activity_CheckInvoice (Flow_1cat8ax)
  userTask Activity_CheckInvoice "Check invoice" [ext: zeebe:userTask] -> Gateway_InvoiceOk (Flow_024yl5b)
  exclusiveGateway Gateway_InvoiceOk "Invoice ok?" -> Activity_BookInvoice (Flow_1qqra0u "yes" if = ok), Activity_ClarifyInvoice (Flow_0d0nlaf "no" default)
  serviceTask Activity_BookInvoice "Book invoice" [job=book-invoice, ext: zeebe:taskDefinition] -> Gateway_InvoiceOk_join (Flow_08vgc8d)
  exclusiveGateway Gateway_InvoiceOk_join -> Event_InvoiceHandled (Flow_1y8i3yl)
  endEvent Event_InvoiceHandled "Invoice handled"
  userTask Activity_ClarifyInvoice "Clarify invoice" [ext: zeebe:userTask] -> Gateway_InvoiceOk_join (Flow_0jz1192)
    boundaryEvent:timer Event_Reminder "Reminder" [P2D, non-interrupting] -> Activity_RemindCustomer (Flow_02tom5g)
  sendTask Activity_RemindCustomer "Remind customer" [job=remind-customer, ext: zeebe:taskDefinition] -> Event_ReminderSent (Flow_1brj5dq)
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
created collaboration Collaboration_17c2kqg
created participant Participant_OrderHandling "Order handling" - wraps process Process_OrderHandling
note: collaboration Collaboration_17c2kqg created; Participant_OrderHandling wraps the existing process Process_OrderHandling
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
created messageFlow Flow_1r0se6x - Activity_RemindCustomer -> Participant_Customer
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn show order.bpmn --layout
diagram BPMNPlane_Collaboration_17c2kqg (Collaboration_17c2kqg)
  participant Participant_OrderHandling "Order handling"
    row 1: Event_OrderReceived, Activity_CheckInvoice, Gateway_InvoiceOk, Activity_BookInvoice, Gateway_InvoiceOk_join, Event_InvoiceHandled
    row 2: Activity_ClarifyInvoice
    row 3: Activity_RemindCustomer, Event_ReminderSent
  participant Participant_Customer "Customer"
layout quality: score 0: no layout problems

$ bpmn color order.bpmn Activity_CheckInvoice Flow_024yl5b Gateway_InvoiceOk --color red
layout: ok - incremental (format operations only: drawing kept)
  format color #0: colored Activity_CheckInvoice, Flow_024yl5b, Gateway_InvoiceOk
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn label order.bpmn Gateway_InvoiceOk --side below
layout: ok - incremental (format operations only: drawing kept)
  format label #0: label placed Gateway_InvoiceOk
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn place order.bpmn Activity_RemindCustomer Event_ReminderSent --row-of Activity_ClarifyInvoice --after Activity_ClarifyInvoice
layout: ok - incremental (format operations only: drawing kept)
  format place #0: moved Activity_RemindCustomer, Event_ReminderSent; rerouted Flow_02tom5g, Flow_0jz1192, Flow_1r0se6x
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn add order.bpmn serviceTask "Archive invoice" --after Activity_BookInvoice
created serviceTask Activity_ArchiveInvoice "Archive invoice" - after Activity_BookInvoice
created sequenceFlow Flow_1l931fe - Activity_ArchiveInvoice -> Gateway_InvoiceOk_join
changed sequenceFlow Flow_08vgc8d - Activity_BookInvoice -> Activity_ArchiveInvoice (was -> Gateway_InvoiceOk_join)
note: inserted between Activity_BookInvoice and Gateway_InvoiceOk_join
warning W_C8_DEPLOY_IMPLEMENTATION Activity_ArchiveInvoice: serviceTask Activity_ArchiveInvoice has no zeebe:taskDefinition: Camunda 8 needs the job type a worker subscribes to and refuses the file  (Give it a job type: `bpmn ext add <file> Activity_ArchiveInvoice zeebe:taskDefinition type=<jobType>`.)
layout: ok - incremental (hand-made diagram: kept, changes placed locally)
  placed: Activity_ArchiveInvoice, Flow_1l931fe
  moved: Participant_OrderHandling, Event_InvoiceHandled, Activity_RemindCustomer, Event_ReminderSent, Gateway_InvoiceOk_join, Participant_Customer
  rerouted: Flow_08vgc8d
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn metrics order.bpmn
score 0: no layout problems

$ bpmn validate order.bpmn
W_C8_DEPLOY_IMPLEMENTATION Activity_ArchiveInvoice: serviceTask Activity_ArchiveInvoice has no zeebe:taskDefinition: Camunda 8 needs the job type a worker subscribes to and refuses the file  (Give it a job type: `bpmn ext add <file> Activity_ArchiveInvoice zeebe:taskDefinition type=<jobType>`.)
platform: c8 (modeler:executionPlatform "Camunda Cloud") - 1 refused at deploy, 0 runtime, 0 practice finding(s)
layout: ok
valid, 1 warning(s)

$ bpmn ext add order.bpmn Activity_ArchiveInvoice zeebe:taskDefinition type=archive-invoice
changed serviceTask Activity_ArchiveInvoice "Archive invoice" - ext added zeebe:taskDefinition
layout: ok - incremental (hand-made diagram: kept, changes placed locally)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn validate order.bpmn
platform: c8 (modeler:executionPlatform "Camunda Cloud") - 0 refused at deploy, 0 runtime, 0 practice finding(s)
layout: ok
valid, 0 warning(s)
```

The first participant must be a normal pool: it wraps the existing process
(`Participant_OrderHandling = Process_OrderHandling`). A `--black-box` pool
never wraps, so adding it first on a pool-less file fails with
`E_EMPTY_COLLABORATION` / `E_ORPHAN_PROCESS` and nothing is written.

The last steps format the drawing without XML: `show --layout` reads it,
`color` / `label` / `place` change it (the drawing is now hand-made), and the
following `add` therefore keeps it and places "Archive invoice" locally
between "Book invoice" and the join (`layout: ok - incremental`) instead of
redrawing; `metrics` confirms that no layout problem was introduced. The
file targets Camunda 8, so `validate` (and already the `add`) reports that
the new service task has no job type; the `ext add` from the hint fixes it,
and the result deploys to Camunda 8.9.

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
| `viewXml(xml, opts?)` | `bpmn show --json` | `ModelView`, `ElementDetail` (with `id`), `LayoutView` (with `layout: true`) |
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
  `target`; `viewXml` and `showXml` take `id`, `scope` and `layout` like
  `show`; `validateXml` takes `platform`, `profile`, `contentRepo`,
  `validators` and `file`.
- `EditResult` is `{ xml, unchanged, result }`: the new document, which
  keeps the input's text wherever the ops changed nothing ([What a write
  changes](#what-a-write-changes)); `unchanged` is `true` when it is
  byte-identical to the input (then `xml` is the input string itself and
  there is nothing to save; a rename to the current name, `tidy` on a tidy
  drawing); `result` is what the CLI prints with `--json`
  ([Output](#output-errors-and-exit-codes)) without `file`, `written` and the
  XML. `renderMutation(result)` gives the CLI's text for it,
  `renderValidation(report)` the text of `validate`.
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
edit.result.created.map((c) => c.id); // ['Event_OrderReceived', 'Activity_CheckInvoice', 'Flow_1cat8ax', 'Event_Done', 'Flow_18s39x0']
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
ops, opts)` (`new`), `layoutFile(file, opts)` (`layout`) and
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
| everything `@miragon/bpmn-cli` exports | 716 KB | 224 KB | bpmn-auto-layout, 82 KB (only for `engine: 'auto'`) |
| `applyToXml` only (tree-shaken) | 594 KB | 186 KB | the same |

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
- New ids follow the file's id style; flows and unnamed elements get a short
  hash instead of `<Prefix>_<n>` ([Ids](#ids)): a batch that refers to an
  element it creates gives it an explicit `id`.
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
