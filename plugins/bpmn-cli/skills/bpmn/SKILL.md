---
name: bpmn
description: Creates, changes, lays out and validates BPMN 2.0 process models (.bpmn files) with the bpmn CLI instead of editing BPMN XML by hand, including Camunda 7/8 implementation details.
when_to_use: Use whenever a request creates or touches a .bpmn file or a process diagram, even when it does not say BPMN, e.g. "model the order process", "Prozess modellieren", "BPMN anpassen".
allowed-tools:
  - Bash(bpmn *)
  - Bash(npx -y @miragon/bpmn-cli@0.9.0 *) # x-release-please-version
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
instead of `bpmn` in every command (Node 24+; the first call downloads it):

```bash
npx -y @miragon/bpmn-cli@0.9.0 --version   # x-release-please-version
```

The examples below say `bpmn`. Run each `bpmn` command as its own command line
(no `cd`, subshells, `ls` / `head` / `cp` around it): `bpmn ...`, the `npx` form
and `printf '%s' '<json>' | bpmn ...` are pre-approved, anything else makes the
user confirm.

The CLI documents itself, and that documentation is always right for the
installed version. Ask it instead of guessing:

- `bpmn guide` - the core; `bpmn guide <topics...>` - the named sections
  (contract, workflow, reading, output, layout, format, render, ops, placement,
  triggers, errors, quoting, camunda7, camunda8, bpmnlint, conventions, commands)
  and tables (kinds, set-keys, nested-keys, zeebe-elements, ids, colors,
  exit-codes)
- `bpmn <command> --help`

## The contract (standing rules)

1. **Never write or patch .bpmn XML yourself** - no Write/Edit, `sed`, `cat >`
   or script on a .bpmn file, no BPMNDI or coordinates. Do not `cat`/Read the
   XML to understand a model either: `bpmn show` prints everything it holds.
   A change the CLI cannot express: tell the user, do not hand-edit.
2. **Address elements by id only, never by name** - names repeat. Get ids from
   `bpmn show`, `bpmn find <file> <text>` or the result of the command that
   created them. Several hits for a name: decide by lane / neighbours
   (`show <file> <id>`) or ask.
3. **New ids speak.** In every batch give each element you create an explicit,
   descriptive `"id"` in the project's id conventions: `userTask_checkInvoice`,
   `gateway_invoiceOk`, `endEvent_invoicePaid`, `lane_accounting`,
   `participant_customer`; flows `flow_checkInvoiceToBookInvoice` (or let the
   CLI derive them; derived ids speak too). camelCase ASCII (ae oe ue ss), no
   numbers or hashes - also when the file's own ids are Modeler hashes like
   `Activity_0k3x9qa`; existing ids stay as they are.
   Run `bpmn conventions <file>` before the first change (a file that does not
   exist yet too): it lists the patterns new ids follow, the `.bpmnlintrc`'s
   `element-id-naming`, else the rule's defaults.
4. **Back references inside a batch:** an id you set explicitly can be used by
   every later op. For what you do not name yourself, set an alias and use it:
   `"as": "$x"` (add, connect, split), `"flowAs": "$f"` (the flow into a new
   node), `"outAs": "$o"` (the flow an add creates out of the new node, e.g. a
   splice's flow to the old successor), `"joinAs": "$j"` (the join of a split),
   `"refAs": "$m"` (the message, error, signal or escalation an element
   references). The result lists alias -> id.
5. **One change, one transaction:** more than two related edits go into one
   `bpmn apply` batch (one validation, one layout, all or nothing). Paths that
   are invalid halfway (a new boundary event and its handling path) must be in
   the same batch.
6. **Keep the user's drawing.** `bpmn layout` redraws everything. Run it only
   when the user asks for a redraw, and to end a model you built from scratch
   over several writes ([Layout](#layout)).

## The core loop

1. **Orient** (cheap first):
   - `bpmn show <file>` - small models: every node in flow order with its id,
     lane, implementation and flows
   - `bpmn show <file> --in <id>` - one pool, process, lane or sub-process
   - `bpmn show <file> --around <id> [--depth 2]` - the neighbourhood of one
     element in a large model
   - `bpmn show <file> <id>` - one element: where it is, its flows, boundary
     events, what catches it, message flows, attributes, numbered extensions
   - `bpmn find <file> [text] [--kind userTask] [--in <id>]` - ids for a name, a
     vendor value, a kind (`task`, `event`, `gateway` too) or a container
   - `bpmn conventions <file>` - the id patterns new ids follow; once per file
   - `bpmn diagram <file>` - the drawing: the layout score, every problem with
     its ids, rows / columns of ids per lane (read it before formatting)
2. **Change** in one batch with explicit ids. An op's keys are the CLI flags in
   lowerCamelCase; what the element holds goes under `"set"`. Pipe the JSON in
   with `printf '%s' '...'`: the single quotes keep `${...}` intact, and unlike a
   heredoc this form runs under the skill's pre-approved `bpmn` permission. Write
   an apostrophe inside the JSON as `'`.

   ```bash
   printf '%s' '[
     { "op": "add", "kind": "boundaryEvent:timer", "name": "14 days", "id": "event_paymentOverdue", "on": "receiveTask_receivePayment", "set": { "timer": "P14D", "nonInterrupting": true } },
     { "op": "add", "kind": "sendTask", "name": "Send payment reminder", "id": "sendTask_sendPaymentReminder", "after": "event_paymentOverdue", "lane": "lane_accounting" },
     { "op": "add", "kind": "endEvent", "name": "Reminder sent", "id": "endEvent_reminderSent", "after": "sendTask_sendPaymentReminder", "lane": "lane_accounting" },
     { "op": "connect", "source": "sendTask_sendPaymentReminder", "target": "participant_customer", "set": { "name": "Reminder" } }
   ]' | bpmn apply order-to-cash.bpmn -
   ```

   Single commands (`bpmn add|connect|set|remove|retype|move|order|ext ...`)
   are fine for one or two edits. A flag says where an element goes and how the
   command runs, a `key=value` what it holds (`bpmn add <file>
   boundaryEvent:timer "14 days" --on <id> timer=P14D nonInterrupting=true`).
   `--dry-run` reports everything and writes nothing; use it before a large
   change to a hand-made diagram. Every write takes `-o <file>` (writes the
   result elsewhere) - use it instead of `cp`, which is not pre-approved. Report
   only what the command output shows.
3. **Read the result** - it is your feedback, not noise:
   - `created` / `changed` / `removed` lines and `renamed: A -> B` (a flow whose
     id named its ends is renamed when a splice changes them: use the new id)
   - when flow ids are API (code generated from the model, e.g. bpmn-to-code,
     or tests that name them), tell the user each `renamed:` so the code follows
   - `warning <code> <id>: ...` lines are findings at the elements this change
     touched, each with its fix in brackets. `warning W_ID_PREFIX_STALE <id>`
     after a retype or a trigger change: the id keeps a prefix the convention
     rejects; rename it with the `bpmn set` of its hint only when nothing else
     uses the id (ask the user)
   - `... N more lines (--json lists them)`: the text stops at 1 KB, the last
     lines always stay. Rerun with `--json` when you need what was cut
   - `layout quality: score a -> b; added: <problem> [ids]; resolved: ...` - fix
     added problems with the format commands, never by redrawing a hand-made
     diagram
   - `state: 0 errors, N warnings` counts the whole file; `bpmn validate` lists
     them. Project lint runs only there, never on a write
   - one batch places its new nodes like the same ops sent one by one: a task
     and a decision spliced into a flow stay in the row (the rest shifts right),
     their branches go below, a boundary path is placed after the normal flow.
     A new branch or boundary path avoids the existing lines on its own: it
     opens a row right under its anchor (the lines there move down), or goes
     above it (the result notes `moved to the top border`). When a crossing is
     still left (`added: crossings` naming both), move a boundary event and its
     path to the other border: `bpmn place <file> <boundaryEventId> --side top`
     (or `--side bottom`); a path added after that runs on the event's side
   - example: a full redraw moved the customer pool below and added a crossing
     with a message flow - `bpmn order <file> <collaborationId> <poolIds...>`
     puts the pools back in order (top to bottom)
4. **Look** after a change that drew something (new, moved or formatted
   elements): render it and Read the PNG. Always pass `-o` into `.bpmn-render/`
   in the working directory (created by the render; scratch: delete it or add it
   to `.gitignore`).

   ```bash
   bpmn render order-to-cash.bpmn --problems -o .bpmn-render/order-to-cash.png
   ```

   Each red number is a layout problem listed under the `wrote` line with its
   ids. Fix what you see (labels on shapes or lines, crossings, a branch on
   the wrong side) with the format commands by those ids, then render again -
   at most twice. On a large model (`scale` under 0.75 in the `wrote` line: the
   labels get too small) render `--around <id>`, `--path <from> <to>` or ids
   instead of the whole diagram.
5. **Validate**: `bpmn validate <file>` (structure, the engine profile of the
   file's platform, a layout dry run, and the project's `.bpmnlintrc` when there
   is one above the file: `[bpmnlint error] <rule> <id>` / `[bpmnlint] <rule>
   <id>` findings, an error exits 2); `--strict` exits 5 on any warning - use it
   when the user wants a clean or deployable model. Fix findings with the command
   in their hint, then validate again. bpmnlint: `bpmn guide bpmnlint`. A
   `.bpmnlintrc` that names a plugin bpmn-cli does not ship runs that plugin's
   code from the repository's `node_modules` (only inside a git repository of the
   user running bpmn, elsewhere `W_LINT_UNAVAILABLE` names it and the rest of the
   `.bpmnlintrc` runs); in a repository or folder the user does not trust (a
   clone, an unpacked archive), add `--no-lint-config` and tell the user why.
6. **Confirm** with `bpmn show` (or `--around`) and report to the user what
   changed, naming the ids.

Exit codes: 0 ok, 1 usage, 2 model/validation error, 3 layout, 4 file/parse,
5 `validate --strict` with warnings. A failed command writes nothing.

## Building blocks

- Kinds (aliases in brackets): `task`, `userTask` (user), `serviceTask`
  (service), `sendTask`, `receiveTask`, `scriptTask`, `manualTask`,
  `businessRuleTask`, `subProcess`, `eventSubProcess:<trigger>`, `callActivity`,
  `exclusiveGateway` (xor), `parallelGateway` (and), `inclusiveGateway` (or),
  `eventBasedGateway`, `startEvent`, `endEvent`, `intermediateCatchEvent`,
  `intermediateThrowEvent`, `boundaryEvent`, `participant` (pool), `lane`,
  `dataObject`, `dataStore`, `textAnnotation`, `group` (`members` [ids]: drawn
  around them). Events take `kind:trigger`
  (`startEvent:message`, `boundaryEvent:timer`, `endEvent:error`) plus the
  trigger key under `"set"` (`message`, `timer`, `error` + `errorCode`,
  `signal`, ...).
- Placement (exactly one per add): `after` X (append after a gateway / an end of
  a path, else splice into X's single outgoing flow), `before` Y, `after`+`before`
  (into the flow X -> Y), `flow` F (splice into flow F), `in` S (unconnected in a
  process / sub-process / pool; connect it later), `on` A (boundary event).
  `to` T also connects the new node to T. `lane` sets the lane.
- Flow options on add describe the flow **into** the new node: `flowName`,
  `condition`, `default`, `flowId`, `flowAs`.
- `set` takes its changes in `set`:
  `{ "op": "set", "id": "flow_orderOkYes", "set": { "name": "yes", "condition": "${orderOk}" } }`;
  an empty value removes a key; a `default` flow has no condition.
- `connect` holds its flow's `name`, `condition`, `language`, `default` and
  `message` under `"set"` too.
- Pools: the first `participant` wraps the existing process; add further pools
  after it, `"blackBox": true` for a party without process (a customer).
  `connect` between pools makes a message flow (`"set": { "message": "Order" }`
  names it).
- `split` (apply only): gateway + branches + join in one op.

Details, every op key and worked batches: [reference/ops.md](reference/ops.md).

## Layout

A plane with shapes keeps its drawing: new elements are placed locally, room is
made for what follows them, only affected flows are rerouted. An empty plane is
drawn in full.

- A new file filled by one `apply` is drawn in full. **A model you build from
  scratch over several writes grows step by step: end it with `bpmn layout
  <file>`**, then go on with the look step.
- `bpmn layout <file>` (or a last `{ "op": "layout" }` in a batch) redraws
  everything: colours survive, positions do not. Otherwise only when the user
  asks.
- `E_LAYOUT_INCREMENTAL`: the change found no place and nothing was written. A
  last `layout` op gets it through; on a hand-made diagram ask the user first.
- On a vertical plane a write that places, moves or routes something answers `E_LAYOUT_INCREMENTAL`; `set`, `retype`, `ext` and the drawing commands pass, and `bpmn layout` redraws it horizontally.

## Formatting without XML

Diagram-only commands name elements, never coordinates: `place` (to the row /
column of another element), `color` (blue, orange, green, red, purple, default),
`label` (side of an external label: above, below, left, right), `route` (exit /
entry side), `space` (insert or close a column / row; `--by` takes `column`,
`row`, `<n>col` / `<n>row` or pixels: `--by 2col` is two columns, `--by 2` only
2 px), `tidy` (remove overlaps), `compact` (close empty rows / columns, shrink
frames), `order` (lanes, pools, branch order). `place` and `color` take
`--path <fromId> <toId>` and `--branch <flowId>` for many elements at once. Read
`bpmn diagram <file>` first, `--dry-run` the format op, check its `layout quality`
line and look (step 4) after. In a batch they are ops too: they run in batch
order, after every model op (a model op behind one is `E_USAGE`).

```bash
bpmn diagram order-to-cash.bpmn
bpmn color order-to-cash.bpmn --path startEvent_orderReceived endEvent_orderCompleted --color green
bpmn space order-to-cash.bpmn --below lane_sales
bpmn place order-to-cash.bpmn --branch flow_orderOkToSendRejection --below userTask_checkOrder --dry-run
```

Every command and fix: [reference/formatting.md](reference/formatting.md).

## Camunda 7 and Camunda 8

- New file for an engine: `bpmn new <file> "<name>" --target camunda7`
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
| `E_INVALID_PLACEMENT` | Boundary events need `on`; lanes, pools, data, annotations take `in` only. A move of several nodes starts after an anchor outside them (not a boundary event of one); the hint has the command to run instead. |
| `E_CROSS_SCOPE` | Sequence flows stay inside one pool / sub-process; between pools `connect` makes a message flow. |
| `E_UNKNOWN_KEY` | The message lists the keys this element takes; vendor keys need their prefix (`camunda:assignee`). |
| `E_WRONG_HOST` | The attribute belongs on a nested element or elsewhere: use the key from the hint (`definition.camunda:errorCodeVariable=...`). |
| `E_DUPLICATE_EXTENSION` | `ext remove` the old one or `--replace`; `bpmn show <file> <id>` lists them numbered. |
| `E_VALIDATION` | The change would add an error. The refusal lists each one with its hint and nothing was written, so `bpmn validate <file>` does not show them. Do the whole change in one batch so that it ends valid. `--force` only when the user agrees. |
| `E_LEAVES_CONTAINER` | `place` would leave the lane / pool: `move <id> --lane <laneId>` first (in a batch: a move op before it). |
| `E_NO_ROOM` | Run the `bpmn space ...` command of the hint (checked to make the room), then place again; in a batch after other ops the hint names the space op to put before the place op; without one, move the shapes it names first. |
| `E_UNKNOWN_ALIAS` | Define the alias (`as` / `flowAs` / `outAs` / `joinAs` / `refAs`) in an earlier op of the batch. |
| `E_IMPORT_LOSSY` | The file has content the reader would drop. Show the user `bpmn validate` output and ask before `--force`; do not repair the XML by hand. |
| `E_USAGE` | Bad flag or ops key: the message names it; see `bpmn <command> --help`. A word of the 0.x CLI: [reference/migration.md](reference/migration.md). |

More codes: `bpmn guide errors`.

## Reference files

- [reference/ops.md](reference/ops.md) - batch format, placement, kinds and triggers, set keys, split, aliases
- [reference/formatting.md](reference/formatting.md) - reading and rendering the drawing, format commands, selectors
- [reference/camunda7.md](reference/camunda7.md) - Camunda 7 / CIB seven / Operaton recipes and the C7 profile
- [reference/camunda8.md](reference/camunda8.md) - Camunda 8 (Zeebe) recipes and the C8 profile
- [reference/recipes.md](reference/recipes.md) - complete sessions: order-to-cash from scratch in one batch, a safe change to a drawn model, review feedback, a C7 external task, a C8 job worker
- [reference/migration.md](reference/migration.md) - from the 0.x CLI to 1.0: what replaces each retired command, flag and op key
