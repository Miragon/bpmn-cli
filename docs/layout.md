# Layout and formatting

Every mutating command keeps the diagram up to date, and the format commands change the picture
by naming elements, never coordinates. `bpmn guide layout` and `bpmn guide format` print the
short form of this page, `bpmn <command> --help` lists every option.

## Layout modes

| `--layout <mode>` | what happens (`--relayout` is `--layout full`, `--no-layout` skips the layout) |
| --- | --- |
| `auto` (default) | A file without a diagram is drawn from scratch. A drawing the engine made and nobody changed since is redrawn in full (re-running the engine on the model as it was before the command reproduces every shape, label and connection within 2 px; flow nodes added with `--no-layout` are left out of that check). Any other drawing, made in a modeler or changed by a format command that moved a shape, rerouted a flow or moved a label, is kept: `incremental`. |
| `incremental` | Untouched shapes keep their exact bounds, untouched connections their waypoints. New elements are placed next to their neighbours (a splice between predecessor and successor, a new branch one row below the existing branches, a boundary event on the host's bottom border). Room is made like the modeler's space tool: what lies right of or below the spot moves, the pools, lanes and sub-processes holding it grow. DI of removed elements is pruned and an empty column closed. A kept line that does not reach its ends (more than 10 px outside its end's shape: left at an old place by an older `--no-layout` write or by another tool) is routed again, listed in `rerouted` with a note (not on a plane with vertical pools or lanes, where nothing is routed); the format commands that change the geometry do the same. A lane change moves the node into its new lane, an activity whose new name does not fit grows (wider up to 200 px, then higher, never smaller), an expanded sub-process whose new name takes more lines than the old one and reaches down to its content (what is drawn inside it, not a message flow's label above it) makes room below the name (the content moves down, by at most the lines the name gained, the sub-process grows), and only the connections that need it are rerouted. A routed flow docks on a vertex of a gateway, a free one where it can (it touches a gateway it enters at no other vertex), except that a join's entries from below share its bottom vertex (from above: its top vertex) and a new one follows the others' common way into it (rising beside the join and hooking in, say), as bpmn-js draws them, unless the way to the shared vertex crosses more lines than the way to a free one. A label goes inside its frame where there is a free spot and is never placed onto the name of an expanded sub-process; one that making room or a wider new name brought onto such a name (the name is centred: it moves by half the width a sub-process gains) is placed again inside its sub-process, or stays where it is when no spot there is free; a frame grows around a new shape and its label, a new node in a row keeps its label clear of its neighbours' labels, and a new gateway at the top of a sub-process gets room below the name for its label. A batch places its new nodes like the same ops sent one by one: a chain of new nodes spliced into one flow stays in its row also when one of them branches, and the exception path of a new boundary event waits for the new nodes of the normal flow. A new flow that would enter a merge gateway backwards places the merge again right of its rightmost source. The row of a new branch or boundary path is chosen so that it crosses no existing line: when every free row below would cross one, the row right under the anchor is opened or the branch goes above its anchor (a boundary path above its host, with the event on the host's top border; an event drawn by hand keeps its border). A crossing left between a new and an existing connection is repaired once more (at most 8 trials per write): the new connection is routed again, else the existing one around the new shapes, else the branch starts at its next row. A trial is kept only when it lowers the score and adds neither a hard layout problem nor a crossing between two connections drawn before the write; an existing connection kept rerouted is listed in `rerouted`. A line that runs along the border of a node placed at the end of a chain is routed again. If it fails, `auto` falls back to a full redraw (`W_LAYOUT_INCREMENTAL_FAILED`); an explicit `--layout incremental` fails with `E_LAYOUT_INCREMENTAL`. |
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
| `label <id> --side above\|below\|left\|right` | Puts the external label of an event, gateway, data object / store or flow on that side: a shape's label off lines, other labels and the name of an expanded sub-process where possible, inside its frame first; a flow's label at the middle of its longest segment on that side, unchecked. Above a shape at the top of an expanded sub-process, whose name leaves no room there, the sub-process makes room below the name first (its content moves down, it grows; a note says so). |
| `route <flowId> [--exit <side>] [--entry <side>]` | Routes one sequence or message flow again, optionally forcing the sides it leaves and enters by (`--exit bottom --entry bottom` draws a loop below). A flow without a line whose two ends are drawn (added, or its ends changed, with `--no-layout`) gets one. |
| `space --after <id> \| --below <id> [--by column\|row\|<n>col\|<n>row\|<px>]` | The space tool: everything right of (within the element's pool) or below the element moves by one column / row, `<n>` of them, or pixels (`--by 2` is 2 px, `--by 2col` two columns); the frames holding the element grow. On a lane or pool it makes that frame wider / taller. A negative amount (`-column`, `-row`, `-<px>`) closes up to that much empty space instead, and fails with `E_NO_ROOM` when closing would add a layout problem. A label the command brings onto the name of an expanded sub-process (one that got wider: its centred name moves by half as much) is placed again inside its sub-process, or stays where it is when no spot there is free, as after every format command that moves shapes. |
| `tidy [<id>...]` (also `bpmn layout --tidy`) | Removes overlaps and gaps < 20 px with minimal moves, keeping the reading order (nothing moves left); default: every shape. |
| `compact [<poolId\|laneId\|subProcessId>...]` | Closes the empty rows and columns and shrinks the frames to their content, keeping order and relative positions: expanded sub-processes first, then the columns of each pool, the rows of each lane, the rows between pools. Frames keep 30 px of padding (45 above the content of a sub-process, more under a name of three lines or more), an empty lane 120 px. A strip is closed only when that adds no hard layout problem and does not raise the score (a note names what closing it would have added). With ids: only those frames. |
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
id; a flow without a line: `route` draws it), `E_DIFFERENT_DIAGRAM` (a reference inside a collapsed sub-process), `E_WRONG_KIND` and
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
layout quality: score 6 -> 0; resolved: crossings [Flow_InvoiceOkToBookInvoice, Flow_AskCustomerToCustomer], labelOnLine [Flow_InvoiceOkToBookInvoice, Flow_AskCustomerToCustomer]
written: order.bpmn
```

Ask customer now sits on the top row, and the flow of Book invoice, on the row below, rises into
the bottom vertex of the join. A join takes its entries from below through that one vertex, as
bpmn-js draws it, and `metrics` does not count their common run as an overlap.
`bpmn render <file> --problems -o <f.png>` draws the problems numbered on the picture
(`bpmn guide render`); `--json` reports each format op in `layout.format` and the measurement in
`layout.metrics`.

## Layout conventions of the built-in engine

The default engine (`--engine clean`) draws every diagram the same way, so the picture can be
predicted from the model. `bpmn validate` runs it as a dry run; elements it could not draw are
reported as `W_LAYOUT_DI_NOT_CREATED`.

- Left to right. The happy path (the branch that reaches farthest) is a straight line on the top
  row; the other branches of a split are bands below it, in declaration order (`bpmn order`
  changes it). A band is reused when its column range is free. An empty branch (a flow from the
  split straight to its join) gets a band too, unless the row between split and join is free: in
  a pool with lanes the other branches can run in other lanes, and then it is drawn straight from
  the split's right vertex into the join's left vertex (when no shape, label or other line is on
  that row and it crosses no more lines than the band).
- Boundary events sit on the host's bottom border, labels to their right; handler paths and
  compensation handlers hang below. A boundary event's flow to a target above it (its handler in a
  lane above, a node on a row above) leaves the event downwards, runs at least 15 px below the
  shapes and labels of the host's row (the event's own label included), or below everything between
  the two in the host's lane where that crosses fewer lines or labels, and rises straight into the
  target's bottom (see below), else into its left side from the column gap before it, else with a
  hook; the host's lane grows to keep that run 15 px from its border. Where host and target share
  a lane (or there are no lanes) and every such way crosses more lines than the way over the top
  (a shape it cuts counts as one; a label it runs through does not: the label moves off it), the
  flow goes over the top instead: down out of the event, a short run into the column gap beside
  the host (not under another of its events), up past the host's row, along a run 15 px above the
  shapes and labels it passes, and down into the target's top (a gateway's top vertex); the lane,
  pool or sub-process grows to hold that run and the flow's label, and loops keep off it. Such an
  event (also one whose way would go over the top from there) sits on its host's top border instead
  where that draws better: its flow leaves it straight up to the run (15 px above the shapes and
  labels it passes, its own label included), along, and down into the target's top or into its left
  side from the column gap before it; the event sits at the right end of the top border (of two,
  the one with the nearer target on the right, so their ways nest), its label above the host to the
  upper right of the event (to the upper left where that is taken, and for the second of two). The
  drawing is routed both ways, and the top border is kept only with fewer crossings, lines through
  shapes or lines through labels, or as many and a shorter way with fewer bends, with the event and
  its label clear of the other lines and labels and no straight line or straight rise lost. The
  host's other events keep their places; an event with data or a note, a compensation event and the
  end of a message flow stay on the bottom border. A handler
  below that a straight drop cannot reach is entered through such a run below the host's row: down
  to it, right into the column gap after the host, down, right. Neither runs along the host's
  bottom border, unless every such way cuts a shape (a data object hanging right under the event).
  Where that run cuts a shape too, the flow drops to a channel below everything between the two,
  which its lane also keeps 15 px from its border.
  Loops run underneath the elements they span (and the labels below their events) and enter their
  target from below (over the top only
  when that avoids a crossing), as do flows into a join. The entries of a join from below, loops
  included, share its bottom vertex, for every gateway type (exclusive, parallel, inclusive,
  complex, event-based); the flow of such a join to a target below leaves through its right vertex
  (right, down, right), not down their line. A split with one entry drops its branches from the
  bottom vertex, and loops then prefer another vertex; the same for a flow that leaves a gateway up
  through its top vertex. A loop prefers to leave its gateway through a vertex of the diamond to
  get there, not beside it.
- The flows that enter a node from below (the entries of a join, a boundary path's way into its
  handler in the lane above, any flow from a lower lane or row) run along their row (a boundary
  event's along its run below the host's row) and rise straight into its bottom (a join's bottom
  vertex), the node exactly above their line. When something lies in that column between the node
  and them (a shape, a data object, a label: the end of a boundary path or of a branch that ends,
  the task after the boundary event's host, say), the node moves right past it, with everything
  after it (one column, up to three when that path goes on; a node whose column the move then takes
  moves on as far as it needs, such as a join under which the moved path now ends), if the drawing
  then has more such straight rises or fewer lines through labels, and no more crossings, lines
  through shapes or lines through labels; otherwise the entries hook into the bottom from the
  column gap beside the node (past a label only: rise through it), as loops and empty bands do
  when their way up is blocked. Joins are tried first, then the other nodes in the order of the
  model; the happy path stays the one it is without these moves. A data object tied to the join
  itself (an association from another tool) hangs right of that line. Flows from above enter a
  join through its left vertex (a boundary event's way over the top: its top vertex, from a run
  above everything around it), so its top vertex needs no room, and a node that such a way enters
  is not moved for it.
- In a pool with lanes, a node whose flow comes from a node of its own lane on a row above moves
  up onto that row, with the nodes after it in its row and lane, where nothing of the lane lies or
  runs in their cells there (a shape, or a flow along that row such as the happy path's past the
  columns its nodes in other lanes leave empty). So a split whose happy path continues in another
  lane sends its branch in its own lane straight out of its right vertex, instead of dropping both
  branches from its bottom vertex. The move is kept only when the flow into the node is then one
  straight segment on no other flow's line, more flows are straight and none bends more, and the
  sequence flows get no more crossings, shared lines, lines through shapes or through labels; every
  flow that rose straight still does (or runs straight now), and the happy path stays straight. A row
  the move leaves empty closes, so the lane gets lower. Without lanes the happy path holds the
  split's row, so nothing moves.
- Sub-processes are laid out recursively, expanded by default, on their own plane when collapsed.
  Event sub-processes sit below the content of their lane (without lanes: below the main content).
  An expanded sub-process (event sub-process, transaction) is sized for its content and the labels
  of its content (events, gateways, flows, data objects and stores; at their default spots they keep 6 px from the border)
  and for its name, drawn at the top: the content starts below the name's lines and the labels
  above the first row (a gateway's).
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
  through shapes (up to six pools). Lanes are horizontal bands that fill their pool; a loop inside
  a lane keeps 15 px from its borders and its name inside the lane (the lane grows around them).
  Message flows leave and enter vertically, run in the gap between two pools, and around the right
  of all pools when another pool lies between them.
- Gateway names go above the gateway, event names below, flow names above the longest horizontal
  segment near its start. Neighbours in a row are spaced so that their labels on one side keep apart.
  A label that would land on a shape, label, line or the name of an expanded sub-process moves to a
  free spot, inside its sub-process below the name first, else beside the name; a spot next to its
  element comes before one further away.
