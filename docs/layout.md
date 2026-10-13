# Layout and formatting

Every mutating command keeps the diagram up to date, and the format commands change the picture
by naming elements, never coordinates. `bpmn guide layout` and `bpmn guide format` print the
short form of this page, `bpmn <command> --help` lists every option.

## Layout modes

| `--layout <mode>` | what happens (`--relayout` is `--layout full`, `--no-layout` skips the layout) |
| --- | --- |
| `auto` (default) | A file without a diagram is drawn from scratch. A drawing the engine made and nobody changed since is redrawn in full (re-running the engine on the model as it was before the command reproduces every shape, label and connection within 2 px; flow nodes added with `--no-layout` are left out of that check). Any other drawing, made in a modeler or changed by a format command that moved a shape, rerouted a flow or moved a label, is kept: `incremental`. |
| `incremental` | Untouched shapes keep their exact bounds, untouched connections their waypoints. New elements are placed next to their neighbours (a splice between predecessor and successor, a new branch one row below the existing branches, a boundary event on the host's bottom border). Room is made like the modeler's space tool: what lies right of or below the spot moves, the pools, lanes and sub-processes holding it grow. DI of removed elements is pruned and an empty column closed. A lane change moves the node into its new lane, an activity whose new name does not fit grows (wider up to 200 px, then higher, never smaller), and only the connections that need it are rerouted. A batch places its new nodes like the same ops sent one by one: a chain of new nodes spliced into one flow stays in its row also when one of them branches, and the exception path of a new boundary event waits for the new nodes of the normal flow. A new flow that would enter a merge gateway backwards places the merge again right of its rightmost source. The row of a new branch or boundary path is chosen so that it crosses no existing line: when every free row below would cross one, the row right under the anchor is opened or the branch goes above its anchor (a boundary path above its host, with the event on the host's top border; an event drawn by hand keeps its border). A crossing left between a new and an existing connection is repaired once more (at most 8 trials per write): the new connection is routed again, else the existing one around the new shapes, else the branch starts at its next row. A trial is kept only when it lowers the score and adds neither a hard layout problem nor a crossing between two connections drawn before the write; an existing connection kept rerouted is listed in `rerouted`. A line that runs along the border of a node placed at the end of a chain is routed again. If it fails, `auto` falls back to a full redraw (`W_LAYOUT_INCREMENTAL_FAILED`); an explicit `--layout incremental` fails with `E_LAYOUT_INCREMENTAL`. |
| `full` | Redraw everything with the engine (`--engine clean`, the default, or `auto`). Colours and DI ids are carried over by element id, positions are not; group boxes are drawn again around the elements they held. `bpmn layout <file>` always does this. |

The result says which mode ran and why, lists what was placed, moved, rerouted and pruned, and
compares the layout quality before and after (`bpmn metrics` measures the same). A format command
that changes the geometry makes the drawing hand-made, so formatting persists: the next `add` in
`auto` mode keeps it. A `color` alone does not change the geometry.

## Formatting without XML

The format commands change only the diagram (`order` also reorders the lanes or pools in the
model) and name other elements instead of coordinates. A file without a diagram is drawn first
(with `--no-layout`: `E_NO_DIAGRAM`). In an `apply` batch they are ops that run after the semantic
ops and the layout, in batch order, all or nothing.

| command / op | effect |
| --- | --- |
| `place <id...>` with `--row-of` / `--below` / `--above <id>` and/or `--column-of` / `--after` / `--before <id>` | Moves the shapes as one rigid group so that the first lands on the row and/or column of the reference; `below` / `above` keep one row of the drawing, `after` / `before` one gap. Boundary events, labels and the content of an expanded sub-process follow; shapes in the way give way, frames grow, flows are rerouted. |
| `place <boundaryEventId> --side top\|bottom` | Moves a boundary event to the top / bottom border of its host, at the free spot nearest its column. Its outgoing flows are routed again and its exception path follows, mirrored about the host's centre row; room is made at the top of the frame when needed. Only the boundary event, no row or column. |
| `align <id...> --axis row\|column [--to <id>]` | Puts the shapes on one centre line, that of `--to` (default: the first id; with only `--kind` and `--axis column` the rightmost one, so nothing moves left). Shapes that would land on each other give way along the free axis. |
| `color <id...> --color blue\|orange\|green\|red\|purple\|default` | The bpmn-js colour picker colours on shapes, connections and labels (`bioc:` and `color:` attributes); `default` removes them. |
| `label <id> --side above\|below\|left\|right` | Puts the external label of an event, gateway, data object / store or flow on that side (a flow: of its longest segment), off lines and other labels where possible. |
| `route <flowId> [--exit <side>] [--entry <side>]` | Routes one sequence or message flow again, optionally forcing the sides it leaves and enters by (`--exit bottom --entry bottom` draws a loop below). |
| `space --after <id> \| --below <id> [--by column\|row\|<n>col\|<n>row\|<px>]` | The space tool: everything right of (within the element's pool) or below the element moves by one column / row, `<n>` of them, or pixels (`--by 2` is 2 px, `--by 2col` two columns); the frames holding the element grow. On a lane or pool it makes that frame wider / taller. A negative amount (`-column`, `-row`, `-<px>`) closes up to that much empty space instead, and fails with `E_NO_ROOM` when closing would add a layout problem. |
| `tidy [<id>...]` (also `bpmn layout --tidy`) | Removes overlaps and gaps < 20 px with minimal moves, keeping the reading order (nothing moves left); default: every shape. |
| `compact [<poolId\|laneId\|subProcessId>...]` | Closes the empty rows and columns and shrinks the frames to their content, keeping order and relative positions: expanded sub-processes first, then the columns of each pool, the rows of each lane, the rows between pools. Frames keep 30 px of padding (45 above the content of a sub-process), an empty lane 120 px. A strip is closed only when that adds no hard layout problem and does not raise the score (a note names what closing it would have added). With ids: only those frames. |
| `order <poolId\|processId\|laneId> <laneId...>` | Lanes top to bottom; the bands move with their content. |
| `order <collaborationId> <participantId...>` | Pools top to bottom (black boxes too); message flows are routed again. |

Selectors on `place`, `align`, `color` and `tidy` add to the ids given (ops JSON keys: `path`,
`via`, `kind`, `branch`):

| selector | names |
| --- | --- |
| `--path <fromId> <toId> [--via <flowId...>]` | every node (for `color` also every flow) on the shortest sequence-flow path; on ties the default flow first, then the declaration order. `--via` flows must be on it, in order, and pick a branch. |
| `--kind <kind>` | every element of a kind, in the grammar of `find --kind` (`endEvent`, `userTask`, `startEvent:message`, `sequenceFlow`) |
| `--branch <flowId>` | what only that flow's branch reaches, up to the join or a loop back; for `color` with the flows. `place --branch <flowId> --below <id>` moves the branch as one group. |

A refused format command writes nothing. A node never leaves its lane, pool or expanded
sub-process (`E_LEAVES_CONTAINER`: `move <id> --lane <laneId>` first, or `space --below <laneId>`);
`align` leaves out, with a note, a member that only a selector named. `E_NO_ROOM`: the shapes in
the way cannot give way without moving the reference or pushing a shape out of its frame. The
refusal of `place` / `align` carries a checked space-tool run that makes the room: as a batch op
(`details.ops`) and, when the refused op saw the file's own drawing, as a command line
(`details.command`, for example `bpmn space <file> --after Gateway_1hd8x2m --by 2col`). `place
--side` refuses with `E_NO_ROOM` when boundary events and docking connections take the whole border. Also `E_NO_MATCH` (a selector names nothing), `E_NO_SHAPE` (for a pool use the participant
id), `E_DIFFERENT_DIAGRAM` (a reference inside a collapsed sub-process), `E_WRONG_KIND` and
`E_NO_LABEL` (`label` on a task, on an unnamed element).

Read the drawing with `show --layout`, change it, and check the quality line. On the model of the
[worked session](walkthrough.md), `bpmn order order.bpmn Collaboration_OrderHandling
Participant_Customer` puts the customer pool on top and adds a crossing (`...`: output left out):

```
$ bpmn show order.bpmn --layout
diagram BPMNPlane_Collaboration_OrderHandling (Collaboration_OrderHandling)
  columns: c0..c5
  participant Participant_Customer "Customer"
  participant Participant_OrderHandling "Order handling"
    row 1: c0 Event_OrderReceived, c1 Activity_CheckInvoice, c2 Gateway_InvoiceOk, c3 Activity_BookInvoice, c4 Gateway_InvoiceOk_join, c5 Event_InvoiceHandled
    row 2: c3 Activity_AskCustomer
layout quality: score 6: crossings 1, labelOnLine 1
  crossings [Flow_InvoiceOkToBookInvoice, Flow_AskCustomerToCustomer]
  labelOnLine [Flow_InvoiceOkToBookInvoice, Flow_AskCustomerToCustomer]

$ bpmn place order.bpmn Activity_AskCustomer --row-of Activity_CheckInvoice
layout: ok - incremental (format operations only: drawing kept)
  format place #0: moved Activity_BookInvoice, Activity_AskCustomer; rerouted Flow_BookInvoiceToInvoiceOkJoin, Flow_InvoiceOkToBookInvoice, Flow_AskCustomerToInvoiceOkJoin, Flow_InvoiceOkToAskCustomer, Flow_AskCustomerToCustomer
layout quality: score 6 -> 2; added: segmentOverlap [Flow_BookInvoiceToInvoiceOkJoin, Flow_AskCustomerToInvoiceOkJoin, Gateway_InvoiceOk_join] 30px; resolved: crossings [Flow_InvoiceOkToBookInvoice, Flow_AskCustomerToCustomer], labelOnLine [Flow_InvoiceOkToBookInvoice, Flow_AskCustomerToCustomer]
written: order.bpmn
```

`bpmn route order.bpmn Flow_BookInvoiceToInvoiceOkJoin` then routes that flow again and resolves
the overlap (`score 2 -> 0`). `bpmn render <file> --problems -o <f.png>` draws the problems
numbered on the picture (`bpmn guide render`); `--json` reports each format op in `layout.format`
and the measurement in `layout.metrics`.

## Layout conventions of the built-in engine

The default engine (`--engine clean`) draws every diagram the same way, so the picture can be
predicted from the model. `bpmn validate` runs it as a dry run; elements it could not draw are
reported as `W_LAYOUT_DI_NOT_CREATED`.

- Left to right. The happy path (the branch that reaches farthest) is a straight line on the top
  row; the other branches of a split are bands below it, in declaration order (`bpmn order`
  changes it). A band is reused when its column range is free.
- Boundary events sit on the host's bottom border, labels to their right; handler paths and
  compensation handlers hang below. Loops run underneath the elements they span and enter their
  target from below (over the top only when that avoids a crossing), as do flows into a join.
- Sub-processes are laid out recursively, expanded by default, on their own plane when collapsed.
  Event sub-processes sit below the content of their lane (without lanes: below the main content).
- Text annotations go above their element, data objects and stores below; annotations of the
  collaboration go beside a pool or into the gap between pools for a message flow. Associations
  are routed orthogonally around shapes, or straight when that line is free.
- A group box is drawn again around the elements it held, 20 px around them and 40 above for its
  name; the padding stops half-way to a neighbour, but members the redraw spread apart can still
  overlap one that lies between them. A group around nothing keeps its box, or its size below the
  drawing when the redraw put shapes on it (both engines, [contract](contract.md#limitations)).
  Parts of a process that no flow connects go below one another in declared order, except that
  the parts of one group stay together (a part belongs to the group of the first of its nodes a
  box held).
- Pools stack vertically in the declared order, unless another order lets fewer message flows cut
  through shapes (up to six pools). Lanes are horizontal bands that fill their pool. Message flows
  leave and enter vertically, run in the gap between two pools, and around the right of all pools
  when another pool lies between them.
- Gateway names go above the gateway, event names below, flow names above the longest horizontal
  segment near its start. A label that would land on a shape, label or line moves to a free spot.
