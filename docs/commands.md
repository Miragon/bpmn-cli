# Commands

What each command does and what is easy to get wrong.

::: tip From the CLI
`bpmn guide commands` and `bpmn <command> --help` print every option. `bpmn kinds` prints the tables
of kinds, keys and error codes.
:::

## Overview

| group | command | what it does |
| --- | --- | --- |
| Read | [`show`, `find`](#show-and-find) | print the model without coordinates, search it |
| | [`metrics`](#metrics) | score the drawing and list layout problems |
| | [`render`](#render) | draw the diagram as PNG or SVG |
| | [`validate`](#validate-and-layout) | check structure, engine rules and bpmnlint |
| Change | [`new`](#new) | create a file with one empty process |
| | [`add`](#add) | create an element and wire it in |
| | [`connect`](#connect) | connect two elements |
| | [`set`](#set) | change properties, rename ids |
| | [`remove`](#remove) | remove elements and bridge the gap |
| | [`retype`](#retype) | change the kind, keep id and flows |
| | [`move`, `order`](#move-and-order) | place nodes elsewhere, order branches, lanes and pools |
| | [`ext`](#ext) | read and write vendor extension elements |
| | [`apply`](#apply) | run a JSON batch of ops as one transaction |
| Format | [`place`, `align`, `color`, ...](layout.md#formatting-without-xml) | change the drawing by naming elements |
| | [`layout`](#validate-and-layout) | redraw the whole diagram |
| Help | [`kinds`, `guide`](#kinds-and-guide) | reference tables, cheat sheet for agents |

`-` as the file reads the model from stdin; a mutating command then writes to stdout. Ids, kinds and
keys are in [Ids, kinds and keys](reference.md).

## Options of every write

| option | effect |
| --- | --- |
| `--json` | machine-readable result on stdout, errors as JSON on stderr |
| `--summary` | short result: created, changed and removed ids, new warnings |
| `-o, --out <file>` | write elsewhere; `-o -` writes the XML to stdout |
| `--dry-run` | run everything and write nothing |
| `--render <file.png\|file.svg>` | also draw the result, the change marked |
| `--layout <auto\|incremental\|full>` | how the diagram is updated ([Layout modes](layout.md#layout-modes)) |
| `--no-layout` | do not touch the diagram; new elements get no shape until the next layout |
| `--force` | write despite a lossy import, new validation errors, or an existing file (`new`) |
| `--backup` | copy `<file>` to `<file>.bak` first |
| `--strict` | exit code 5 when the result has warnings |
| `--keep-flow-ids` | keep the ids of flows whose ends change; `W_FLOW_ID_STALE` names each id that no longer fits |
| `--lint-config <path>`, `--no-lint-config` | choose or ignore the project's [bpmnlint](bpmnlint.md) configuration |

`BPMN_KEEP_FLOW_IDS=1` makes `--keep-flow-ids` the default. A result whose ids it kept says so with
`note: flow ids kept: BPMN_KEEP_FLOW_IDS=1 (...)`.

## `new`

```sh
bpmn new order.bpmn --name "Order handling" --target camunda8
```

`--name` gives `Process_OrderHandling`; without it the id is `Process_1`. `--target camunda8`
declares the `zeebe:` and `modeler:` namespaces, `--target camunda7` the `camunda:` and `modeler:` namespaces plus the
`historyTimeToLive` the engine needs. Use `camunda7` for CIB seven and Operaton too
([Camunda 7 and Camunda 8](camunda.md)).

## `show` and `find`

| form | prints |
| --- | --- |
| `show <file>` | the whole model in flow order, then lanes, data and validation findings |
| `show <file> <id>` | everything about one element |
| `show <file> --around <id> --depth 1` | the element and its neighbours, for large models |
| `show <file> <id> --context` | where an element is and what catches it, one fact per line |
| `show <file> --layout` | the drawing as rows and columns, plus layout problems |
| `show <file> --conventions` | the id conventions new ids will follow |
| `find <file> <text>` | case-insensitive search over ids, names and vendor values |

A node line reads `<kind> <id> "<name>" -> <target> (<flowId>)`. On a large model, read with
`--around` or `--context` instead of the whole view.

## `add`

Creates one element and wires it in. A placement option says where; trailing `key=value` pairs work
like `set`.

```sh
bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived camunda:assignee=kermit
bpmn add order.bpmn boundary:timer "2 days" --on Activity_CheckInvoice --timer PT2D --non-interrupting
```

- Placement: `--after`, `--before`, `--flow`, `--in`, `--on`, `--lane` ([Placement grammar](reference.md#placement-grammar)).
- The id comes from the name (`Activity_CheckInvoice`). `--id` with `--if-absent` makes the add idempotent.
- Lanes, data and annotations take `--in` only; wire them afterwards with `connect`.
- A group takes no placement: `--members <id,...>` names what it is drawn around.
- The first `participant` wraps the existing process. `--black-box` creates an empty pool and never
  wraps, so add a normal participant first.

## `connect`

```sh
bpmn connect order.bpmn Gateway_InvoiceOk Activity_BookInvoice --name yes
```

The endpoints decide the kind: sequence flow, message flow (different pools), association
(annotation) or data association. A second outgoing flow from a node that is no gateway warns
`W_IMPLICIT_SPLIT`.

## `set`

```sh
bpmn set order.bpmn Activity_CheckInvoice name="Check the invoice" camunda:asyncBefore=true
bpmn set order.bpmn Activity_CheckInvoice 'loop.camunda:collection=${invoices}'
```

`key=` or `--unset key` removes a property. `id=New_Id` renames and re-points every reference. Parts
without an id take a prefix: `definition.`, `loop.`, `condition.`. In a Camunda 8 file most settings
are extension elements: `set` refuses them and the hint names the `ext add` to use.

## `remove`

Removes elements with everything that depends on them, then bridges the gap.

| situation | what happens |
| --- | --- |
| one flow in, one out | predecessor connected to successor; `--no-bridge` leaves the gap |
| a merge that does not synchronise | bridged from every predecessor |
| a parallel or inclusive join | refused (`E_AMBIGUOUS_BRIDGE`): choose `--bridge-all` or `--no-bridge` |
| `--with-branch` | also removes the path only this node leads to |

## `retype`

Changes the kind within a family and keeps id, name, flows, boundary events and lane.

```sh
bpmn retype order.bpmn Event_X startEvent:message --message OrderReceived
```

A kind without trigger keeps the current trigger. To drop it, write `retype Event_X startEvent:none`.
A sub-process with content becomes a task only with `--force`.

## `move` and `order`

`move` detaches nodes, bridges the gap like `remove`, and places them again with the options of
`add`. `order` sets the order of a node's outgoing flows, a pool's lanes or a collaboration's pools.

```sh
bpmn move order.bpmn Activity_ClarifyInvoice --before Activity_BookInvoice
bpmn order order.bpmn Gateway_InvoiceOk Flow_InvoiceOkToClarifyInvoice Flow_InvoiceOkToBookInvoice
```

The flow order drives the picture: the default flow (else the first) continues straight, the others
go alternately below and above it. To pin a branch as the continuation, make it the default.

## `ext`

Reads and writes vendor extension elements. The sub-command comes first.

```console
$ bpmn ext add order.bpmn Activity_BookInvoice camunda:inputParameter name=amount --body '${order.total}'
$ bpmn ext list order.bpmn Activity_BookInvoice
0: camunda:inputOutput
     camunda:inputParameter name="amount" body="${order.total}"
$ bpmn ext remove order.bpmn Activity_BookInvoice 'camunda:inputParameter[name=amount]'
```

Containers such as `camunda:inputOutput` are created and removed for you. Quote selectors: `[` and
`]` are glob characters in zsh.

## `apply`

Runs a JSON list of ops as one transaction: all or nothing, one layout pass. `"as": "$name"` names
what an op creates. See [Ops JSON](ops.md).

```json [ops.json]
[
  { "op": "add", "kind": "userTask", "name": "Ship order",
    "after": "Activity_BookInvoice", "as": "$ship" },
  { "op": "set", "id": "$ship", "values": { "camunda:assignee": "piggy" } }
]
```

```sh
bpmn apply order.bpmn ops.json
```

## `validate` and `layout`

`validate` checks a file without writing: structure, the engine rules of its platform, the
project's bpmnlint and a layout dry run.

| result | exit code |
| --- | --- |
| `valid, 2 warning(s)` | 0, or 5 under `--strict` |
| `1 error(s), 2 warning(s)` | 2 |

A `W_C7_DEPLOY_*` or `W_C8_DEPLOY_*` warning means the engine refuses the file. A bpmnlint error
fails the check ([bpmnlint](bpmnlint.md)).

`layout` redraws the whole diagram from the model; colours and DI ids survive. `layout --tidy` only
removes overlaps.

## `metrics`

Scores the drawing: `score 0: no layout problems`, or one line per problem with its ids, such as
`crossings [Flow_1, Flow_7]`. Every write prints the same score before and after.

## `render`

Draws a diagram as PNG or SVG, without a browser, so you or an agent can look at it.

```console
$ bpmn render order.bpmn --around Gateway_InvoiceOk --depth 1 --problems -o ok.png
wrote ok.png  490x305 px  ~191 image tokens  scale 1.00  plane Collaboration_OrderHandling
crop: around Gateway_InvoiceOk (depth 1): 4 nodes
problems: none
```

<figure class="diagram">
  <img src="/shots/commands-render-halos.svg" alt="The order process with a new timer boundary event and end event in green halos, the renamed task in an orange halo and one numbered layout problem" />
  <figcaption><code>apply ... --render</code>: green created, orange changed, 1 problem added</figcaption>
</figure>

On a large model, render a crop (`--around`, `--path`, `--scope`) or `--tiles`: the whole plane is
scaled down until labels are unreadable.

## `kinds` and `guide`

`kinds` prints kinds, triggers, set keys, placement options, the ops schema, error codes and exit
codes; `--section errors` prints one part. `guide` is the cheat sheet for agents; `guide --short`
is its core, `guide <topic>` one part.

## Next steps

- [Ops JSON](ops.md): many changes in one batch.
- [Layout and formatting](layout.md): how the drawing is kept, and the format commands.
- [Ids, kinds and keys](reference.md): every kind, trigger and key.
