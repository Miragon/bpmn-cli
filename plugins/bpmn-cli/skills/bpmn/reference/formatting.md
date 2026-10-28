# Formatting without XML

Format commands change only the drawing, never the process. They name
elements (by id) and say where things go relative to other elements; shapes in
the way give way, frames grow, flows are rerouted. A format command that
changed the drawing makes it hand-made, so later writes keep the formatting
(layout mode `auto` places new elements locally from then on).

The examples run on `order-to-cash.bpmn` as [recipes.md](recipes.md) leaves it.
Full option lists: `bpmn guide format`, `bpmn <command> --help`.

## 1. Read the drawing first

```bash
bpmn show order-to-cash.bpmn --layout
bpmn metrics order-to-cash.bpmn
```

`show --layout` prints, per pool and lane, the rows of node ids from left to
right with their column across the diagram (`c0..cN`; ` … ` marks a wide gap),
wide empty columns, colours, labels moved off their default side, and the
layout problems with ids. `metrics` prints the score (0 is best) and every
problem: crossings, overlaps, flows through shapes (`through`), labels on lines,
nodes outside their lane or pool, frames covering foreign shapes, flows running
backwards, and more.

## 2. Look at it

`bpmn render` draws the diagram as a PNG (no browser); Read the PNG. Pass `-o`
into `.bpmn-render/` in the working directory (created when missing; scratch:
delete it or add it to `.gitignore`).

```bash
# the whole diagram; every `metrics` problem numbered on the defect
bpmn render order-to-cash.bpmn --problems -o .bpmn-render/order-to-cash.png
# crops: the nodes of `show --around`, a sequence-flow path, a lane / pool / sub-process, these ids
bpmn render order-to-cash.bpmn --around gateway_orderOk --depth 2 --problems -o .bpmn-render/around.png
bpmn render order-to-cash.bpmn --path startEvent_orderReceived endEvent_orderCompleted -o .bpmn-render/path.png
bpmn render order-to-cash.bpmn --scope lane_accounting -o .bpmn-render/accounting.png
bpmn render order-to-cash.bpmn receiveTask_receivePayment sendTask_sendPaymentReminder -o .bpmn-render/ids.png
# an orange halo around elements
bpmn render order-to-cash.bpmn --highlight sendTask_sendInvoice,receiveTask_receivePayment -o .bpmn-render/halo.png
```

```text
wrote .bpmn-render/order-to-cash.png  1382x727 px  ~1,282 image tokens  scale 1.00  plane collaboration_orderToCash
problems (numbered in the image):
  1 labelOnLine [messageFlow_customerToReceivePayment, messageFlow_sendPaymentReminderToCustomer]
```

- The `wrote` line gives the size and the cost: image tokens = width x height
  / 784. The long edge stays within `--max-size` (2000 px); a larger drawing
  is scaled down, and below `scale 0.75` the labels are too small - a note
  says so: render `--around <id>`, `--path <from> <to>` or `--tiles`
  (readable tiles `<name>-1.png`, `-2.png`, ... cut at the diagram columns;
  only those with something in them, at most 40).
- `--problems` lists the problems under the line, `<n> <kind> [<ids>]
  <detail>` in `metrics` order (a crop: those of its elements), each number
  drawn on the defect: `1 labelClash [gateway_orderOk, sendTask_sendRejection]
  label on shape`. Fix them by those ids with the commands below.
- A crop draws flows to elements it leaves out faded, pools and lanes as
  context. A collapsed sub-process is its own plane: the result lists it
  under `other planes`, `--plane <id>` draws it.
- `--render <file.png>` on any mutating command (`add`, `apply`, the format
  commands, ...) draws its result: created elements in a green halo, changed
  orange, moved blue, the problems the change added numbered; a drawing too
  large to read shows the region of the change. A failed render is reported,
  the change stands.

## 3. Selectors

`place`, `align`, `color` and `tidy` take ids and / or selectors; selectors add
to the ids:

| Selector | Selects |
| --- | --- |
| `--path <fromId> <toId> [--via <flowId>...]` | every node and flow on the shortest sequence-flow path; `--via` picks a branch |
| `--branch <flowId>` | what only that branch reaches, up to the join or its ends |
| `--kind <kind>` | every element of a kind (`endEvent`, `userTask`, `sequenceFlow`, ...) |

In ops JSON: `"path": ["startEvent_a", "endEvent_b"]`, `"via": [...]`, `"branch": "flow_x"`,
`"kind": "endEvent"`. Shape commands leave boundary events out of a selection
(they follow their host).

## 4. The commands

```bash
# colours (bpmn-js palette: blue, orange, green, red, purple; default removes)
bpmn color order-to-cash.bpmn --path startEvent_orderReceived endEvent_orderCompleted --color green
bpmn color order-to-cash.bpmn --branch flow_orderOkToSendRejection --color red
bpmn color order-to-cash.bpmn --branch flow_orderOkToSendRejection --color default

# the space tool: one column more right of a node, then close it again
bpmn space order-to-cash.bpmn --after userTask_checkOrder
bpmn space order-to-cash.bpmn --after userTask_checkOrder --by -column

# external labels of events, gateways, data and flows
bpmn label order-to-cash.bpmn gateway_orderOk --side below

# route one flow again, forcing the sides it leaves and enters by
bpmn route order-to-cash.bpmn flow_paymentOverdueToSendPaymentReminder --exit bottom --entry left

# same column (horizontal centre) as the reference given with --to
bpmn align order-to-cash.bpmn endEvent_reminderSent endEvent_orderCompleted --axis column --to endEvent_orderCompleted

# order of branches (top to bottom), lanes and pools
bpmn order order-to-cash.bpmn gateway_orderOk flow_orderOkToSendRejection flow_orderOkToPickAndPackGoods
bpmn order order-to-cash.bpmn participant_orderToCash lane_sales lane_warehouse lane_accounting
bpmn order order-to-cash.bpmn collaboration_orderToCash participant_customer participant_orderToCash

# overlaps away, then close empty rows / columns and shrink frames
bpmn tidy order-to-cash.bpmn
bpmn compact order-to-cash.bpmn
```

- `place <ids...> --row-of | --below | --above <ref>` and / or
  `--column-of | --after | --before <ref>`: the ids move as one rigid group, the
  first id lands on the row / column of the reference. `--branch <flowId>`
  moves a whole branch up to its join.
- `place <boundaryEventId> --side top|bottom`: the boundary event moves to that
  border of its host, its flow is routed again, and its exception path follows
  when it was drawn on the old side in the host's lane (a reminder path below
  that crosses a branch goes above the task). A new boundary path whose rows
  below would all cross a line is placed above its host on its own, the event
  on the top border; `--side bottom` takes it back below. A path added to an
  event on the top border runs above its host.
- `align <ids...> --axis row|column [--to <ref>]`: same vertical centre (row)
  or same horizontal centre (column) as the reference (default: the first id).
- `space --after <id>` / `--below <id>` `[--by column|row|<n>col|<n>row|<px>]`:
  moves everything right of / below the element (`--by 2col` = two columns, a
  bare number is pixels); a negative amount (`-column`, `-2col`, `-row`, `-80`)
  closes up to that much empty space; the result says how far it moved. On a lane or pool it grows
  that frame.
- `compact [ids]` closes empty rows and columns and shrinks pools, lanes and
  expanded sub-processes to their content; it never adds a layout problem.

## 5. Place a branch

A typical request is "put the rejection branch below the main line". Read the
rows first: the rejection branch runs on the main line's row of Sales (the
happy path goes on in Warehouse), and Sales has no row below it, so make room
in the lane, then place the branch relative to a node of the main line (a dry
run shows what moves):

```bash
bpmn show order-to-cash.bpmn --layout
bpmn space order-to-cash.bpmn --below lane_sales
bpmn place order-to-cash.bpmn --branch flow_orderOkToSendRejection --below userTask_checkOrder --dry-run
bpmn place order-to-cash.bpmn --branch flow_orderOkToSendRejection --below userTask_checkOrder
bpmn show order-to-cash.bpmn --layout
```

When a node should land in another lane, change its lane first: `place`
refuses to move a node out of its lane, pool or sub-process.

```text
$ bpmn place order-to-cash.bpmn sendTask_sendInvoice --row-of receiveTask_receivePayment
error E_LEAVES_CONTAINER: Placing sendTask_sendInvoice in the row of receiveTask_receivePayment would move it out of its lane lane_sales (into lane lane_accounting)
  hint: That position is in lane lane_accounting. Assign the lane first (`bpmn move <file> sendTask_sendInvoice --lane lane_accounting`, in a batch a move op with "lane" before this op), or make room in lane_sales first (`bpmn space <file> --below lane_sales`).
```

Fixes: `move <id> --lane <laneId>` when the node really belongs to the other
lane (in a batch: a `move` op before the `place` op, as in section 6), or a
reference inside the same lane. `E_NO_ROOM` means the target row / column
cannot hold the shapes, or closing space would add a layout problem: the hint
of a refused `place` / `align` names one `bpmn space ...` command that makes
the room (a dry run checked that the place fits after it; in a batch put its op
before the place op) - run it and place again. After other ops of a batch it
names only that space op (the file does not have their changes yet); without
such a run it names the shapes to move first. When closing space was refused, close less.

Check the quality line after every format op. A selector over a model with
lanes can pull shapes across the drawing (`align --kind endEvent --axis column`
lines up the end events of every lane); dry-run it first and keep it only when
`layout quality` did not get worse.

## 6. Format ops in a batch

Format ops run in batch order, all or nothing, each after the layout of the ops
before it; they see the ids as those ops left them (aliases work), and a later
model op keeps what they drew:

```bash
printf '%s' '[
  { "op": "move", "ids": ["sendTask_sendInvoice"], "lane": "lane_accounting" },
  { "op": "color", "path": ["startEvent_orderReceived", "endEvent_orderCompleted"], "color": "green" },
  { "op": "color", "ids": ["sendTask_sendPaymentReminder", "endEvent_reminderSent"], "color": "orange" },
  { "op": "label", "id": "gateway_orderOk", "side": "above" },
  { "op": "compact" }
]' | bpmn apply order-to-cash.bpmn - --summary --render .bpmn-render/order-to-cash.png
bpmn metrics order-to-cash.bpmn
```

The result has one `format <op> #<index>: moved ...; rerouted ...; colored ...`
line per format op, the quality line `layout quality: a -> b; added: ...` and
the `render:` block of `--render`: Read that PNG.
If a format op adds a problem, undo it with the opposite op or choose another
reference; `--relayout` is not a formatting tool (it discards the user's drawing).
