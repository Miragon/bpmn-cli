# A worked session

From an empty file to a validated Camunda 8 model with two pools. The output is what the CLI
prints (wording may change between versions); a line `...` stands for output left out.

```
$ bpmn new order.bpmn --name "Order handling" --target camunda8
created process Process_OrderHandling "Order handling"
warning W_NO_END Process_OrderHandling: Process Process_OrderHandling has no end event  (Add one after the last node: `bpmn add <file> endEvent "<Name>" --after <nodeId>`.)
warning W_C8_DEPLOY_START_EVENT Process_OrderHandling: Process Process_OrderHandling has no start event; Camunda 8 refuses the file  (`bpmn add <file> startEvent "<Name>" --before <firstNodeId>` (or --in Process_OrderHandling).)
layout: ok - full (no diagram before: drawn from scratch)
layout quality: score 0
written: order.bpmn

$ bpmn add order.bpmn start "Order received"
...
$ bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived
created userTask Activity_CheckInvoice "Check invoice" - after Event_OrderReceived
created sequenceFlow Flow_OrderReceivedToCheckInvoice - Event_OrderReceived -> Activity_CheckInvoice
note: appended after Event_OrderReceived
note: Activity_CheckInvoice is a Camunda user task (zeebe:userTask), like Camunda Modeler creates them
warning W_DEAD_END Activity_CheckInvoice: userTask Activity_CheckInvoice "Check invoice" has no outgoing flow  (Continue the flow (`bpmn add <file> <kind> "<Name>" --after Activity_CheckInvoice`) or end it (`bpmn add <file> endEvent "<Name>" --after Activity_CheckInvoice`).)
resolved: W_DEAD_END Event_OrderReceived
1 warning already in the file (not repeated: `bpmn validate <file>` lists them)
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn add order.bpmn end "Invoice handled" --after Activity_CheckInvoice
...
```

Each result names the ids it created, and the next command uses them. A warning carries the
command that fixes it, and a later result says which warnings it resolved. Several related changes
go into one `bpmn apply` batch: one transaction, one layout pass. The `split` op inserts a gateway
with its branches and the join; an alias (`"as": "$book"`) names what an op creates for later ops.

```
$ cat > ops.json <<'EOF'
{ "ops": [
  { "op": "split", "after": "Activity_CheckInvoice", "name": "Invoice ok?",
    "branches": [
      { "flowName": "yes", "condition": "= ok", "nodes": [{ "kind": "serviceTask", "name": "Book invoice", "as": "$book" }] },
      { "flowName": "no", "default": true, "nodes": [{ "kind": "sendTask", "name": "Ask customer", "as": "$ask" }] } ] },
  { "op": "ext", "id": "$book", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "book-invoice" } }
] }
EOF
$ bpmn apply order.bpmn ops.json
created exclusiveGateway Gateway_InvoiceOk "Invoice ok?" - between Activity_CheckInvoice and Event_InvoiceHandled
...
changed sequenceFlow Flow_CheckInvoiceToInvoiceOk - Activity_CheckInvoice -> Gateway_InvoiceOk (was -> Event_InvoiceHandled) (renamed from Flow_CheckInvoiceToInvoiceHandled: its id named its old ends)
...
aliases: $book = Activity_BookInvoice, $ask = Activity_AskCustomer
warning W_C8_DEPLOY_IMPLEMENTATION Activity_AskCustomer: sendTask Activity_AskCustomer has no zeebe:taskDefinition (nor a zeebe:publishMessage): Camunda 8 needs the job type a worker subscribes to and refuses the file  (Give it a job type: `bpmn ext add <file> Activity_AskCustomer zeebe:taskDefinition type=<jobType>`.)
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn

$ bpmn ext add order.bpmn Activity_AskCustomer zeebe:taskDefinition type=ask-customer --summary
changed: Activity_AskCustomer
warnings: 0 added, 1 resolved, 0 already in the file
layout: full, score 0 -> 0
written: order.bpmn
```

The file targets Camunda 8, so the batch reports the send task without a job type, and the
`ext add` from the hint fixes it (`--summary`: changed ids, warning counts, one layout line).
Now the pools. The first participant must be a normal pool, because it wraps the existing process.
A `--black-box` pool never wraps: added first to a file without pools it fails with `E_VALIDATION`
(`E_EMPTY_COLLABORATION`, `E_ORPHAN_PROCESS`) and nothing is written.

```
$ bpmn add order.bpmn participant "Order handling"
created collaboration Collaboration_OrderHandling
created participant Participant_OrderHandling "Order handling" - wraps process Process_OrderHandling
note: collaboration Collaboration_OrderHandling created; Participant_OrderHandling wraps the existing process Process_OrderHandling
...
$ bpmn add order.bpmn participant "Customer" --black-box
created participant Participant_Customer "Customer" - black box (no process)
...
$ bpmn connect order.bpmn Activity_AskCustomer Participant_Customer --message Question
created message Message_Question "Question" - root element
created messageFlow Flow_AskCustomerToCustomer - Activity_AskCustomer -> Participant_Customer
...
$ bpmn show order.bpmn
namespaces: zeebe, modeler
collaboration Collaboration_OrderHandling
  participant Participant_OrderHandling "Order handling" = Process_OrderHandling
  participant Participant_Customer "Customer" (black box)
  messageFlow Flow_AskCustomerToCustomer: Activity_AskCustomer "Ask customer" -> Participant_Customer "Customer" [message Question]
process Process_OrderHandling "Order handling" executable in Participant_OrderHandling
  startEvent Event_OrderReceived "Order received" -> Activity_CheckInvoice (Flow_OrderReceivedToCheckInvoice)
  userTask Activity_CheckInvoice "Check invoice" [ext: zeebe:userTask] -> Gateway_InvoiceOk (Flow_CheckInvoiceToInvoiceOk)
  exclusiveGateway Gateway_InvoiceOk "Invoice ok?" -> Activity_BookInvoice (Flow_InvoiceOkToBookInvoice "yes" if = ok), Activity_AskCustomer (Flow_InvoiceOkToAskCustomer "no" default)
  serviceTask Activity_BookInvoice "Book invoice" [job=book-invoice, ext: zeebe:taskDefinition] -> Gateway_InvoiceOk_join (Flow_BookInvoiceToInvoiceOkJoin)
  exclusiveGateway Gateway_InvoiceOk_join -> Event_InvoiceHandled (Flow_InvoiceOkJoinToInvoiceHandled)
  endEvent Event_InvoiceHandled "Invoice handled"
  sendTask Activity_AskCustomer "Ask customer" [job=ask-customer, ext: zeebe:taskDefinition] -> Gateway_InvoiceOk_join (Flow_AskCustomerToInvoiceOkJoin)
root: message Message_Question "Question"
problems: none

$ bpmn validate order.bpmn
platform: c8 (modeler:executionPlatform "Camunda Cloud") - 0 refused at deploy, 0 runtime, 0 practice finding(s)
layout: ok
valid, 0 warning(s)
```

`show` prints the model in flow order without coordinates; every step redrew the diagram.
[Layout and formatting](layout.md) continues with this file and changes the drawing. See
[commands.md](commands.md) for every command, [ops.md](ops.md) for the batch format and
[camunda.md](camunda.md) for Camunda 7 and 8; `bpmn guide workflow` prints the steps in short.
