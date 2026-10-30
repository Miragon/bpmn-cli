# Layout and formatting

How bpmn-cli keeps the diagram up to date, and how to change the picture by naming elements instead
of coordinates.

::: tip From the CLI
`bpmn guide layout` and `bpmn guide format` print the short form of this page,
`bpmn <command> --help` every option.
:::

## Layout modes

Every write updates the diagram. `--layout <mode>` says how; `--relayout` is `--layout full`,
`--no-layout` skips it.

| mode | what happens |
| --- | --- |
| `auto` (default) | `full` for a drawing the engine made, `incremental` for one made or changed by hand |
| `incremental` | untouched shapes and lines stay; new elements go next to their neighbours and room is made |
| `full` | the engine redraws everything; colours and DI ids are kept, positions are not |

So a drawing you formatted by hand, here or in a modeler, stays as it is. A format command that moves
a shape or reroutes a flow makes the drawing hand-made, so your formatting persists.

Room is made only where it is needed: what follows the new element moves right, with what it would
run into on the way, and by no more than the room that is missing. Another row of the diagram keeps
its place, so a task added to a rejection path leaves the main path above it alone. A new flow that
would enter an element left of its source (not a loop return) moves that element and what follows it
right of the source. If an
incremental update fails, `auto` falls back to a full redraw (`W_LAYOUT_INCREMENTAL_FAILED`).

<figure class="diagram">
  <img src="/shots/layout-modes-incremental.svg" alt="The order process with the customer pool on top and a new task Approve invoice placed between Check invoice and the gateway; the shapes that made room have blue halos" />
  <figcaption><code>add ... --after userTask_checkInvoice</code>: incremental, the drawing is kept and room is made (blue: moved)</figcaption>
</figure>

<figure class="diagram">
  <img src="/shots/layout-modes-full.svg" alt="The same process redrawn by the engine: the customer pool moved below, the yes branch on the top row" />
  <figcaption>The same with <code>--layout full</code>: the engine redraws, pools and branches in its own order</figcaption>
</figure>

Every write reports which mode ran, what moved, and the layout score before and after
(`bpmn metrics` measures the same).

## Formatting without XML

Format commands change only the drawing and name elements, never coordinates. In an `apply` batch
they run in batch order, each after the layout of the model ops before it, all or nothing: a model
op after a format op keeps what the format op drew.

| command | effect |
| --- | --- |
| `place <id...> --row-of\|--below\|--above <id>` and/or `--column-of\|--after\|--before <id>` | move shapes as one group onto another element's row or column |
| `place <boundaryEventId> --side top\|bottom` | move a boundary event to the top or bottom of its host |
| `align <id...> --axis row\|column [--to <id>]` | put shapes on one centre line |
| `color <id...> --color blue\|orange\|green\|red\|purple\|default` | the bpmn-js colours; `default` removes them |
| `label <id> --side above\|below\|left\|right` | move the label of an event, gateway, data element or flow |
| `route <flowId> [--exit <side>] [--entry <side>]` | route one flow again, optionally forcing its sides |
| `space --after\|--below <id> [--by column\|row\|<n>col\|<px>]` | the space tool; a negative amount closes space |
| `tidy [<id>...]` | remove overlaps with minimal moves |
| `compact [<frameId>...]` | close empty rows and columns, shrink frames to their content |
| `order <poolId\|laneId> <laneId...>` / `order <collaborationId> <participantId...>` | lanes or pools top to bottom |

Instead of ids, `place`, `align`, `color` and `tidy` take selectors:

| selector | names |
| --- | --- |
| `--path <fromId> <toId> [--via <flowId...>]` | every node on the shortest path; `--via` picks a branch |
| `--kind <kind>` | every element of a kind, such as `userTask` or `startEvent:message` |
| `--branch <flowId>` | what only that branch reaches, up to its join |

A node never leaves its lane, pool or sub-process (`E_LEAVES_CONTAINER`):
run `move <id> --lane <laneId>` first. When shapes cannot give way, the command refuses with `E_NO_ROOM`, and the error
carries the `bpmn space ...` command that makes the room.

### Example: resolve a crossing with `place`

On the model of the [worked session](walkthrough.md), the customer pool sits on top and a message
flow crosses the yes branch:

```console
$ bpmn show order.bpmn --layout
diagram BPMNPlane_collaboration_orderHandling (collaboration_orderHandling)
  columns: c0..c5
  participant participant_customer "Customer"
  participant participant_orderHandling "Order handling"
    row 1: c0 startEvent_orderReceived, c1 userTask_checkInvoice, c2 gateway_invoiceOk, c3 serviceTask_bookInvoice, c4 gateway_invoiceOkJoin, c5 endEvent_invoiceHandled
    row 2: c3 sendTask_askCustomer
layout quality: score 6: crossings 1, labelOnLine 1
  crossings [flow_invoiceOkToBookInvoice, messageFlow_askCustomerToCustomer]
  labelOnLine [flow_invoiceOkToBookInvoice, messageFlow_askCustomerToCustomer]

$ bpmn place order.bpmn sendTask_askCustomer --row-of userTask_checkInvoice
layout: ok - incremental (format operations only: drawing kept)
  format place #0: moved serviceTask_bookInvoice, sendTask_askCustomer; rerouted flow_bookInvoiceToInvoiceOkJoin, flow_invoiceOkToBookInvoice, flow_askCustomerToInvoiceOkJoin, flow_invoiceOkToAskCustomer, messageFlow_askCustomerToCustomer
layout quality: score 6 -> 0; resolved: crossings [flow_invoiceOkToBookInvoice, messageFlow_askCustomerToCustomer], labelOnLine [flow_invoiceOkToBookInvoice, messageFlow_askCustomerToCustomer]
written: order.bpmn
```

<figure class="diagram">
  <img src="/shots/layout-place-before.svg" alt="Before: the message flow from Ask customer up to the Customer pool crosses the yes flow; the two problems are numbered 1 and 2" />
  <figcaption>Before, <code>render --problems</code>: score 6, the problems numbered</figcaption>
</figure>

<figure class="diagram">
  <img src="/shots/layout-place-after.svg" alt="After: Ask customer sits on the top row, its message flow rises straight to the Customer pool, Book invoice is on the row below" />
  <figcaption>After <code>place ... --row-of userTask_checkInvoice</code>: score 0</figcaption>
</figure>

## Layout conventions of the built-in engine

The built-in engine draws every diagram the same way, so you can predict the picture from the
model.

| element | where it goes |
| --- | --- |
| direction | left to right |
| branches | the happy path straight on the top row, other branches in bands below, in flow order (`bpmn order` changes it) |
| boundary events | on the host's bottom border, the handler path below |
| loops | underneath the elements they span, entering from below |
| joins | entries from below share the bottom vertex and rise straight into it |
| sub-processes | laid out recursively, expanded by default; event sub-processes below the content |
| annotations, data | annotations above their element (beside a data object, under a flow when the spot above would reach over its lane's top border), data below; the lines of notes on one element join, and a note's line stays in the lane both its ends lie in unless that costs a long detour |
| pools | stacked vertically; message flows run vertically in the gap between pools |
| labels | gateway names above, event names below, flow names above their longest horizontal segment |

A label that would land on a shape or line moves to the nearest free spot.

## Next steps

- [Commands](commands.md#render): `render` and `metrics`, to look at the result and measure it.
- [Ops JSON](ops.md): format ops in a batch.
- [Guarantees and limits](contract.md): what a write changes and what it leaves alone.
