# Ops JSON, placement, kinds and set keys

The essentials for writing `bpmn apply` batches. The CLI is the reference:
`bpmn guide ops`, `bpmn guide placement`, `bpmn kinds --section ops --json`
(the JSON Schema of every op), `bpmn kinds --section kinds,triggers,setKeys,nestedKeys`.
The examples build `invoice.bpmn` from scratch and run in order.

## Batch format

- A JSON array of ops, or `{"ops": [...]}`; from a file (`bpmn apply f.bpmn ops.json`)
  or stdin (`printf '%s' '[...]' | bpmn apply f.bpmn -`). With `-` as the model
  file the model comes from stdin and the result goes to stdout.
- Every op is `{"op": "<name>", ...}` with the flags of the matching command in
  lowerCamelCase (`--flow-name` -> `flowName`, `--non-interrupting` ->
  `nonInterrupting`, `--if-absent` -> `ifAbsent`).
- Order: the whole batch is checked first (unknown op / key, wrong type,
  conflicting placement, undefined alias: nothing runs), then the semantic ops
  run in order, then validation and one layout, then the format ops in order,
  then one write. Any failure writes nothing and names the op (`ops[3] (add): ...`).
- Keep the JSON in single quotes so `${...}` reaches the CLI unchanged; an
  apostrophe inside it is `\u0027`. `printf '%s'` passes it on byte for byte
  (`echo` may interpret backslashes in some shells), and a heredoc holding JSON
  makes Claude Code ask for permission even when `bpmn` is pre-approved.

| op | keys (required in bold) |
| --- | --- |
| add | **kind**, name, id, as, flowAs, outAs, after, before, flow, in, on, to, lane, flowName, flowId, condition, language, default, trigger keys, collapsed, ifAbsent, doc, set, process, blackBox, text, members |
| connect | **source**, **target**, name, id, as, condition, language, default, message, ifAbsent |
| set | **id**, values (map), unset (list) |
| remove | **ids**, bridge, bridgeAll, withBranch, ifExists |
| retype | **id**, **kind**, trigger keys |
| move | **ids**, after, before, flow, in, on, lane, flow keys |
| order | **id**, one of flows / lanes / pools |
| ext | **id**, **action** (add / remove), type, attrs, body, xml, replace, index, slot |
| split | **after**, **branches**, kind, name, id, as, join, joinId, joinAs, joinName |
| place, align, color, label, route, space, tidy, compact | see [formatting.md](formatting.md) |

Trigger keys: `timer`, `timerKind`, `message`, `error`, `errorCode`, `signal`,
`escalation`, `escalationCode`, `when`, `link`, `nonInterrupting`.

## Ids and aliases

Give every created element an explicit speaking `id` in the patterns
`bpmn show <file> --conventions` lists; without a `.bpmnlintrc` these are
`element-id-naming`'s defaults (`serviceTask_<verbObject>`, `userTask_<verbObject>`,
`gateway_<question>`, `startEvent_<state>`, `endEvent_<state>`, `event_<state>`,
`lane_<role>`, `participant_<party>`, `dataObject_<thing>`, `dataStore_<thing>`,
`textAnnotation_<gist>`); later ops of the batch use it directly. Flow ids the
CLI derives speak too (`flow_checkInvoiceToBookInvoice`). For an element you do
not name, set an alias - `"as"` on add / connect / split and split nodes,
`"flowAs"` for the flow into a new node, `"outAs"` for the flow an add creates
out of it (on a splice: to the old successor, so the same batch can set its
condition), `"joinAs"` for a split's join - and use
`"$alias"` wherever an id goes (also inside `values` for `default`, `source`,
`target`, `lane`). The result prints `aliases: $x = <id>`. An alias follows
its element through a rename and a retype, so create, retype, then configure
works in one batch.

## A first batch: split, aliases, end

```bash
bpmn new invoice.bpmn --name "Invoice approval" --id invoiceApproval
printf '%s' '[
  { "op": "add", "kind": "startEvent", "name": "Invoice received", "id": "startEvent_invoiceReceived", "in": "invoiceApproval" },
  { "op": "add", "kind": "userTask", "name": "Check invoice", "id": "userTask_checkInvoice", "after": "startEvent_invoiceReceived" },
  { "op": "split", "after": "userTask_checkInvoice", "kind": "exclusiveGateway", "name": "Invoice ok?", "id": "gateway_invoiceOk", "joinId": "gateway_invoiceOkJoin",
    "branches": [
      { "flowName": "yes", "condition": "${invoiceOk}", "nodes": [ { "kind": "serviceTask", "name": "Book invoice", "id": "serviceTask_bookInvoice" } ] },
      { "flowName": "no", "nodes": [ { "kind": "userTask", "name": "Clarify invoice", "id": "userTask_clarifyInvoice", "flowAs": "$toClarify" },
                                       { "kind": "sendTask", "name": "Inform supplier", "id": "sendTask_informSupplier" } ] }
    ] },
  { "op": "set", "id": "gateway_invoiceOk", "values": { "default": "$toClarify" } },
  { "op": "add", "kind": "endEvent", "name": "Invoice handled", "id": "endEvent_invoiceHandled", "after": "gateway_invoiceOkJoin" }
]' | bpmn apply invoice.bpmn -
bpmn show invoice.bpmn
```

- `split` places the gateway after the anchor (splicing into its single
  outgoing flow if it has one), chains each branch's nodes, and joins all
  branches in a join gateway of the same kind (`"join": false` for none).
- A branch's `flowName` / `condition` / `default` describe the flow from the
  gateway into its first node.

## Placement

| key | effect |
| --- | --- |
| `after` X | X is a gateway or has no outgoing flow: append X -> node. X has one outgoing flow: splice into it. Several: `E_HAS_SUCCESSOR` |
| `before` Y | prepend before a join or a node without incoming flow, else splice into Y's single incoming flow |
| `after` X + `before` Y | splice into the flow X -> Y |
| `flow` F | splice into sequence flow F (it keeps name and condition and ends at the new node) |
| `in` S | unconnected in process / sub-process / pool S; connect it afterwards |
| `on` A | boundary events only: attach to activity A |
| `to` T | also connect the new node to T (a branch that rejoins) |

Data objects, data stores, annotations, lanes and pools take `in` only. A group takes
no placement: `members` names what it is drawn around.

```bash
printf '%s' '[
  { "op": "add", "kind": "dataObject", "name": "Invoice", "id": "dataObject_invoice", "in": "invoiceApproval" },
  { "op": "connect", "source": "dataObject_invoice", "target": "userTask_checkInvoice" },
  { "op": "add", "kind": "dataStore", "name": "Ledger", "id": "dataStore_ledger", "in": "invoiceApproval" },
  { "op": "connect", "source": "serviceTask_bookInvoice", "target": "dataStore_ledger" },
  { "op": "add", "kind": "boundaryEvent:timer", "name": "5 days", "id": "event_clarificationOverdue", "on": "userTask_clarifyInvoice", "timer": "P5D" },
  { "op": "add", "kind": "endEvent", "name": "Invoice returned", "id": "endEvent_invoiceReturned", "after": "event_clarificationOverdue" },
  { "op": "add", "kind": "subProcess", "name": "Archive invoice", "id": "subProcess_archiveInvoice", "before": "endEvent_invoiceHandled" },
  { "op": "add", "kind": "startEvent", "name": "Archiving started", "id": "startEvent_archivingStarted", "in": "subProcess_archiveInvoice" },
  { "op": "add", "kind": "serviceTask", "name": "Store PDF", "id": "serviceTask_storePdf", "after": "startEvent_archivingStarted" },
  { "op": "add", "kind": "endEvent", "name": "Archived", "id": "endEvent_archived", "after": "serviceTask_storePdf" }
]' | bpmn apply invoice.bpmn - --summary
```

- `connect` infers the connection: data object -> task is a data input
  association, task -> data store a data output association, node -> node a
  sequence flow, across pools a message flow, annotation -> element an
  association.
- An interrupting boundary event (no `nonInterrupting`) cancels the task.

## Change, retype, remove

```bash
printf '%s' '[
  { "op": "set", "id": "userTask_checkInvoice", "values": { "name": "Check invoice and order", "doc": "Compare the invoice with the purchase order." } },
  { "op": "set", "id": "serviceTask_storePdf", "values": { "loop": "parallel", "cardinality": "${count}" } },
  { "op": "retype", "id": "startEvent_invoiceReceived", "kind": "startEvent:message", "message": "Invoice" },
  { "op": "retype", "id": "serviceTask_bookInvoice", "kind": "scriptTask" },
  { "op": "remove", "ids": ["sendTask_informSupplier"] },
  { "op": "add", "kind": "endEvent", "name": "Invoice handled", "id": "endEvent_invoiceHandled", "ifAbsent": true, "in": "invoiceApproval" },
  { "op": "remove", "ids": ["serviceTask_payInvoice"], "ifExists": true }
]' | bpmn apply invoice.bpmn - --summary
bpmn validate invoice.bpmn
```

- `set`: `name`, `doc`, `condition` / `default` (flows), `lane`, `timer` /
  `message` / `error` / ... (events), `loop` (`standard`, `parallel`,
  `sequential`, `none`), `cardinality`, `completion`, `calledElement`, any BPMN
  attribute by property name, vendor attributes with their prefix
  (`camunda:assignee`); `key=` / `"unset": ["key"]` removes. Nested elements:
  `definition.<key>`, `loop.<key>`, `condition.<key>`. Every key per element:
  `bpmn kinds --section setKeys,nestedKeys`.
- `retype` keeps id, name, flows and extensions; `kind:none` drops a trigger;
  a sub-process with content becomes a task only with `--force`.
- `remove` takes connected flows, boundary events and associations along and
  bridges a node with one incoming and one outgoing flow; `"bridge": false`
  leaves the gap, `"withBranch": true` also removes the path only that node
  leads to, `"bridgeAll": true` connects every predecessor of a join to its
  successor.
- `ifAbsent` (with an explicit id) and `ifExists` make a batch safe to re-run.

## Kinds and triggers (short)

Tasks: `task`, `userTask`, `serviceTask`, `sendTask`, `receiveTask`,
`scriptTask`, `manualTask`, `businessRuleTask`. Sub-processes: `subProcess`,
`eventSubProcess:<trigger>` (with its start event), `adHocSubProcess`,
`transaction`; `callActivity` (`set calledElement=<processId>`). Gateways:
`exclusiveGateway`, `parallelGateway`, `inclusiveGateway`, `complexGateway`, `eventBasedGateway`
(name exclusive gateways as a question, name their branches). Events:
`startEvent`, `endEvent`, `intermediateCatchEvent`, `intermediateThrowEvent`,
`boundaryEvent` with `:message`, `:timer`, `:error`, `:signal`, `:escalation`,
`:conditional`, `:link`, `:compensate`, `:terminate`, `:cancel` - which trigger
fits which event: `bpmn kinds --section kinds,triggers`. Timers are ISO 8601:
`PT2H` / `P3D` (duration), `R/PT1H` (cycle), a date-time (date). Messages,
errors, signals and escalations are root elements found by name or created
(ids like `message_<name>`); never guess those ids: name
them in a batch with `"refAs": "$name"` on add / connect / set / retype, and the
result lists them.
