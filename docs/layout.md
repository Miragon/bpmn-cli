# Layout

bpmn-cli draws the diagram for you. You change the picture by naming elements, never coordinates.

## How a write draws

- **A drawing is kept.** Untouched shapes and lines stay where they are; a new element goes next to
  its neighbours, and only what follows it moves right to make room. A drawing someone formatted by
  hand stays as it is.
- **An empty drawing is drawn in full**, as is a file without one.
- **`bpmn layout` redraws everything.** Colours and DI ids stay, positions do not. Use it to finish a
  model built from scratch over several writes, or when a change answers `E_LAYOUT_INCREMENTAL`
  (no room found; nothing was written). In a batch, a `layout` operation at the end does the same.

Every write prints the layout score before and after. Lower is better, 0 means no crossings, overlaps
or labels on lines. `bpmn diagram <file>` lists the problems with their ids, and
`bpmn render <file> --problems -o out.svg` numbers them in the picture.

<figure class="diagram">
  <img src="/shots/layout-modes-incremental.svg" alt="The order process with the customer pool on top and a new task Approve invoice placed between Check invoice and the gateway; the drawing is otherwise the same" />
  <figcaption><code>add ... --after userTask_checkInvoice</code>: the drawing is kept and room is made</figcaption>
</figure>

<figure class="diagram">
  <img src="/shots/layout-modes-full.svg" alt="The same process redrawn by the engine: the customer pool moved below, the yes branch on the top row" />
  <figcaption>The same after <code>bpmn layout</code>: redrawn in the engine's own order</figcaption>
</figure>

## Fix a spot

These commands change only the drawing. In a batch they come after the model operations.

| command | effect |
| --- | --- |
| `place <ids...> --row-of\|--below\|--above <id>` and/or `--column-of\|--after\|--before <id>` | move shapes as a group onto another element's row or column |
| `place <boundaryEventId> --side top\|bottom` | move a boundary event to the other border |
| `color <ids...> --color blue\|orange\|green\|red\|purple\|default` | colour shapes; `default` removes it |
| `label <id> --side above\|below\|left\|right` | move a label |
| `route <flowId> [--exit <side>] [--entry <side>]` | route one flow again |
| `space --after\|--below <id> [--by column\|row\|<n>col\|<px>]` | make room; a negative amount closes it |
| `tidy [<ids...>]` | remove overlaps with minimal moves |
| `compact [<frameIds...>]` | close empty rows and columns, shrink frames to their content |
| `order <id> <ids...>` | order a gateway's branches, a pool's lanes or the pools |

`place` and `color` also take `--path <fromId> <toId>` (the nodes on the shortest path) or
`--branch <flowId>` (what only that branch reaches) instead of ids. A shape never leaves its lane or
pool (`E_LEAVES_CONTAINER`: `move <id> --lane <laneId>` first). When there is no room, `E_NO_ROOM`
carries the `bpmn space` command that makes it.

### Example: resolve a crossing

```console
$ bpmn diagram order.bpmn
score 6: crossings 1, labelOnLine 1
  crossings    flow_invoiceOkToBookInvoice x messageFlow_askCustomerToCustomer
  labelOnLine  flow_invoiceOkToBookInvoice, messageFlow_askCustomerToCustomer
participant participant_customer "Customer"  c0..c5
participant participant_orderHandling "Order handling"  c0..c5   row 1: c0 startEvent_orderReceived, c1 userTask_checkInvoice, c2 gateway_invoiceOk, c3 serviceTask_bookInvoice, c4 gateway_invoiceOkJoin, c5 endEvent_invoiceHandled
                                                                 row 2: c3 sendTask_askCustomer
$ bpmn place order.bpmn sendTask_askCustomer --row-of userTask_checkInvoice
...
layout quality: score 6 -> 0; resolved: crossings flow_invoiceOkToBookInvoice x messageFlow_askCustomerToCustomer, labelOnLine flow_invoiceOkToBookInvoice x messageFlow_askCustomerToCustomer
written: order.bpmn
```

<figure class="diagram">
  <img src="/shots/layout-place-before.svg" alt="Before: the message flow from Ask customer up to the Customer pool crosses the yes flow; the two problems are numbered 1 and 2" />
  <figcaption>Before, <code>render --problems</code>: score 6</figcaption>
</figure>

<figure class="diagram">
  <img src="/shots/layout-place-after.svg" alt="After: Ask customer sits on the top row, its message flow rises straight to the Customer pool, Book invoice is on the row below" />
  <figcaption>After <code>place ... --row-of userTask_checkInvoice</code>: score 0</figcaption>
</figure>

## What the engine draws

So you can predict the picture from the model:

- Left to right. At a split the default flow runs straight on, else the first flow; the other branches
  go alternately below and above it. `bpmn order` changes the order, `set <flowId> default=true`
  picks the straight one.
- Boundary events sit on the host's bottom border first, their path below. Loops run underneath.
- Sub-processes are expanded and laid out inside; event sub-processes go below the content.
- Annotations go above their element, data below. Pools stack vertically, message flows run between
  them.
- Gateway names sit above, event names below, flow names above the flow.
- A new shape gets the bpmn-js size (task 100 by 80, gateway 50 by 50, event 36 by 36); a long name
  wraps inside it.
