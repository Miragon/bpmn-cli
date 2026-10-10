# Recipes: complete sessions

Each recipe is a sequence of real commands; they build on each other in one
directory (recipe 1 creates `order-to-cash.bpmn`, recipes 2 and 3 change it).
Batches are piped in with `printf '%s' '<json>' | bpmn apply <file> -`: the
single quotes keep `${...}` expressions away from the shell (write an
apostrophe inside the JSON as `\u0027`). Read every result before the next
step (see "Read the result" in SKILL.md).

## 1. Order-to-cash from scratch, in one batch

Pools, lanes, the happy path, a rejection branch and message flows to a
customer pool: one `new`, one `apply`, one `validate`. Every element gets an
explicit speaking id, so later ops (and later sessions) can refer to it.

```bash
bpmn new order-to-cash.bpmn --name "Order to cash" --id Process_OrderToCash
printf '%s' '[
  { "op": "add", "kind": "participant", "name": "Order to cash", "id": "Participant_OrderToCash" },
  { "op": "add", "kind": "participant", "name": "Customer", "id": "Participant_Customer", "blackBox": true },
  { "op": "add", "kind": "lane", "name": "Sales", "id": "Lane_Sales", "in": "Participant_OrderToCash" },
  { "op": "add", "kind": "lane", "name": "Warehouse", "id": "Lane_Warehouse", "in": "Participant_OrderToCash" },
  { "op": "add", "kind": "lane", "name": "Accounting", "id": "Lane_Accounting", "in": "Participant_OrderToCash" },

  { "op": "add", "kind": "startEvent:message", "name": "Order received", "id": "Event_OrderReceived", "message": "Order", "in": "Participant_OrderToCash", "lane": "Lane_Sales" },
  { "op": "add", "kind": "userTask", "name": "Check order", "id": "Activity_CheckOrder", "after": "Event_OrderReceived", "lane": "Lane_Sales" },
  { "op": "add", "kind": "exclusiveGateway", "name": "Order ok?", "id": "Gateway_OrderOk", "after": "Activity_CheckOrder", "lane": "Lane_Sales" },
  { "op": "add", "kind": "userTask", "name": "Pick and pack goods", "id": "Activity_PickAndPackGoods", "after": "Gateway_OrderOk", "flowName": "yes", "condition": "${orderOk}", "lane": "Lane_Warehouse" },
  { "op": "add", "kind": "userTask", "name": "Ship goods", "id": "Activity_ShipGoods", "after": "Activity_PickAndPackGoods", "lane": "Lane_Warehouse" },
  { "op": "add", "kind": "sendTask", "name": "Send invoice", "id": "Activity_SendInvoice", "after": "Activity_ShipGoods", "lane": "Lane_Accounting" },
  { "op": "add", "kind": "receiveTask", "name": "Receive payment", "id": "Activity_ReceivePayment", "message": "Payment", "after": "Activity_SendInvoice", "lane": "Lane_Accounting" },
  { "op": "add", "kind": "endEvent", "name": "Order completed", "id": "Event_OrderCompleted", "after": "Activity_ReceivePayment", "lane": "Lane_Accounting" },
  { "op": "add", "kind": "sendTask", "name": "Send rejection", "id": "Activity_SendRejection", "after": "Gateway_OrderOk", "flowName": "no", "default": true, "lane": "Lane_Sales" },
  { "op": "add", "kind": "endEvent", "name": "Order rejected", "id": "Event_OrderRejected", "after": "Activity_SendRejection", "lane": "Lane_Sales" },

  { "op": "connect", "source": "Participant_Customer", "target": "Event_OrderReceived", "name": "Order", "id": "Flow_CustomerToOrderReceived" },
  { "op": "connect", "source": "Activity_SendRejection", "target": "Participant_Customer", "name": "Rejection", "id": "Flow_SendRejectionToCustomer" },
  { "op": "connect", "source": "Activity_SendInvoice", "target": "Participant_Customer", "name": "Invoice", "id": "Flow_SendInvoiceToCustomer" },
  { "op": "connect", "source": "Participant_Customer", "target": "Activity_ReceivePayment", "name": "Payment", "id": "Flow_CustomerToReceivePayment" }
]' | bpmn apply order-to-cash.bpmn - --summary
bpmn validate order-to-cash.bpmn --strict
bpmn show order-to-cash.bpmn
```

Notes:

- The first `participant` wraps the existing process; the customer is a black
  box (no process). Lanes go `in` the pool; every node names its `lane`.
- Sequence flows get speaking ids from their ends
  (`Flow_CheckOrderToOrderOk`); message flows here got explicit ones.
- The first outgoing flow of a gateway that leads on (or the default flow)
  continues straight; `bpmn order <gatewayId> <flowIds...>` changes the order.
- `validate --strict` exits 0 only without warnings; the file has no engine
  platform, so only structure, lint and layout are checked.

## 2. Change a drawn model safely

A model drawn by hand (Camunda Modeler, bpmn.io) must keep its drawing. Orient
on the spots you change, dry-run the batch with `--layout incremental` (that
mode refuses to redraw instead of redrawing), apply it, and check that no
layout problem was added.

```bash
bpmn show order-to-cash.bpmn --around Gateway_OrderOk --depth 1
bpmn show order-to-cash.bpmn Activity_ReceivePayment --context
bpmn show order-to-cash.bpmn --layout
printf '%s' '[
  { "op": "add", "kind": "userTask", "name": "Check credit limit", "id": "Activity_CheckCreditLimit", "flow": "Flow_CheckOrderToOrderOk", "lane": "Lane_Sales" },
  { "op": "add", "kind": "boundaryEvent:timer", "name": "14 days", "id": "Event_PaymentOverdue", "on": "Activity_ReceivePayment", "timer": "P14D", "nonInterrupting": true },
  { "op": "add", "kind": "sendTask", "name": "Send payment reminder", "id": "Activity_SendPaymentReminder", "after": "Event_PaymentOverdue", "lane": "Lane_Accounting" },
  { "op": "add", "kind": "endEvent", "name": "Reminder sent", "id": "Event_ReminderSent", "after": "Activity_SendPaymentReminder", "lane": "Lane_Accounting" },
  { "op": "connect", "source": "Activity_SendPaymentReminder", "target": "Participant_Customer", "name": "Reminder", "id": "Flow_SendPaymentReminderToCustomer" }
]' | bpmn apply order-to-cash.bpmn - --dry-run --layout incremental
```

The dry run prints exactly what the write will do: the created ids, the flow
that was split (`flow` splices into it; it keeps its name and condition, and a
flow whose id named its old ends is renamed, here
`Flow_CheckOrderToOrderOk -> Flow_CheckOrderToCheckCreditLimit`), what the
layout `placed` / `moved` / `rerouted`, and `layout quality: a -> b` with any
`added:` problem. When it looks right, run the same batch without `--dry-run`:

```bash
printf '%s' '[
  { "op": "add", "kind": "userTask", "name": "Check credit limit", "id": "Activity_CheckCreditLimit", "flow": "Flow_CheckOrderToOrderOk", "lane": "Lane_Sales" },
  { "op": "add", "kind": "boundaryEvent:timer", "name": "14 days", "id": "Event_PaymentOverdue", "on": "Activity_ReceivePayment", "timer": "P14D", "nonInterrupting": true },
  { "op": "add", "kind": "sendTask", "name": "Send payment reminder", "id": "Activity_SendPaymentReminder", "after": "Event_PaymentOverdue", "lane": "Lane_Accounting" },
  { "op": "add", "kind": "endEvent", "name": "Reminder sent", "id": "Event_ReminderSent", "after": "Activity_SendPaymentReminder", "lane": "Lane_Accounting" },
  { "op": "connect", "source": "Activity_SendPaymentReminder", "target": "Participant_Customer", "name": "Reminder", "id": "Flow_SendPaymentReminderToCustomer" }
]' | bpmn apply order-to-cash.bpmn - --layout incremental
bpmn metrics order-to-cash.bpmn
bpmn validate order-to-cash.bpmn
```

- `flow` splices into one specific flow; `after` a gateway appends a new
  branch instead, and `after` a node with several outgoing flows is
  `E_HAS_SUCCESSOR`.
- Name the `lane` of every new node in a model with lanes. Without it the node
  inherits a lane and the result warns (`W_LANE_INHERITED`) when that is a guess.
  A boundary event lives in the lane of its host.
- `nonInterrupting: true` keeps the task running when the timer fires; an
  interrupting timer cancels it.
- If the result says `added: <problem> [ids]`, fix that spot with a format
  command ([formatting.md](formatting.md)), or report it - do not redraw the
  user's diagram.

## 3. Apply review feedback in one batch

Review comments become one batch: rename, document, retype, retime, remove,
change a lane. `retype` keeps the id, name, flows and extensions; `remove`
bridges a node with one incoming and one outgoing flow (its predecessor is
connected to its successor).

```bash
printf '%s' '[
  { "op": "set", "id": "Activity_CheckOrder", "values": { "name": "Check order and stock", "doc": "Sales checks prices, terms and stock." } },
  { "op": "retype", "id": "Activity_ShipGoods", "kind": "serviceTask" },
  { "op": "set", "id": "Event_PaymentOverdue", "values": { "timer": "P10D", "name": "10 days" } },
  { "op": "remove", "ids": ["Activity_CheckCreditLimit"] },
  { "op": "move", "ids": ["Activity_SendInvoice"], "lane": "Lane_Sales" }
]' | bpmn apply order-to-cash.bpmn - --summary
bpmn validate order-to-cash.bpmn
bpmn show order-to-cash.bpmn --around Activity_SendInvoice --depth 1
```

- `--summary` lists `created <kind>: ids`, `changed:`, `renamed:`, `removed:`,
  the added warnings and one layout line. Here the bridge renamed
  `Flow_CheckOrderToCheckCreditLimit` back to `Flow_CheckOrderToOrderOk`.
- `move` with only `lane` changes the lane; with `after` / `before` / `flow` it
  moves the node to another place in the flow (bridging the old one).

## 4. Camunda 7: external task with input and error mapping

```bash
bpmn new payment.bpmn --name "Payment" --id Process_Payment --target camunda7
printf '%s' '[
  { "op": "add", "kind": "startEvent", "name": "Payment requested", "id": "Event_PaymentRequested", "in": "Process_Payment" },
  { "op": "add", "kind": "serviceTask", "name": "Charge credit card", "id": "Activity_ChargeCreditCard", "after": "Event_PaymentRequested" },
  { "op": "add", "kind": "endEvent", "name": "Payment received", "id": "Event_PaymentReceived", "after": "Activity_ChargeCreditCard" },
  { "op": "set", "id": "Activity_ChargeCreditCard", "values": { "camunda:type": "external", "camunda:topic": "charge-credit-card" } },
  { "op": "ext", "id": "Activity_ChargeCreditCard", "action": "add", "type": "camunda:inputParameter", "attrs": { "name": "amount" }, "body": "${order.total}" },
  { "op": "add", "kind": "boundaryEvent:error", "name": "Card declined", "id": "Event_CardDeclined", "on": "Activity_ChargeCreditCard", "error": "Card declined", "errorCode": "CARD_DECLINED" },
  { "op": "add", "kind": "userTask", "name": "Inform customer", "id": "Activity_InformCustomer", "after": "Event_CardDeclined" },
  { "op": "add", "kind": "endEvent", "name": "Payment failed", "id": "Event_PaymentFailed", "after": "Activity_InformCustomer" },
  { "op": "ext", "id": "Activity_ChargeCreditCard", "action": "add", "type": "camunda:errorEventDefinition", "attrs": { "id": "ErrorMapping_CardDeclined", "errorRef": "Error_CardDeclined", "expression": "${declined}" } }
]' | bpmn apply payment.bpmn - --summary
bpmn validate payment.bpmn --strict
bpmn ext list payment.bpmn Activity_ChargeCreditCard
```

- `--target camunda7` writes the namespaces, the platform version and
  `camunda:historyTimeToLive=180` (the engines refuse an executable process
  without it).
- `camunda:inputParameter` is filed into a `camunda:inputOutput` container that
  is created when missing.
- The error boundary event creates the root error `Error_CardDeclined` (its id
  comes from the name; the result line `created error ...` names it), which the
  external task's `camunda:errorEventDefinition` references with `errorRef`, so
  that op comes after the boundary event.
- Details and more Camunda 7 settings: reference/camunda7.md.

## 5. Camunda 8: job worker with mappings, headers and a message

```bash
bpmn new shipping.bpmn --name "Shipping" --id Process_Shipping --target camunda8
printf '%s' '[
  { "op": "add", "kind": "startEvent", "name": "Order paid", "id": "Event_OrderPaid", "in": "Process_Shipping" },
  { "op": "add", "kind": "serviceTask", "name": "Create shipping label", "id": "Activity_CreateShippingLabel", "after": "Event_OrderPaid" },
  { "op": "ext", "id": "Activity_CreateShippingLabel", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "create-shipping-label", "retries": "5" } },
  { "op": "ext", "id": "Activity_CreateShippingLabel", "action": "add", "type": "zeebe:input", "attrs": { "source": "=order.address", "target": "address" } },
  { "op": "ext", "id": "Activity_CreateShippingLabel", "action": "add", "type": "zeebe:output", "attrs": { "source": "=labelId", "target": "shippingLabelId" } },
  { "op": "ext", "id": "Activity_CreateShippingLabel", "action": "add", "type": "zeebe:header", "attrs": { "key": "carrier", "value": "dhl" } },
  { "op": "add", "kind": "receiveTask", "name": "Wait for pickup", "id": "Activity_WaitForPickup", "message": "ParcelPickedUp", "after": "Activity_CreateShippingLabel" },
  { "op": "ext", "id": "Message_ParcelPickedUp", "action": "add", "type": "zeebe:subscription", "attrs": { "correlationKey": "=orderId" } },
  { "op": "add", "kind": "endEvent", "name": "Order shipped", "id": "Event_OrderShipped", "after": "Activity_WaitForPickup" },
  { "op": "add", "kind": "boundaryEvent:error", "name": "Address invalid", "id": "Event_AddressInvalid", "on": "Activity_CreateShippingLabel", "error": "Address invalid", "errorCode": "ADDRESS_INVALID" },
  { "op": "add", "kind": "userTask", "name": "Correct address", "id": "Activity_CorrectAddress", "after": "Event_AddressInvalid" },
  { "op": "ext", "id": "Activity_CorrectAddress", "action": "add", "type": "zeebe:assignmentDefinition", "attrs": { "candidateGroups": "logistics" } },
  { "op": "add", "kind": "endEvent", "name": "Shipping stopped", "id": "Event_ShippingStopped", "after": "Activity_CorrectAddress" }
]' | bpmn apply shipping.bpmn - --summary
bpmn validate shipping.bpmn --strict
bpmn show shipping.bpmn --around Activity_CreateShippingLabel --depth 1
```

- `zeebe:input` / `zeebe:output` go into `zeebe:ioMapping`, `zeebe:header` into
  `zeebe:taskHeaders`; an item with the same target / key replaces the old one.
- The receive task creates `Message_ParcelPickedUp` from the message name; the
  subscription's correlation key goes on that message.
- New user tasks of a Camunda 8 file are Camunda user tasks (`zeebe:userTask`).
- Details and more Camunda 8 settings: reference/camunda8.md.
