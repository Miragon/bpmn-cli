# Commands

What each command does and what is easy to get wrong. bpmn-cli has 26 commands. A flag says where an
element goes and how the command runs; what the element holds is a `key=value`
([Flag or key](reference.md#flag-or-key-value)).

::: tip From the CLI
`bpmn guide commands` and `bpmn <command> --help` print every option. `bpmn guide kinds` and the other
topics of `bpmn guide` print the tables of kinds, keys and exit codes.
:::

## Overview

| group | command | what it does |
| --- | --- | --- |
| Read | [`show`, `find`](#show-and-find) | print the model without coordinates, search it |
| | [`diagram`](#diagram) | judge the drawing: score, problems, rows and columns |
| | [`conventions`](#conventions) | the id patterns new ids follow here |
| | [`render`](#render) | draw the diagram as PNG or SVG |
| | [`validate`](#validate) | check structure, engine rules and the project's bpmnlint |
| Change | [`new`](#new) | create a file with one empty process |
| | [`add`](#add) | create an element and wire it in |
| | [`connect`](#connect) | connect two elements |
| | [`set`](#set) | change properties, rename ids |
| | [`remove`](#remove) | remove elements and bridge the gap |
| | [`retype`](#retype) | change the kind, keep id and flows |
| | [`move`, `order`](#move-and-order) | place nodes elsewhere, order branches, lanes and pools |
| | [`ext add`, `ext remove`](#ext) | write vendor extension elements |
| | [`apply`](#apply) | run a JSON list of operations as one transaction |
| Draw | [`place`, `color`, `label`, `route`, `space`, `tidy`, `compact`](layout.md#formatting-without-xml) | change the drawing by naming elements |
| | [`layout`](#layout) | redraw the whole diagram |
| Help | [`guide`](#guide) | the help, by topic |

`-` as the file reads the model from stdin; a write then prints the XML to stdout. Ids, kinds and
keys are in [Syntax and output](reference.md).

## Options of every write

| option | effect |
| --- | --- |
| `--json` | the result as JSON on stdout, errors as JSON on stderr |
| `-o <file>` | write elsewhere; `-o -` writes the XML to stdout |
| `--dry-run` | run everything and write nothing |
| `--force` | write despite a lossy import, new errors or content a retype deletes; on `new`, overwrite a file |

The reads and `render` take `--json` too.

## `new`

```sh
bpmn new order.bpmn "Order handling" --target camunda8
```

The name gives the process id `orderHandling`; without a name the id is `Process_1`, and `--id` sets
one. `--target camunda8` declares the `zeebe:` and `modeler:` namespaces, `--target camunda7` the
`camunda:` and `modeler:` namespaces plus the `historyTimeToLive` the engine needs, and `--target none`
makes the process not executable. Use `camunda7` for CIB seven and Operaton too
([Camunda 7 and Camunda 8](camunda.md)).

## `show` and `find`

Each read answers one question, and its flags only narrow the answer.

| form | prints |
| --- | --- |
| `show <file>` | the whole model in flow order, then lanes and data, then the state line |
| `show <file> <id>` | everything needed to change one element: place, flows, what catches it, attributes, numbered extensions |
| `show <file> --in <id>` | one pool, process, lane or sub-process |
| `show <file> --around <id> --depth 1` | the element and its neighbours, for large models |
| `find <file> <text>` | one line per match over ids, names and vendor values, case-insensitive |
| `find <file> --kind task --in <id>` | every element of a kind or family (`task`, `event`, `gateway`) in a container |

A node line reads `<kind> <id> "<name>" -> <target> (<flowId>)`. A long outline collapses further scopes
to one line that names the `show --in` that opens them; `--json` is never cut.

`find` prints id, kind, name and container, separated by tabs, so ids pipe:

```console
$ bpmn find order.bpmn --kind event | cut -f1
startEvent_orderReceived
endEvent_done
```

No hit prints nothing and exits 0.

## `diagram`

The drawing as text: the layout score on line 1, every problem with its ids, then the rows and columns.

```console
$ bpmn diagram order.bpmn
score 6: crossings 1, labelOnLine 1
  crossings    flow_invoiceOkToBookInvoice x messageFlow_askCustomerToCustomer
  labelOnLine  flow_invoiceOkToBookInvoice, messageFlow_askCustomerToCustomer
participant participant_customer "Customer"  c0..c5
participant participant_orderHandling "Order handling"  c0..c5   row 1: c0 startEvent_orderReceived, c1 userTask_checkInvoice, c2 gateway_invoiceOk, c3 serviceTask_bookInvoice, c4 gateway_invoiceOkJoin, c5 endEvent_invoiceHandled
                                                                 row 2: c3 sendTask_askCustomer
```

Every write prints the same score before and after. Lower is better, 0 means no problems. Graders read
`.score` from `--json`. A crossing with the dotted line of a text annotation is no problem, and flows are
not routed around one; a line through the annotation's text is (`through`).

## `conventions`

The id patterns new ids of each kind follow, from the nearest `.bpmnlintrc` or the defaults of
`element-id-naming`. It also answers for a file that does not exist yet.
See [bpmnlint](bpmnlint.md#checking).

## `add`

Creates one element and wires it in. A placement flag says where; trailing `key=value` pairs say what
it holds.

```sh
bpmn add order.bpmn userTask "Check invoice" --after startEvent_orderReceived \
  camunda:assignee=kermit
bpmn add order.bpmn boundary:timer "2 days" --on userTask_checkInvoice \
  timer=P2D nonInterrupting=true
```

- Placement: `--after`, `--before`, `--flow`, `--in`, `--on`, `--lane` ([Placement grammar](reference.md#placement-grammar)).
- `--flow-name`, `--flow-id`, `--condition`, `--language` and `--default` describe the flow into the new
  node; `bpmn set <file> <flowId>` changes it later.
- The id comes from the name (`userTask_checkInvoice`). `--id` with `--if-absent` makes the add idempotent.
- Lanes, data and annotations take `--in` only; wire them afterwards with `connect`.
- A group takes no placement: `--members <ids...>` names what it is drawn around.
- The first `participant` wraps the existing process. `--black-box` creates an empty pool and never
  wraps, so add a normal participant first.

## `connect`

```sh
bpmn connect order.bpmn gateway_invoiceOk serviceTask_bookInvoice name=yes
```

The endpoints decide the kind: sequence flow, message flow (different pools), association
(annotation) or data association. What the flow holds is a key: `name=`, `condition=`, `language=`,
`default=true`, and `message=` on a message flow. A second outgoing flow from a node that is no gateway
warns `W_IMPLICIT_SPLIT`.

## `set`

```sh
bpmn set order.bpmn userTask_checkInvoice name="Check the invoice" \
  camunda:asyncBefore=true
bpmn set order.bpmn userTask_clarifyInvoice \
  'loop.camunda:collection=${invoices}'
```

`key=` removes a property. `id=<newId>` renames and re-points every reference. Parts without an id take
a prefix: `definition.`, `loop.`, `condition.`. In a Camunda 8 file most settings are extension
elements, written with `ext add`. An unknown key answers `E_UNKNOWN_KEY` with the keys the element takes.

## `remove`

Removes elements with everything that depends on them, then bridges the gap.

| situation | what happens |
| --- | --- |
| one flow in, one out | predecessor connected to successor; `--bridge none` leaves the gap |
| a merge that does not synchronise | bridged from every predecessor |
| a parallel or inclusive join | refused (`E_AMBIGUOUS_BRIDGE`): choose `--bridge all` or `--bridge none` |
| `--with-branch` | also removes the path only this node leads to |

`--if-exists` skips unknown ids, so a batch can run twice.

## `retype`

Changes the kind within a family and keeps id, name, flows, boundary events and lane.

```sh
bpmn retype order.bpmn startEvent_orderReceived startEvent:message message=OrderReceived
```

A kind without trigger keeps the current trigger. To drop it, write `retype startEvent_orderReceived startEvent:none`.
A sub-process with content becomes a task only with `--force`.

## `move` and `order`

`move` detaches nodes, bridges the gap like `remove`, and places them again with the flags of
`add`. `--lane` moves them into a lane, an empty value out of it. `order` sets the order of a node's
outgoing flows, a pool's lanes or a collaboration's pools.

```sh
bpmn move order.bpmn userTask_clarifyInvoice --before serviceTask_bookInvoice
bpmn order order.bpmn gateway_invoiceOk flow_invoiceOkToClarifyInvoice \
  flow_invoiceOkToBookInvoice
```

The flow order drives the picture: the default flow (else the first) continues straight, the others
go alternately below and above it. To pin a branch as the continuation, make it the default.

## `ext`

Writes vendor extension elements. `show <id>` reads them, numbered. The sub-command comes first, and
each `key=value` is an attribute of the element; `body=` is its text.

```console
$ bpmn ext add order.bpmn serviceTask_bookInvoice camunda:inputParameter name=amount 'body=${order.total}'
$ bpmn show order.bpmn serviceTask_bookInvoice
serviceTask serviceTask_bookInvoice "Book invoice"
...
ext 0: camunda:inputOutput  in amount=${order.total}
...
$ bpmn ext remove order.bpmn serviceTask_bookInvoice 'camunda:inputParameter[name=amount]'
```

Containers such as `camunda:inputOutput` are created and removed for you. `--xml` takes a raw snippet
with nested elements, `--replace` replaces instead of merging. Quote selectors: `[` and `]` are glob
characters in zsh.

## `apply`

Runs a JSON list of operations as one transaction: all or nothing, one layout pass. `"as": "$name"`
names what an operation creates. See [Operations](ops.md).

```json [ops.json]
[
  { "op": "add", "kind": "userTask", "name": "Ship order",
    "after": "serviceTask_bookInvoice", "as": "$ship" },
  { "op": "set", "id": "$ship", "set": { "camunda:assignee": "piggy" } }
]
```

```sh
bpmn apply order.bpmn ops.json
```

## `validate`

Checks a file without writing: structure, the engine rules of its platform, the project's bpmnlint and
a layout dry run.

| result | exit code |
| --- | --- |
| `valid, 2 warning(s)` | 0, or 5 under `--strict` |
| `1 error(s), 2 warning(s)` | 2 |

A `W_C7_DEPLOY_*` or `W_C8_DEPLOY_*` warning means the engine refuses the file. A bpmnlint error
fails the check ([bpmnlint](bpmnlint.md)). A write reports only what it touched and counts the rest in
its state line; `validate` lists everything.

## `layout`

Redraws the whole diagram from the model; colours and DI ids survive. It ends a model built from scratch
over several writes, and it is the way out when `E_LAYOUT_INCREMENTAL` says a change found no place.
`bpmn tidy` only removes overlaps ([Layout and formatting](layout.md)).

## `render`

Draws a diagram as PNG or SVG, by the extension of `-o`, without a browser, so you or an agent can look
at it.

```console
$ bpmn render order.bpmn --around gateway_invoiceOk --depth 1 --problems -o ok.svg
wrote ok.svg  490x265 px  ~166 image tokens  scale 1.00  plane collaboration_orderHandling
crop: around gateway_invoiceOk (depth 1): 7 elements
problems (numbered in the image):
  1 crossings [flow_invoiceOkToBookInvoice, messageFlow_askCustomerToCustomer]
  2 labelOnLine [flow_invoiceOkToBookInvoice, messageFlow_askCustomerToCustomer]
```

<figure class="diagram">
  <img src="/shots/commands-render-problems.svg" alt="A crop around the gateway Invoice ok? with the customer pool above it; the crossing of the message flow and the yes flow is numbered" />
  <figcaption><code>render --around ... --problems</code>: the problems of <code>bpmn diagram</code>, numbered</figcaption>
</figure>

Ids crop to these elements, and an id of a collapsed sub-process picks its plane. On a large model
render a crop (`<ids>`, `--around`, `--path <from> <to>`): the whole plane is scaled down until labels
are unreadable.

## `guide`

`guide` prints the core of the help, `guide <topics...>` the named topics, from `contract` to
`exit-codes`; the core ends with the list. The tables of kinds, keys and codes are written from the code.

## Next steps

- [Operations](ops.md): many changes in one batch.
- [Layout and formatting](layout.md): how the drawing is kept, and the draw commands.
- [Syntax and output](reference.md): every kind, trigger and key.
