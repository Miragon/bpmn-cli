# Command reference

This page says what each command does and what is easy to get wrong. The full reference, with every
option and more examples, is built into the CLI: `bpmn guide commands` and `bpmn <command> --help`.

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
bpmn place <file> <boundaryEventId> --side top|bottom
bpmn align <file> [<id...>] --axis row|column [--to <id>] [SELECTORS]
bpmn color <file> [<id...>] --color blue|orange|green|red|purple|default [SELECTORS]   (alias: colour)
bpmn label <file> <id> --side above|below|left|right
bpmn route <file> <flowId> [--exit right|top|bottom|left] [--entry left|top|bottom|right]
bpmn space <file> (--after <id> | --below <id>) [--by column|row|<n>col|<n>row|<px>|-column|-<n>col|-row|-<px>]
bpmn tidy <file> [<id>...] [SELECTORS]
bpmn compact <file> [<poolId|laneId|subProcessId>...]
  SELECTORS: --path <fromId> <toId> [--via <flowId...>] | --kind <kind> | --branch <flowId>
bpmn validate <file> [--json] [--strict] [--platform auto|c7|c8|none]
bpmn layout <file> [--expand <id,...>] [--collapse <id,...>]
bpmn layout <file> --tidy
bpmn metrics <file> [--json]
bpmn render <file> [<id>...] [-o <file.png|file.svg|->] [--format png|svg] [--plane <id>] [--around <id> [--depth n] [--inner]]
            [--path <fromId> <toId> [--via <flowId...>]] [--scope <id>] [--highlight <id,...>] [--problems] [--tiles]
            [--max-size <px>] [--scale <n>] [--json]
bpmn kinds [--section <name,...>] [--json]
bpmn guide [--short | <topic>]
```

`-` as the file reads the model from stdin; a mutating command then writes its result to stdout.
Ids, kinds, triggers, placement options and set keys are described in the [reference](reference.md),
the format commands (`place` to `compact`, drawing only) in [Layout and formatting](layout.md).

Common options of every mutating command (all but `show`, `find`, `validate`, `metrics`, `render`,
`ext list`, `kinds`, `guide`; `layout` always redraws, so it takes no layout mode):

| option | effect |
| --- | --- |
| `--json` | machine-readable result on stdout, errors as JSON on stderr |
| `--summary` | a short result: created, changed and removed ids, the added warnings, one layout line |
| `-o, --out <file>` | write to another file instead of in place; `-o -` writes the XML to stdout |
| `--dry-run` | run everything, layout included, and write nothing |
| `--render <file.png\|file.svg>` | also draw the result, with what the change touched marked (see [`render`](#render)) |
| `--layout <auto\|incremental\|full>` | how the diagram is updated, default `auto` (see [Layout and formatting](layout.md)); `--relayout` = `full` |
| `--no-layout` | write without updating the diagram; new elements have no shape until `bpmn layout` |
| `--force` | write although the import was lossy, the change adds validation errors, or (`new`) the file exists |
| `--backup` | copy `<file>` to `<file>.bak` before overwriting |
| `--show` | append the full model view (as `show` prints it) to the result |
| `--strict` | exit with code 5 when the result has warnings |
| `--keep-flow-ids` | keep the id of every existing sequence flow the change gives other ends; `W_FLOW_ID_STALE` names each flow whose id no longer names its ends. Default from `BPMN_KEEP_FLOW_IDS=1` ([Limitations](contract.md#limitations)) |
| `--no-keep-flow-ids` | rename a flow whose id names its old ends after its new ones (the default), also when `BPMN_KEEP_FLOW_IDS=1` |
| `--engine <clean\|auto>` | layout engine: `clean` (built-in, default) or `auto` (bpmn-auto-layout) |

## `new`

Creates a file with one empty, executable process: `bpmn new order.bpmn --name "Order handling"`.
`--name` drives the ids (`Process_OrderHandling`, `Definitions_OrderHandling`), `--id` sets the
process id; without either they are `Process_1` and `Definitions_1`. `--target camunda8` declares
the `zeebe:` and `modeler:` namespaces and the platform version,
`--target camunda7` the `camunda:` and `modeler:` namespaces plus `camunda:historyTimeToLive="180"`,
without which the engines refuse to deploy. Use `camunda7` for CIB seven and Operaton too (see
[Camunda 7 and Camunda 8](camunda.md)). An existing file is kept (`E_FILE_EXISTS`) unless `--force`.

## `show` and `find`

`show <file>` prints the model without coordinates: pools and message flows, every process in flow
order, then lanes, data, annotations and the validation findings. A node line reads `<kind> <id>
"<name>" [properties] -> <target> (<flowId> "label" if condition)`. A join and what follows it
appear under the first branch that reaches it; nodes that no start event reaches come last, flagged.
`show <file> <id>` prints everything about one element, `--scope <id>` one process or pool.
`show <file> --layout` prints the drawing instead, still without coordinates: per pool and lane the
rows of node ids with their column (`row 1: c0 Event_A, c1 Activity_B`), colours, labels off their
default side and the problems of [`metrics`](#metrics).

`find` is a case-insensitive substring search over ids, names and vendor attribute values:
`bpmn find order.bpmn kermit` finds the task with `camunda:assignee=kermit`.

### Reading large models: `show --around` and `show <id> --context`

The whole view of a large model is tens of kilobytes. Two views answer the questions of a local
edit with far less; both take ids only, because names may repeat.

```
bpmn show claims.bpmn --around Activity_Pay --depth 1
bpmn show claims.bpmn Activity_RateDamage --context
```

`--around <id>` prints the element and everything within `--depth` flow steps in both directions
(default 2), in the format of `show`, and its header counts what was left out. A boundary event and
its host are neighbours, and `--inner` also enters sub-processes. `<id> --context` prints one line
per fact: where the element is, its lane, its neighbours, the boundary events and event
sub-processes that catch it (also those of the sub-processes around it), its message flows and its
data.

## `add`

Creates one element and wires it in. A placement option says where (`--after`, `--before`,
`--flow`, `--in`, `--on`); trailing `key=value` pairs are applied like `set`. Lanes, data and text
annotations take `--in` only; wire data and annotations afterwards with `connect`.

```
bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived camunda:assignee=kermit
bpmn add order.bpmn boundary:timer "2 days" --on Activity_CheckInvoice --timer PT2D --non-interrupting
```

- The id is derived from the name (`Activity_CheckInvoice`); `--id` chooses it, and `--id` with
  `--if-absent` makes the command idempotent.
- Without `--lane` the element gets the lane of its anchor or host. In a flow between two lanes the
  CLI picks one and warns `W_LANE_INHERITED`, naming the `move --lane` that switches.
- The first `participant` wraps the existing process, later ones get a new process. `--black-box`
  creates a pool without a process and never wraps, so add a normal participant first.

## `connect`

Connects two elements: `bpmn connect order.bpmn Gateway_InvoiceOk Activity_BookInvoice --name yes`.
The endpoints decide the kind: two flow nodes in one scope give a sequence flow, endpoints in
different pools a message flow, a text annotation an association, a data object or store a data
association. A second flow between the same two elements is created, with `W_DUPLICATE_FLOW`; with
`--if-absent` the command does nothing instead. A second outgoing flow of a node that is no gateway
warns `W_IMPLICIT_SPLIT`, a second incoming flow `W_IMPLICIT_JOIN`.

## `set`

Changes properties of one element; `key=` (empty) or `--unset key` removes one, `id=New_Id` renames
the element and re-points every reference. `bpmn kinds --section setKeys,nestedKeys` lists the keys.

```
bpmn set order.bpmn Activity_CheckInvoice name="Check the invoice" camunda:asyncBefore=true
bpmn set order.bpmn Activity_CheckInvoice 'loop.camunda:collection=${invoices}'
```

- Parts without an id of their own take a prefix: `definition.<key>` (event definition),
  `loop.<key>` (loop characteristics), `condition.<key>` (condition expression). A vendor attribute
  on the wrong one is refused with `E_WRONG_HOST`; the hint names the right key.
- Boolean `camunda:` attributes are written as exactly `true` or `false` (`yes`, `1`, `TRUE` are
  converted), because the engines read nothing else.
- In a Camunda 8 file most settings are zeebe extension elements, not attributes: `set` refuses
  them, and the hint is the `ext add` that writes them.

## `remove`

Removes elements with everything that depends on them (flows, boundary events, associations,
message flows, sub-process children): `bpmn remove order.bpmn Activity_ClarifyInvoice`.

- A node with one incoming and one outgoing flow is bridged: its predecessor is connected to its
  successor and the flow keeps label and condition. `--no-bridge` leaves the gap open.
- A merge that does not synchronise (an exclusive gateway, a task with two incoming flows) is
  bridged from every predecessor. A parallel or inclusive join is refused (`E_AMBIGUOUS_BRIDGE`),
  because bridging ends the synchronisation: say `--bridge-all` or `--no-bridge`.
- `--with-branch` also removes the path only this node leads to, up to the next node another path
  reaches. A node that several paths reach is refused (`E_AMBIGUOUS_BRANCH`).
- A bridge that would put an invalid target behind an event-based gateway is refused with
  `E_INVALID_BRIDGE` and nothing is written. The same holds for `move`.

## `retype`

Changes the kind and keeps id, name, flows, boundary events, lane and extension elements. Allowed
within a family: task to task, sub-process or call activity; gateway to gateway; event to event of
the same position; and trigger changes (`retype Event_X startEvent:message --message OrderReceived`).

- A kind without trigger suffix keeps the current trigger: `retype Event_X startEvent` on a message
  start event changes nothing. Drop the trigger with `retype Event_X startEvent:none`.
- Vendor content is kept even when the new kind cannot use it (`camunda:assignee` on a service
  task); a warning names it and the command that removes it.
- A sub-process with content becomes a task or call activity only with `--force`; without it the
  command fails with `E_WOULD_DROP_CONTENT` and lists what would be deleted.

## `move` and `order`

`move` detaches nodes, bridging the place they leave like `remove`, and places them again with the
placement options of `add`; `--lane` assigns a lane. `order` sets a declaration order: the outgoing
flows of a node, the lanes of a pool, or the pools of a collaboration, depending on the ids given.

```
bpmn move order.bpmn Activity_ClarifyInvoice --before Activity_BookInvoice
bpmn order order.bpmn Gateway_InvoiceOk Flow_InvoiceOkToClarifyInvoice Flow_InvoiceOkToBookInvoice
```

- `move --in` moves into another scope without connecting; flows that would cross scopes are
  removed and reported. Boundary events travel with their host, and a node keeps its lane.
- With `--keep-flow-ids` the moved node's one out-flow becomes its out-flow at the new place and
  the bridge keeps its in-flow, so both keep their ids (`W_FLOW_ID_STALE` when an id named the old
  ends). The out-flow keeps its documentation and extensions; its name, condition and annotations
  stay with the bridge at the old place, and it is no longer a default flow (a node that is not
  bridged drops name and condition, `W_LABEL_DROPPED`, `W_CONDITION_DROPPED`, unless the flow is
  put back between its old ends). Nodes moved together keep the flow between them, unless the
  first has several out-flows. What cannot be put back is removed (`removed:`): the out-flow after
  an append (after a gateway or a node without successor) or `--in`, and the other flows of a node
  that is not bridged (several in- or out-flows, or none in or none out, like a start or end
  event).
- The flow order drives the picture: the default flow (else the first) continues straight, the
  others alternate below and above it. To pin a branch as the continuation, make it the default.
- Ids that `order` does not list follow in their old order. A full redraw (`bpmn layout`) orders
  pools by its own rule, not by the declared order.

## `ext`

Reads and writes vendor extension elements inside `<bpmn:extensionElements>`; which ones the
engines read is described in [Camunda 7 and Camunda 8](camunda.md). The sub-command comes first.

```
$ bpmn ext add order.bpmn Activity_BookInvoice camunda:inputParameter name=amount --body '${order.total}'
$ bpmn ext list order.bpmn Activity_BookInvoice
0: camunda:inputOutput
     camunda:inputParameter name="amount" body="${order.total}"
$ bpmn ext remove order.bpmn Activity_BookInvoice 'camunda:inputParameter[name=amount]'
```

- Child types go into their container, created when missing (`camunda:inputParameter` into
  `camunda:inputOutput`, `zeebe:input` into `zeebe:ioMapping`); an emptied container is removed.
- An item whose key exists (`name`, `id`, `target` or `key`, by type) replaces the old item, which
  is reported. A second single-instance container is merged into the first; conflicting values
  fail with `E_DUPLICATE_EXTENSION` unless `--replace`.
- `ext remove` takes a type (every element of it), a selector or an index from `ext list`. Quote
  selectors: `[` and `]` are glob characters in zsh.
- Ids inside vendor elements (`camunda:formField id="approved"`) are not BPMN ids: `show`, `set`
  and `remove` on one fail with `E_NOT_FOUND` and name the BPMN element that owns it.

## `apply`

Runs a JSON list of ops as one transaction: all or nothing, one layout pass at the end. An op names
what it creates with `"as": "$name"`, later ops use `"$name"` as an id. See [Ops JSON](ops.md);
`bpmn kinds --section ops --json` prints the JSON Schema. `-` as the ops file reads stdin.

```
$ cat ops.json
[{"op":"add","kind":"userTask","name":"Ship order","after":"Activity_BookInvoice","as":"$ship"},
 {"op":"set","id":"$ship","values":{"camunda:assignee":"piggy"}}]
$ bpmn apply order.bpmn ops.json
```

## `validate` and `layout`

`validate` checks a file without writing: structural errors, lint warnings, the engine rules of the
file's platform and a layout dry run. After the findings it prints a `platform:` line, `layout: ok`
and `valid, 2 warning(s)` or `1 error(s), 2 warning(s)`. Errors exit with code 2; warnings exit
with 0, or with 5 under `--strict`. The platform is detected from `modeler:executionPlatform`, else
from the vendor namespace in use, and `--platform` overrides it. Engine findings are warnings named
`W_C7_*` or `W_C8_*`; a `W_C7_DEPLOY_*` or `W_C8_DEPLOY_*` one means the engine refuses the file.

`layout` redraws the whole diagram from the model: a hand-made layout is replaced, colours and DI
ids survive. `--expand` and `--collapse` change which sub-processes are drawn expanded.
`layout --tidy` keeps the drawing and only removes overlaps, like `bpmn tidy`.

## `metrics`

Measures the drawing: `score 0: no layout problems`, or a score and one line per problem with the
ids of the elements involved, such as `crossings [Flow_1, Flow_7]` or `outsideLane [Activity_A,
Lane_Sales]`. `--json` gives `{file, score, counts, problems: [{kind, ids, detail?}]}`. Every
mutating command reports the same measurement before and after (`layout quality: score 0 -> 0`)
with the problems the change added and resolved. [Testing](testing.md) lists the problem kinds.

## `render`

Draws one diagram plane as PNG or SVG, so that you or an agent can look at it. No browser is
involved and the font is bundled, so an image looks the same on every machine. The drawing is close
to what bpmn-js shows, not identical.

```
$ bpmn render order.bpmn --around Gateway_InvoiceOk --depth 1 --problems -o ok.png
wrote ok.png  490x295 px  ~184 image tokens  scale 1.00  plane Process_OrderHandling
crop: around Gateway_InvoiceOk (depth 1): 4 nodes
problems: none
```

- Without `-o` the image goes to `bpmn-cli/<name>.png` in the system temp directory and the path
  is printed. A collapsed sub-process has its own plane, drawn with `--plane <id>`.
- One crop per call: `--around <id>` (the window of `show --around`), `--path <fromId> <toId>`,
  `--scope <id>` (a pool, lane or sub-process) or ids after the file. On a large model render a
  crop: the whole plane is scaled to `--max-size` (default 2000 px) and a note says when its labels
  become too small to read. `--tiles` splits such an image into readable tiles instead.
- `--problems` numbers the layout problems of [`metrics`](#metrics) in the image and lists them
  with their ids (`1 crossings [Flow_6, Flow_21]`); `--highlight <id,...>` puts a halo on elements.
- `--render <file.png>` on a mutating command draws its result, also with `--dry-run`: created
  elements with a green halo, changed ones orange, moved ones blue, the layout problems the change
  added numbered. A failed render is reported and the change stands.

## `kinds` and `guide`

`kinds` prints the tables the commands refer to: kinds, triggers, set keys, placement options, ops
format, error catalogue and exit codes. `kinds --section errors` prints one part, `--json` gives
the data. `guide` is the cheat sheet written for agents; `guide --short` is its core in at most
5 KB, and `guide <topic>` prints one part: `contract`, `workflow`, `reading`, `output`, `layout`,
`format`, `render`, `ops`, `placement`, `triggers`, `errors`, `quoting`, `camunda7`, `camunda8`,
`commands`.
