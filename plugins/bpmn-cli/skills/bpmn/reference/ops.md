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
| add | **kind**, name, id, as, flowAs, after, before, flow, in, on, to, lane, flowName, flowId, condition, language, default, trigger keys, collapsed, ifAbsent, doc, set, process, blackBox, text, members |
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

Give every created element an explicit speaking `id` (`Activity_<VerbObject>`,
`Gateway_<Question>`, `Event_<State>`, `Lane_<Role>`, `Participant_<Party>`,
`DataObjectReference_<Thing>`, `DataStoreReference_<Thing>`,
`TextAnnotation_<Gist>`); later ops of the batch use it directly. Flow ids the
CLI derives speak too (`Flow_CheckInvoiceToBookInvoice`). For an element you do
not name, set an alias - `"as"` on add / connect / split and split nodes,
`"flowAs"` for the flow into a new node, `"joinAs"` for a split's join - and use
`"$alias"` wherever an id goes (also inside `values` for `default`, `source`,
`target`, `lane`). The result prints `aliases: $x = <id>`.

## A first batch: split, aliases, end

```bash
bpmn new invoice.bpmn --name "Invoice approval" --id Process_InvoiceApproval
printf '%s' '[
  { "op": "add", "kind": "startEvent", "name": "Invoice received", "id": "Event_InvoiceReceived", "in": "Process_InvoiceApproval" },
  { "op": "add", "kind": "userTask", "name": "Check invoice", "id": "Activity_CheckInvoice", "after": "Event_InvoiceReceived" },
  { "op": "split", "after": "Activity_CheckInvoice", "kind": "exclusiveGateway", "name": "Invoice ok?", "id": "Gateway_InvoiceOk", "joinId": "Gateway_InvoiceOkJoin",
    "branches": [
      { "flowName": "yes", "condition": "${invoiceOk}", "nodes": [ { "kind": "serviceTask", "name": "Book invoice", "id": "Activity_BookInvoice" } ] },
      { "flowName": "no", "nodes": [ { "kind": "userTask", "name": "Clarify invoice", "id": "Activity_ClarifyInvoice", "flowAs": "$toClarify" },
                                       { "kind": "sendTask", "name": "Inform supplier", "id": "Activity_InformSupplier" } ] }
    ] },
  { "op": "set", "id": "Gateway_InvoiceOk", "values": { "default": "$toClarify" } },
  { "op": "add", "kind": "endEvent", "name": "Invoice handled", "id": "Event_InvoiceHandled", "after": "Gateway_InvoiceOkJoin" }
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

Data objects, data stores, annotations, lanes and pools take `in` only.

```bash
printf '%s' '[
  { "op": "add", "kind": "dataObject", "name": "Invoice", "id": "DataObjectReference_Invoice", "in": "Process_InvoiceApproval" },
  { "op": "connect", "source": "DataObjectReference_Invoice", "target": "Activity_CheckInvoice" },
  { "op": "add", "kind": "dataStore", "name": "Ledger", "id": "DataStoreReference_Ledger", "in": "Process_InvoiceApproval" },
  { "op": "connect", "source": "Activity_BookInvoice", "target": "DataStoreReference_Ledger" },
  { "op": "add", "kind": "boundaryEvent:timer", "name": "5 days", "id": "Event_ClarificationOverdue", "on": "Activity_ClarifyInvoice", "timer": "P5D" },
  { "op": "add", "kind": "endEvent", "name": "Invoice returned", "id": "Event_InvoiceReturned", "after": "Event_ClarificationOverdue" },
  { "op": "add", "kind": "subProcess", "name": "Archive invoice", "id": "Activity_ArchiveInvoice", "before": "Event_InvoiceHandled" },
  { "op": "add", "kind": "startEvent", "name": "Archiving started", "id": "Event_ArchivingStarted", "in": "Activity_ArchiveInvoice" },
  { "op": "add", "kind": "serviceTask", "name": "Store PDF", "id": "Activity_StorePdf", "after": "Event_ArchivingStarted" },
  { "op": "add", "kind": "endEvent", "name": "Archived", "id": "Event_Archived", "after": "Activity_StorePdf" }
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
  { "op": "set", "id": "Activity_CheckInvoice", "values": { "name": "Check invoice and order", "doc": "Compare the invoice with the purchase order." } },
  { "op": "set", "id": "Activity_StorePdf", "values": { "loop": "parallel", "cardinality": "${count}" } },
  { "op": "retype", "id": "Event_InvoiceReceived", "kind": "startEvent:message", "message": "Invoice" },
  { "op": "retype", "id": "Activity_BookInvoice", "kind": "scriptTask" },
  { "op": "remove", "ids": ["Activity_InformSupplier"] },
  { "op": "add", "kind": "endEvent", "name": "Invoice handled", "id": "Event_InvoiceHandled", "ifAbsent": true, "in": "Process_InvoiceApproval" },
  { "op": "remove", "ids": ["Activity_PayInvoice"], "ifExists": true }
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
`exclusiveGateway`, `parallelGateway`, `inclusiveGateway`, `eventBasedGateway`
(name exclusive gateways as a question, name their branches). Events:
`startEvent`, `endEvent`, `intermediateCatchEvent`, `intermediateThrowEvent`,
`boundaryEvent` with `:message`, `:timer`, `:error`, `:signal`, `:escalation`,
`:conditional`, `:link`, `:compensate`, `:terminate`, `:cancel` - which trigger
fits which event: `bpmn kinds --section kinds,triggers`. Timers are ISO 8601:
`PT2H` / `P3D` (duration), `R/PT1H` (cycle), a date-time (date). Messages,
errors, signals and escalations are root elements found by name or created
(`Message_<Name>`, `Error_<Name>`); the result names them.
