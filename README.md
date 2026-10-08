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
  startEvent Event_OrderReceived "Order received" -> Activity_CheckInvoice (Flow_1)
  userTask Activity_CheckInvoice "Check invoice" -> Event_Done (Flow_2)
  endEvent Event_Done "Done"
problems: none
```

The result is a normal `.bpmn` file that opens in Camunda Modeler / bpmn-js
with a laid-out diagram.

## Contents

- [Install](#install)
- [The contract](#the-contract)
- [Command reference](#command-reference)
- [Layout modes](#layout-modes)
- [Formatting without XML](#formatting-without-xml)
- [Kinds](#kinds)
- [Triggers](#triggers)
- [Placement grammar](#placement-grammar)
- [Set keys](#set-keys)
- [Ops JSON (`bpmn apply`)](#ops-json-bpmn-apply)
- [Output, errors and exit codes](#output-errors-and-exit-codes)
- [Quoting](#quoting)
- [The DI contract](#the-di-contract)
- [Limitations](#limitations)
- [A worked session](#a-worked-session)
- [Library use](#library-use)

## Install

Requires Node 20+ (developed on Node 24).

```
npm install
npm run build          # tsc -> dist/
npm link               # optional: puts `bpmn` on your PATH (bin/bpmn.js)
bpmn guide             # the agent cheat sheet
```

During development `npm run dev -- <args>` runs the TypeScript sources directly
(`tsx src/cli.ts`). `npm test` runs the vitest suite, `npm run typecheck` the
compiler, and `npm run gate` everything a change has to pass before it is
handed over (build, tests, the layout-regression budget and a short fuzz
campaign). The test layers, the benchmark and the fuzzer, and how to run them
on a private corpus without copying it into the repository, are described in
[docs/testing.md](docs/testing.md).

Dependencies: `bpmn-moddle` (the semantic model), `bpmn-auto-layout`
(pinned to `2.0.0-alpha.2`) and `commander`. Nothing else.

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
   [format commands](#formatting-without-xml), never with coordinates.
3. **Ids are readable and stable.** `<Prefix>_<NameSlug>` following the
   bpmn-js conventions: `Activity_CheckInvoice`, `Event_OrderReceived`,
   `Gateway_InvoiceOk`, `Flow_3`, `Participant_Customer`, `Lane_Sales`,
   `DataObjectReference_Order`. Unnamed elements get `<Prefix>_<n>`; name
   collisions get `_2`, `_3` (with a `W_ID_SUFFIXED` warning). Every result
   lists the ids it created.
4. **Nothing is half done.** A command (or a whole `apply` batch) either
   succeeds completely or leaves the file untouched. Structural validation
   errors that the change would introduce block the write (`--force`
   overrides); errors the file already had are reported as
   `W_PREEXISTING_ERROR` and do not block, so a file with an unsupported
   element (a `complexGateway`) or another old problem stays editable.
5. **Conventions instead of coordinates.** Sub-processes are expanded by
   default; the default flow (or, without one, the first outgoing flow) is
   the straight continuation and further branches alternate below and above
   it; exclusive gateways should be named as a question and their branches
   named; joins and parallel gateways stay unnamed. `bpmn validate` lints
   against these.

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
bpmn ext add <file> <id> <prefix:type> [attr=value ...] [--body <text>] [--xml <snippet>] [--replace]
bpmn ext remove <file> <id> <type|index>
bpmn ext list <file> <id> [--json]
bpmn apply <file> [<ops.json> | -]                                           (- = stdin)
bpmn place <file> <id...> [--row-of <id> | --below <id> | --above <id>] [--column-of <id> | --after <id> | --before <id>]
bpmn align <file> <id...> --axis row|column [--to <id>]
bpmn color <file> <id...> --color blue|orange|green|red|purple|default   (alias: colour)
bpmn label <file> <id> --side above|below|left|right
bpmn route <file> <flowId> [--exit right|top|bottom|left] [--entry left|top|bottom|right]
bpmn space <file> (--after <id> | --below <id>) [--by column|row|<px>]
bpmn tidy <file> [<id>...]
bpmn validate <file> [--json] [--strict]
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

### `new`

Creates a file with one empty process. `--name` gives the process a name and
drives its id (`Process_OrderHandling`); `--id` sets it explicitly; the process
is executable unless `--no-executable`. `--target camunda8` declares the
`zeebe:` and `modeler:` namespaces with `modeler:executionPlatform="Camunda
Cloud"`, `--target camunda7` the `camunda:` and `modeler:` namespaces with
`modeler:executionPlatform="Camunda Platform"`. Refuses to overwrite an
existing file (`E_FILE_EXISTS`) unless `--force`.

### `show` and `find`

`show <file>` starts with a `namespaces:` line (declared vendor namespaces,
if any) and the collaboration (pools, message flows) when there is one, then
prints every process in flow order: depth-first from the start events,
following the outgoing flows in declaration order (so a join and what follows
it appear under the first branch that reaches it); unreachable nodes follow,
flagged. Every flow is written as `-> Target (Flow_n "label" if condition)`.
Boundary events are indented under their host, sub-process children under the
sub-process. Then lanes, data, annotations, root messages/errors/signals and
the validation findings (`problems: none` when there are none). `show <file> <id>` prints everything about one element:
settable properties, flows in and out with labels and conditions, host, lane,
scope, extension elements and vendor attributes. `--scope <id>` restricts the
view to one process / sub-process / participant. `find` is a case-insensitive
substring search over ids and names, optionally filtered by `--kind`.

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
diagram BPMNPlane_Collaboration_1 (Collaboration_1)
  participant Participant_OrderHandling "Order handling"
    lane Lane_Sales "Sales"
      row 1: Event_OrderReceived, Activity_CheckInvoice, Gateway_InvoiceOk, Activity_BookInvoice, Event_Done
      row 2: Activity_ClarifyInvoice, Event_Clarified
    lane Lane_Backoffice "Backoffice"
colors: Activity_CheckInvoice red, Flow_2 red
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
`--id` makes the command idempotent.

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

`--if-absent` succeeds silently when the same connection already exists.

### `set`

`set <file> <id> key=value ...` changes properties; `key=` (empty) or
`--unset key` removes one. See [Set keys](#set-keys). Renaming an id
(`id=New_Id`) re-points every reference.

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

### `retype`

Changes the kind keeping id, name, documentation, extension elements, vendor
attributes, flows, boundary events and lane membership. Allowed within a
family: task <-> task / subProcess / callActivity, gateway <-> gateway, event
<-> event of the same position (start / end / catch / throw / boundary), plus
trigger changes (`retype <id> startEvent:message --message OrderReceived`).
A kind token without trigger suffix keeps the event's current trigger
(`retype Event_X startEvent` on a message start is a no-op); drop it with
`retype Event_X startEvent:none` or `set Event_X trigger=none`. Properties
the new kind does not have are dropped with `W_PROPERTY_DROPPED`. A
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
travel with their host. `order <nodeId> <flowId...>` sets the declaration
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
comes first, then the file and the element id: `ext add <file> <id>
<prefix:type> attr=value ... [--body <text>]` creates one element; `--xml`
takes a raw snippet with nested elements instead; `--replace` removes existing
elements of the same type first. The namespace comes from the file or from the
known prefixes (`camunda`, `zeebe`, `modeler`, `bioc`, `color`); other prefixes
must be declared in the file (`E_UNKNOWN_NAMESPACE`). `ext remove <file> <id>
<type|index>` removes every element of a type or the one at an index;
`ext list <file> <id>` shows them with their indexes. Ids inside vendor
extensions (a `camunda:formField id="email"`) are not BPMN ids: they never
clash with BPMN ids or with each other, they are kept untouched on every
write, and `show` / `set` / `remove` on such an id fail with `E_NOT_FOUND`
naming the vendor element and the BPMN element that owns it.

### `apply`

Runs a JSON list of ops as one transaction with one layout pass at the end.
See [Ops JSON](#ops-json-bpmn-apply).

### `validate` and `layout`

`validate` runs the structural checks (errors, exit 2), the lint rules
(warnings, exit 5 with `--strict`) and a layout dry run, without writing; it
prints the findings, `layout: ok|skipped|failed`, and `valid, n warning(s)`
or `n error(s), m warning(s)`. `layout` redraws the whole diagram from the
model (a hand layout is replaced, colours survive); `--expand` /
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
format (`ops`), the example (`opsExample`) and the exit codes. `guide` is the
cheat sheet for agents.

## Layout modes

Every mutating command updates the diagram in one of three modes
(`--layout <mode>`; `--relayout` is `--layout full`, `--no-layout` skips it):

| mode | what happens |
| --- | --- |
| `auto` (default) | A file without diagram is drawn from scratch. A drawing that the engine made and nobody changed since (re-running the engine on the model as it was before the command reproduces every shape, label and connection within 2 px; flow nodes added with `--no-layout` are left out of that check) is redrawn in full, so it keeps the best global layout while the CLI owns it. Any other drawing, hand-made in a modeler or changed by a format command (also one that only reroutes a flow or moves a label), is kept: `incremental`. |
| `incremental` | Keep every existing shape and connection. New elements are placed next to their neighbours (splice: between predecessor and successor; a new branch: one row below the existing branches; a boundary event: on the host's bottom border; ...), room is made like the modeler's space tool (everything right of / below the spot moves, pools, lanes and the sub-processes holding the spot grow; another expanded sub-process the line crosses moves as a whole or stays, it is never stretched; connection labels move with their connection), removed elements' DI is pruned (and an empty column closed; when shapes in other rows reach into it, only the removed node's own row closes, if that tears nothing apart), lane changes move a node into its new lane, an activity whose new name does not fit grows (wider in steps of 20 px up to 200, then higher; never smaller), and only the connections that need it are rerouted (a gateway docks on its vertices, one connection per vertex while one is free). Untouched shapes keep their exact bounds, untouched connections their waypoints. If it fails, `auto` falls back to a full redraw (`W_LAYOUT_INCREMENTAL_FAILED`), an explicit `--layout incremental` fails with `E_LAYOUT_INCREMENTAL` instead. |
| `full` | Redraw everything with the engine (`--engine clean`, default, or `auto`). Colours (`bioc:` / `color:` attributes) are carried over by element id; positions are not. `bpmn layout <file>` always does this. |

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
$ bpmn color order.bpmn Activity_CheckInvoice Flow_2 Gateway_InvoiceOk --color red
$ bpmn align order.bpmn Event_InvoiceHandled Event_ReminderSent --axis column
$ bpmn place order.bpmn Activity_ClarifyInvoice --below Activity_BookInvoice
$ bpmn order order.bpmn Participant_OrderHandling Lane_Backoffice Lane_Sales
$ bpmn route order.bpmn Flow_8 --exit bottom --entry bottom
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
come from an option (`--timer PT2D`). Root elements (`bpmn:Message`,
`bpmn:Error`, `bpmn:Signal`, `bpmn:Escalation`) are looked up by name and
created next to the process when missing. In ops JSON the keys are the option
names in lowerCamelCase (`timerKind`, `errorCode`, `nonInterrupting`).

| trigger | option | notes |
| --- | --- | --- |
| `none` | | plain event; the default for start / end / throw events in `add`; `retype` keeps the current trigger unless you write `<kind>:none` |
| `message` | `--message <name>` | `bpmn:Message` by name |
| `timer` | `--timer <iso>` `[--timer-kind cycle\|duration\|date]` | `R/PT1H` -> timeCycle, `PT2D` -> timeDuration, `2026-01-31T09:00:00Z` -> timeDate (auto-classified; `--timer-kind` overrides) |
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
| `--on <A>` | `on` | Boundary events only: attach to activity A. |
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
| any element | `id` (rename, every reference follows, including `calledElement` strings), `name`, `doc` / `documentation`, any attribute-typed BPMN property of the element's type by its name (`isExecutable`, `isForCompensation`, `completionQuantity`, `processType`, `script`, `scriptFormat`, `implementation`, `calledElement`, `instantiate`, `gatewayDirection`, ...; enums are checked), vendor attributes with a prefix (`camunda:assignee`, `zeebe:formKey`; the xmlns is declared automatically for known prefixes) |
| sequence flows | `condition`, `language`, `default` (`true`/`false`), `source`, `target` (redirect) |
| events | `trigger` (`message`, `timer`, ...), `timer`, `message`, `error`, `errorCode`, `signal`, `escalation`, `escalationCode`, `when`, `link`, `nonInterrupting` (`true`/`false`) |
| activities | `loop` (`none`/`standard`/`parallel`/`sequential`), `cardinality`, `completion` (completion condition) |
| sub-processes | `expanded` (`true`/`false`, drives the diagram), `triggeredByEvent` |
| flow nodes | `lane` (lane id; empty removes the membership), `default` (id of the default outgoing flow of a gateway / activity, the node-side twin of `set <flowId> default=true`; empty clears it) |
| text annotations | `text` |

Unknown keys fail with `E_UNKNOWN_KEY` and a list of the keys the element
accepts.

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
| `add` | `kind` (required), `name`, `id`, `after`, `before`, `flow`, `in`, `on`, `to`, `lane`, `flowName`, `flowId`, `condition`, `language`, `default`, trigger keys (`timer`, `timerKind`, `message`, `error`, `errorCode`, `signal`, `escalation`, `escalationCode`, `when`, `link`, `nonInterrupting`), `collapsed`, `ifAbsent`, `doc`, `set` (map), `process`, `blackBox`, `text`, `members` (list) |
| `connect` | `source`, `target` (required), `name`, `id`, `condition`, `language`, `default`, `message`, `ifAbsent` |
| `set` | `id` (required), `values` (map), `unset` (list); at least one of the two |
| `remove` | `ids` (required list), `bridge` (default true), `ifExists` |
| `retype` | `id`, `kind` (required), trigger keys |
| `move` | `ids` (required list), `after`, `before`, `flow`, `in`, `lane`, flow keys |
| `order` | `id` (required), exactly one of `flows` (outgoing flows of a node) or `lanes` (lanes of a pool / process / parent lane) |
| `ext` | `id`, `action` (`add` / `remove`, required), `type`, `attrs` (map), `body`, `xml`, `replace`, `index` |
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
        { "flowName": "yes", "condition": "${ok}", "nodes": [{ "kind": "serviceTask", "name": "Book invoice" }] },
        {
          "flowName": "no",
          "default": true,
          "nodes": [{ "kind": "userTask", "name": "Clarify invoice", "set": { "doc": "Call the customer and clarify the open positions." } }]
        }
      ]
    },
    { "op": "add", "kind": "boundaryEvent:timer", "name": "Reminder", "on": "Activity_ClarifyInvoice", "timer": "PT2D", "nonInterrupting": true },
    { "op": "add", "kind": "sendTask", "name": "Remind customer", "after": "Event_Reminder" },
    { "op": "add", "kind": "endEvent", "name": "Reminder sent", "in": "Process_OrderHandling" },
    { "op": "connect", "source": "Activity_RemindCustomer", "target": "Event_ReminderSent" },
    { "op": "set", "id": "Activity_BookInvoice", "values": { "name": "Book invoice in ERP", "doc": "Posts the invoice to the ledger." } },
    { "op": "ext", "id": "Activity_BookInvoice", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "book-invoice", "retries": "3" } }
  ]
}
```

`bpmn kinds --json` -> `opsExample` returns exactly this object.

## Output, errors and exit codes

Text result of a mutating command: one line per created / changed / removed
element (`created userTask Activity_CheckInvoice "Check invoice" - after
Event_OrderReceived`), then notes (`note: inserted between A and B`),
warnings (`warning W_CODE element: message  (hint)`), then the layout block,
then `written: <file>` (`dry run: <file> not written` with `--dry-run`). With
`--show` the model view follows. The layout block:

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
  "ok": true, "file": "order.bpmn", "written": true,
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
  "validation": { "errors": [], "warnings": [] },
  "importWarnings": [],
  "view": { "...": "only with --show" }
}
```

`written` is `false` with `--dry-run`; `importWarnings` lists what
bpmn-moddle reported while reading the input file (informational, first line
of each warning).

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
| 5 | `--strict` and the result has warnings |
| 70 | internal error (`E_INTERNAL`; `BPMN_DEBUG=1` prints the stack) |

The full error catalogue with a fix for every code: `bpmn kinds` (section
"ERRORS AND WARNINGS") or `bpmn kinds --json` -> `errors`.

## Quoting

- Expressions and anything containing `$`: **single quotes**, e.g.
  `--condition '${amount > 100}'`, `set Flow_3 condition='${ok}'`. In double
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
  carried over by element id, manual positions are not.
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
  unresolved references, duplicate ids) are refused with `E_IMPORT_LOSSY`;
  `--force` writes anyway and drops that content. The library refuses them
  the same way (`Doc.fromXml` + `mutateDoc` without `force: true`).
- `bpmn-moddle` never sets `$parent` for elements created in memory; the CLI
  maintains containment, `incoming`/`outgoing` and every reference itself. A
  hand-edited file with broken links is reported by `bpmn validate`
  (`E_DANGLING_REF`, `E_FLOW_LINKS`).

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
created sequenceFlow Flow_1 - Event_OrderReceived -> Activity_CheckInvoice
note: appended after Event_OrderReceived
warning W_NO_END Process_OrderHandling: Process Process_OrderHandling has no end event  (Add one after the last node: `bpmn add <file> endEvent "<Name>" --after <nodeId>`.)
warning W_DEAD_END Activity_CheckInvoice: userTask Activity_CheckInvoice "Check invoice" has no outgoing flow  (Continue the flow (`bpmn add <file> <kind> "<Name>" --after Activity_CheckInvoice`) or end it (`bpmn add <file> endEvent "<Name>" --after Activity_CheckInvoice`).)
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn add order.bpmn end "Invoice handled" --after Activity_CheckInvoice
created endEvent Event_InvoiceHandled "Invoice handled" - after Activity_CheckInvoice
created sequenceFlow Flow_2 - Activity_CheckInvoice -> Event_InvoiceHandled
note: appended after Activity_CheckInvoice
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ cat > ops.json <<'EOF'
{ "ops": [
  { "op": "split", "after": "Activity_CheckInvoice", "name": "Invoice ok?", "id": "Gateway_InvoiceOk",
    "branches": [
      { "flowName": "yes", "condition": "=ok", "nodes": [{ "kind": "serviceTask", "name": "Book invoice" }] },
      { "flowName": "no", "default": true, "nodes": [{ "kind": "userTask", "name": "Clarify invoice" }] } ] },
  { "op": "add", "kind": "boundary:timer", "name": "Reminder", "on": "Activity_ClarifyInvoice", "timer": "PT2D", "nonInterrupting": true },
  { "op": "add", "kind": "sendTask", "name": "Remind customer", "after": "Event_Reminder" },
  { "op": "add", "kind": "end", "name": "Reminder sent", "after": "Activity_RemindCustomer" },
  { "op": "ext", "id": "Activity_BookInvoice", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "book-invoice" } }
] }
EOF
$ bpmn apply order.bpmn ops.json
created exclusiveGateway Gateway_InvoiceOk "Invoice ok?" - between Activity_CheckInvoice and Event_InvoiceHandled
created serviceTask Activity_BookInvoice "Book invoice" - after Gateway_InvoiceOk
created sequenceFlow Flow_3 "yes" - Gateway_InvoiceOk -> Activity_BookInvoice
created userTask Activity_ClarifyInvoice "Clarify invoice" - after Gateway_InvoiceOk
created sequenceFlow Flow_4 "no" - Gateway_InvoiceOk -> Activity_ClarifyInvoice
created exclusiveGateway Gateway_InvoiceOk_join - join of Gateway_InvoiceOk
created sequenceFlow Flow_5 - Activity_BookInvoice -> Gateway_InvoiceOk_join
created sequenceFlow Flow_6 - Activity_ClarifyInvoice -> Gateway_InvoiceOk_join
created sequenceFlow Flow_7 - Gateway_InvoiceOk_join -> Event_InvoiceHandled
created boundaryEvent:timer Event_Reminder "Reminder" - on Activity_ClarifyInvoice
created sendTask Activity_RemindCustomer "Remind customer" - after Event_Reminder
created sequenceFlow Flow_8 - Event_Reminder -> Activity_RemindCustomer
created endEvent Event_ReminderSent "Reminder sent" - after Activity_RemindCustomer
created sequenceFlow Flow_9 - Activity_RemindCustomer -> Event_ReminderSent
changed sequenceFlow Flow_2 - Activity_CheckInvoice -> Gateway_InvoiceOk (was -> Event_InvoiceHandled)
changed serviceTask Activity_BookInvoice "Book invoice" - ext added zeebe:taskDefinition
note: inserted Gateway_InvoiceOk between Activity_CheckInvoice and Event_InvoiceHandled
note: appended after Gateway_InvoiceOk
note: appended after Gateway_InvoiceOk
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
  startEvent:message Event_OrderReceived "Order received" [message OrderReceived] -> Activity_CheckInvoice (Flow_1)
  userTask Activity_CheckInvoice "Check invoice" -> Gateway_InvoiceOk (Flow_2)
  exclusiveGateway Gateway_InvoiceOk "Invoice ok?" -> Activity_BookInvoice (Flow_3 "yes" if =ok), Activity_ClarifyInvoice (Flow_4 "no" default)
  serviceTask Activity_BookInvoice "Book invoice" [ext: zeebe:taskDefinition] -> Gateway_InvoiceOk_join (Flow_5)
  exclusiveGateway Gateway_InvoiceOk_join -> Event_InvoiceHandled (Flow_7)
  endEvent Event_InvoiceHandled "Invoice handled"
  userTask Activity_ClarifyInvoice "Clarify invoice" -> Gateway_InvoiceOk_join (Flow_6)
    boundaryEvent:timer Event_Reminder "Reminder" [PT2D, non-interrupting] -> Activity_RemindCustomer (Flow_8)
  sendTask Activity_RemindCustomer "Remind customer" -> Event_ReminderSent (Flow_9)
  endEvent Event_ReminderSent "Reminder sent"
root: message Message_OrderReceived "OrderReceived"
problems: none

$ bpmn set order.bpmn Activity_ClarifyInvoice name="Clarify invoice with customer" doc="Call the customer."
changed userTask Activity_ClarifyInvoice "Clarify invoice with customer" - name=Clarify invoice with customer
changed userTask Activity_ClarifyInvoice "Clarify invoice with customer" - doc=Call the customer.
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn add order.bpmn participant "Order handling"
created collaboration Collaboration_1
created participant Participant_OrderHandling "Order handling" - wraps process Process_OrderHandling
note: collaboration Collaboration_1 created; Participant_OrderHandling wraps the existing process Process_OrderHandling
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
created messageFlow Flow_10 - Activity_RemindCustomer -> Participant_Customer
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn show order.bpmn --layout
diagram BPMNPlane_Collaboration_1 (Collaboration_1)
  participant Participant_OrderHandling "Order handling"
    row 1: Event_OrderReceived, Activity_CheckInvoice, Gateway_InvoiceOk, Activity_BookInvoice, Gateway_InvoiceOk_join, Event_InvoiceHandled
    row 2: Activity_ClarifyInvoice
    row 3: Activity_RemindCustomer, Event_ReminderSent
  participant Participant_Customer "Customer"
layout quality: score 0: no layout problems

$ bpmn color order.bpmn Activity_CheckInvoice Flow_2 Gateway_InvoiceOk --color red
layout: ok - incremental (format operations only: drawing kept)
  format color #0: colored Activity_CheckInvoice, Flow_2, Gateway_InvoiceOk
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn label order.bpmn Gateway_InvoiceOk --side below
layout: ok - incremental (format operations only: drawing kept)
  format label #0: label placed Gateway_InvoiceOk
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn place order.bpmn Activity_RemindCustomer Event_ReminderSent --row-of Activity_ClarifyInvoice --after Activity_ClarifyInvoice
layout: ok - incremental (format operations only: drawing kept)
  format place #0: moved Activity_RemindCustomer, Event_ReminderSent; rerouted Flow_8, Flow_6, Flow_10
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn add order.bpmn serviceTask "Archive invoice" --after Activity_BookInvoice
created serviceTask Activity_ArchiveInvoice "Archive invoice" - after Activity_BookInvoice
created sequenceFlow Flow_11 - Activity_ArchiveInvoice -> Gateway_InvoiceOk_join
changed sequenceFlow Flow_5 - Activity_BookInvoice -> Activity_ArchiveInvoice (was -> Gateway_InvoiceOk_join)
note: inserted between Activity_BookInvoice and Gateway_InvoiceOk_join
layout: ok - incremental (hand-made diagram: kept, changes placed locally)
  placed: Activity_ArchiveInvoice, Flow_11
  moved: Participant_OrderHandling, Event_InvoiceHandled, Activity_RemindCustomer, Event_ReminderSent, Gateway_InvoiceOk_join, Participant_Customer
  rerouted: Flow_5
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn metrics order.bpmn
score 0: no layout problems

$ bpmn validate order.bpmn
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
redrawing; `metrics` confirms that no layout problem was introduced.

(The result lines and the `show` views above are copied from the real output
of this version; wording may change between versions, ids and structure are
what matters. `test/batch.test.ts` checks the quick-start `show` block
against the live renderer.)

## Library use

The package also exports its building blocks (`dist/index.js`): `Doc`
(load / create / query the model), `parseOps` and `OPS_SCHEMA`, `runOps`,
`mutateFile` / `mutateDoc` / `checkFile` (the write pipeline, with the types
`MutationOptions`, `MutationResult`, `LayoutMode`, `LayoutStatus` and
`LAYOUT_MODES`), `validateDoc`, `buildView` / `elementDetail` /
`findElements`, `layoutModel` and the `KINDS` vocabulary. The diagram API:
`layoutProblems` / `layoutProblemsOfXml` / `diffProblems` / `metricsDelta`
(layout metrics with ids, `METRIC_KEYS`, `METRIC_WEIGHTS`), `layoutView`
(what `show --layout` prints), `runFormatOps` (the format operations on a
loaded document; `FORMAT_OP_NAMES`, `isFormatOp`, the op types `PlaceOp`,
`AlignOp`, `ColorOp`, `LabelOp`, `RouteOp`, `SpaceOp`, `TidyOp`) and the
colour palette `SWATCHES`. Everything the CLI does goes through these
functions. `mutateDoc` applies the same guards as the CLI: a lossy import
(`E_IMPORT_LOSSY`), errors the ops would introduce (`E_VALIDATION`) and a
retype that would delete a sub-process's content (`E_WOULD_DROP_CONTENT`)
are refused unless `force: true`; `runOps` alone applies the ops without
these guards.
