---
name: bpmn
description: Create, read, change, lay out and validate BPMN 2.0 process models (.bpmn files) with the bpmn CLI (@miragon/bpmn-cli) instead of editing BPMN XML by hand. Use it whenever the user wants to model, build or create a process or BPMN diagram; add, remove, rename, move or reconnect tasks, gateways, events, sub-processes, lanes, pools, message flows, data objects or annotations; format, lay out or tidy a diagram, colour or align elements; set Camunda 7 or Camunda 8 implementation details (external tasks, job workers, input/output mappings, error handling, forms, multi-instance); or validate a .bpmn file before deploying it.
when_to_use: Any request that creates or touches a .bpmn file, even when it does not say BPMN. Typical phrases are "model the order process", "draw a BPMN diagram", "add an approval step", "add a reminder timer", "add a lane for accounting", "add the customer as a pool with message flows", "the rejection branch should go below", "colour the happy path", "tidy up the layout", "make it deployable on Camunda 8", "external task with input mapping", "Prozess modellieren", "BPMN anpassen", "BPMN-Diagramm erstellen", "Schritt einfügen", "Lane hinzufügen", "Diagramm aufräumen", "Camunda-8-Prozess bauen".
allowed-tools:
  - Bash(bpmn *)
  - Bash(npx -y @miragon/bpmn-cli@0.3.0 *) # x-release-please-version
---

# BPMN models with the bpmn CLI

`bpmn` edits BPMN 2.0 **semantically**: you name kinds, names, flows, triggers,
lanes, pools, properties and vendor extensions by id; the CLI writes the XML and
the diagram (BPMNDI) for you, keeps a hand-made drawing and places new elements
next to their neighbours. You never see or write XML or coordinates.

## Run it

```bash
bpmn --version
```

If that fails or prints a version older than the one pinned here, use this
instead of `bpmn` in every command (Node 20+; the first call downloads it):

```bash
npx -y @miragon/bpmn-cli@0.3.0 --version   # x-release-please-version
```

The examples below say `bpmn`. Run each `bpmn` command as its own command line
(no `cd`, subshells, `ls` / `head` / `cp` around it): `bpmn ...`, the `npx` form
and `printf '%s' '<json>' | bpmn ...` are pre-approved, anything else makes the
user confirm.

The CLI documents itself, and that documentation is always right for the
installed version. Ask it instead of guessing:

- `bpmn guide --short` - the core in 5 KB; `bpmn guide <topic>` - one section
  (contract, workflow, reading, output, layout, format, ops, placement,
  triggers, errors, quoting, camunda7, camunda8, design, commands)
- `bpmn kinds --section kinds,triggers,setKeys,nestedKeys,zeebeElements,ops,errors`
  (`--json` for the ops JSON schema), `bpmn <command> --help`

## The contract (standing rules)

1. **Never write or patch .bpmn XML yourself** - no Write/Edit, `sed`, `cat >`
   or script on a .bpmn file, no BPMNDI or coordinates. Do not `cat`/Read the
   XML to understand a model either: `bpmn show` prints everything it holds.
   A change the CLI cannot express: tell the user, do not hand-edit.
2. **Address elements by id only, never by name** - names repeat. Get ids from
   `bpmn show`, `bpmn find <file> <text>` or the result of the command that
   created them. Several hits for a name: decide by lane / neighbours
   (`show <id> --context`) or ask.
3. **New ids speak.** In every batch give each element you create an explicit,
   descriptive `"id"` in the file's style: `Activity_CheckInvoice`,
   `Gateway_InvoiceOk`, `Event_InvoicePaid`, `Lane_Accounting`,
   `Participant_Customer`; flows `Flow_CheckInvoiceToBookInvoice` (or let the
   CLI derive them; derived ids speak too). PascalCase ASCII (ae oe ue ss), no
   numbers or hashes - also when the file's own ids are Modeler hashes like
   `Activity_0k3x9qa`. Keep a file's existing prefix and case (`Task_check_stock`).
4. **Back references inside a batch:** an id you set explicitly can be used by
   every later op. For what you do not name yourself, set an alias and use it:
   `"as": "$x"` (add, connect, split), `"flowAs": "$f"` (the flow into a new
   node), `"joinAs": "$j"` (the join of a split), `"refAs": "$m"` (the message,
   error, signal or escalation an element references). The result lists alias -> id.
5. **One change, one transaction:** more than two related edits go into one
   `bpmn apply` batch (one validation, one layout, all or nothing). Paths that
   are invalid halfway (a new boundary event and its handling path) must be in
   the same batch.
6. **Keep the user's drawing.** The default layout mode is right. Use
   `--relayout` / `bpmn layout` only when the user asks for a redraw.

## The core loop

1. **Orient** (cheap first):
   - `bpmn show <file>` - small models: every node in flow order with its id,
     lane, implementation and flows, plus the problems
   - `bpmn show <file> --around <id> [--depth 2]` - the neighbourhood of one
     element in a large model
   - `bpmn show <file> <id> --context` - where it is, lane, before / after,
     boundary events, what catches it, message flows
   - `bpmn find <file> <text> [--kind userTask]` - ids for a name or a vendor value
   - `bpmn show <file> --layout` - the drawing: rows / columns of ids per lane,
     colours, layout problems (read it before formatting)
2. **Change** in one batch with explicit ids. Ops are the CLI flags in
   lowerCamelCase. Pipe the JSON in with `printf '%s' '...'`: the single quotes
   keep `${...}` intact, and unlike a heredoc this form runs under the skill's
   pre-approved `bpmn` permission. Write an apostrophe inside the JSON as `\u0027`.

   ```bash
   printf '%s' '[
     { "op": "add", "kind": "boundaryEvent:timer", "name": "14 days", "id": "Event_PaymentOverdue", "on": "Activity_ReceivePayment", "timer": "P14D", "nonInterrupting": true },
     { "op": "add", "kind": "sendTask", "name": "Send payment reminder", "id": "Activity_SendPaymentReminder", "after": "Event_PaymentOverdue", "lane": "Lane_Accounting" },
     { "op": "add", "kind": "endEvent", "name": "Reminder sent", "id": "Event_ReminderSent", "after": "Activity_SendPaymentReminder", "lane": "Lane_Accounting" },
     { "op": "connect", "source": "Activity_SendPaymentReminder", "target": "Participant_Customer", "name": "Reminder" }
   ]' | bpmn apply order-to-cash.bpmn -
   ```

   Single commands (`bpmn add|connect|set|remove|retype|move|order|ext ...`)
   are fine for one or two edits. `--dry-run` reports everything and writes
   nothing; use it before a large change to a hand-made diagram. Every
   mutating command takes `--backup` (keeps the original as `<file>.bak`) and
   `-o <file>` (writes the result elsewhere) - use them instead of `cp`, which
   is not pre-approved. Report only what the command output shows.
3. **Read the result** - it is your feedback, not noise:
   - `created` / `changed` / `removed` lines and `renamed: A -> B` (a flow whose
     id named its ends is renamed when a splice changes them: use the new id)
   - `warning ...` lines are only the warnings **this change added**, each with
     a hint that is the fixing command; `resolved:` what it fixed; old warnings
     are only counted
   - `layout: ok - incremental (hand-made diagram: kept, changes placed locally)`
     with `placed:` / `moved:` / `rerouted:`, or `full` for a new / engine-drawn
     diagram; `layout quality: score a -> b; added: <problem> [ids]` - fix added
     problems with the format commands, never by redrawing a hand-made diagram
   - a hand-made diagram where one batch splices several nodes in a row into the
     same flow (a task, then a gateway after it) can come out with the new nodes
     below the line (`added: backwardFlow`, `crossings` in the dry run): splice
     the main-line nodes with one command each instead - `bpmn add <file>
     userTask "Approve order" --id Activity_ApproveOrder --flow <flowId>`, then
     `bpmn add <file> exclusiveGateway "Order approved?" --id
     Gateway_OrderApproved --after Activity_ApproveOrder` (each lands in the row
     and shifts the rest right) - then add branches and boundary paths in one
     batch, with the flow ids the results printed
   - `--summary` shortens all of this to a few lines
   - example: a full redraw moved the customer pool below and added a crossing
     with a message flow - `bpmn order <file> <collaborationId> <poolIds...>`
     puts the pools back in order (top to bottom)
4. **Validate**: `bpmn validate <file>` (structure, lint, the engine profile of
   the file's platform, a layout dry run); `--strict` exits 5 on any warning -
   use it when the user wants a clean or deployable model. Fix findings with the
   command in their hint, then validate again. Inside a design-iq content
   repository (a `bpmiq.yml` above the file) every write also passes design-iq's
   save gate (`E_DESIGN_*`, see `bpmn guide design`).
5. **Confirm** with `bpmn show` (or `--around`) and report to the user what
   changed, naming the ids.

Exit codes: 0 ok, 1 usage, 2 model/validation error, 3 layout, 4 file/parse,
5 `--strict` with warnings. A failed command writes nothing.

## Building blocks

- Kinds (aliases in brackets): `task`, `userTask` (user), `serviceTask`
  (service), `sendTask`, `receiveTask`, `scriptTask`, `manualTask`,
  `businessRuleTask`, `subProcess`, `eventSubProcess:<trigger>`, `callActivity`,
  `exclusiveGateway` (xor), `parallelGateway` (and), `inclusiveGateway` (or),
  `eventBasedGateway`, `startEvent`, `endEvent`, `intermediateCatchEvent`,
  `intermediateThrowEvent`, `boundaryEvent`, `participant` (pool), `lane`,
  `dataObject`, `dataStore`, `textAnnotation`. Events take `kind:trigger`
  (`startEvent:message`, `boundaryEvent:timer`, `endEvent:error`) plus the
  trigger key (`message`, `timer`, `error` + `errorCode`, `signal`, ...).
- Placement (exactly one per add): `after` X (append after a gateway / an end of
  a path, else splice into X's single outgoing flow), `before` Y, `after`+`before`
  (into the flow X -> Y), `flow` F (splice into flow F), `in` S (unconnected in a
  process / sub-process / pool; connect it later), `on` A (boundary event).
  `to` T also connects the new node to T. `lane` sets the lane.
- Flow options on add describe the flow **into** the new node: `flowName`,
  `condition`, `default`, `flowId`, `flowAs`.
- `set` takes its changes in `values` (and `unset`):
  `{ "op": "set", "id": "Flow_OrderOkYes", "values": { "name": "yes", "condition": "${orderOk}" } }`;
  a `default` flow has no condition.
- Pools: the first `participant` wraps the existing process; add further pools
  after it, `"blackBox": true` for a party without process (a customer).
  `connect` between pools makes a message flow (`"message": "Order"` names it).
- `split` (apply only): gateway + branches + join in one op.

Details, every op key and worked batches: [reference/ops.md](reference/ops.md).

## Layout modes

- `auto` (default): a new file or a drawing exactly as the engine would draw it
  is redrawn in full; anything hand-made or formatted is **kept** - new
  elements are placed locally, room is made like the modeler's space tool,
  only affected flows are rerouted.
- `--layout incremental`: always keep (fails with `E_LAYOUT_INCREMENTAL`
  instead of redrawing) - use it when keeping the drawing is a requirement.
- `--relayout` (= `--layout full`, `bpmn layout <file>`): redraw everything;
  colours survive, positions do not. Only when the user asks.

## Formatting without XML

Diagram-only commands name elements, never coordinates: `place` (to the row /
column of another element), `align`, `color` (blue, orange, green, red, purple,
default), `label` (side of an external label: above, below, left, right),
`route` (exit / entry side), `space` (insert or close a column / row; `--by`
takes `column`, `row`, `<n>col` / `<n>row` or pixels: `--by 2col` is two
columns, `--by 2` only 2 px), `tidy` (remove overlaps), `compact` (close empty rows / columns,
shrink frames), `order` (lanes, pools, branch order). Selectors
`--path <fromId> <toId>`, `--branch <flowId>`, `--kind <kind>` name many
elements at once. Read the drawing with `show --layout` first, `--dry-run` the
format op, check `bpmn metrics <file>` after. In a batch they are ops too and
run after the semantic ops and the layout.

```bash
bpmn show order-to-cash.bpmn --layout
bpmn color order-to-cash.bpmn --path Event_OrderReceived Event_OrderCompleted --color green
bpmn place order-to-cash.bpmn --branch Flow_OrderOkToSendRejection --below Activity_CheckOrder --dry-run
```

Every command, selector and fix: [reference/formatting.md](reference/formatting.md).

## Camunda 7 and Camunda 8

- New file for an engine: `bpmn new <file> --name "..." --target camunda7`
  (also CIB seven / Operaton) or `--target camunda8`. The platform of an
  existing file is in the `platform:` line of `bpmn validate`.
- Camunda 7: attributes via `set` with the `camunda:` prefix; attributes of
  nested elements via `definition.` / `loop.` / `condition.` keys; extension
  elements via `ext add` (child types are filed into their container):
  [reference/camunda7.md](reference/camunda7.md).
- Camunda 8: implementation details are zeebe extension elements via `ext add`
  (`zeebe:taskDefinition`, `zeebe:input` / `zeebe:output`, `zeebe:header`,
  `zeebe:assignmentDefinition`, `zeebe:subscription`, ...); FEEL values start
  with `=`: [reference/camunda8.md](reference/camunda8.md).
- `bpmn validate` runs the platform profile: every `W_C7_DEPLOY_*` /
  `W_C8_DEPLOY_*` finding means the engine refuses the file - fix all of them
  (the hint is the command) before you call a model deployable.

## Common errors

| Error | What to do |
| --- | --- |
| `E_NOT_FOUND` | Use a listed candidate id; `bpmn find <file> <text>` lists ids. In a batch the hint lists the ids created so far. Never retry with a name. |
| `E_HAS_SUCCESSOR` / `E_HAS_PREDECESSOR` | The anchor has several flows: use `flow` <flowId> or `after` X + `before` Y. |
| `E_AMBIGUOUS_SCOPE` | Several processes: add `in` <processId or participantId>. |
| `E_INVALID_PLACEMENT` | Boundary events need `on`; lanes, pools, data, annotations take `in` only. |
| `E_CROSS_SCOPE` | Sequence flows stay inside one pool / sub-process; between pools `connect` makes a message flow. |
| `E_UNKNOWN_KEY` | The message lists the settable keys; vendor keys need their prefix (`camunda:assignee`). |
| `E_WRONG_HOST` | The attribute belongs on a nested element or elsewhere: use the key from the hint (`definition.camunda:errorCodeVariable=...`). |
| `E_DUPLICATE_EXTENSION` | `ext remove` the old one or `--replace`; check `bpmn ext list <file> <id>`. |
| `E_VALIDATION` | The change would add a structural error: do the whole change in one batch, or read `bpmn validate`. `--force` only when the user agrees. |
| `E_LEAVES_CONTAINER` | `place` / `align` would leave the lane / pool: `move <id> --lane <laneId>` first (in a batch: a move op before it). |
| `E_NO_ROOM` | Make room with `space --after <id>` / `--below <id>`, then place again. |
| `E_UNKNOWN_ALIAS` | Define the alias (`as` / `flowAs` / `joinAs` / `refAs`) in an earlier op of the batch. |
| `E_IMPORT_LOSSY` | The file has content the reader would drop. Show the user `bpmn validate` output and ask before `--force`; do not repair the XML by hand. |
| `E_USAGE` | Bad flag or ops key: the message names it; see `bpmn <command> --help`. |

Every code with its fix: `bpmn kinds --section errors`.

## Reference files

- [reference/ops.md](reference/ops.md) - batch format, placement, kinds and triggers, set keys, split, aliases
- [reference/formatting.md](reference/formatting.md) - reading the drawing, format commands, selectors
- [reference/camunda7.md](reference/camunda7.md) - Camunda 7 / CIB seven / Operaton recipes and the C7 profile
- [reference/camunda8.md](reference/camunda8.md) - Camunda 8 (Zeebe) recipes and the C8 profile
- [reference/recipes.md](reference/recipes.md) - complete sessions: order-to-cash from scratch in one batch, a safe change to a drawn model, review feedback, a C7 external task, a C8 job worker
