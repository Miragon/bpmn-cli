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
bpmn new order-to-cash.bpmn --name "Order to cash" --id orderToCash
printf '%s' '[
  { "op": "add", "kind": "participant", "name": "Order to cash", "id": "participant_orderToCash" },
  { "op": "add", "kind": "participant", "name": "Customer", "id": "participant_customer", "blackBox": true },
  { "op": "add", "kind": "lane", "name": "Sales", "id": "lane_sales", "in": "participant_orderToCash" },
  { "op": "add", "kind": "lane", "name": "Warehouse", "id": "lane_warehouse", "in": "participant_orderToCash" },
  { "op": "add", "kind": "lane", "name": "Accounting", "id": "lane_accounting", "in": "participant_orderToCash" },

  { "op": "add", "kind": "startEvent:message", "name": "Order received", "id": "startEvent_orderReceived", "message": "Order", "in": "participant_orderToCash", "lane": "lane_sales" },
  { "op": "add", "kind": "userTask", "name": "Check order", "id": "userTask_checkOrder", "after": "startEvent_orderReceived", "lane": "lane_sales" },
  { "op": "add", "kind": "exclusiveGateway", "name": "Order ok?", "id": "gateway_orderOk", "after": "userTask_checkOrder", "lane": "lane_sales" },
  { "op": "add", "kind": "userTask", "name": "Pick and pack goods", "id": "userTask_pickAndPackGoods", "after": "gateway_orderOk", "flowName": "yes", "condition": "${orderOk}", "lane": "lane_warehouse" },
  { "op": "add", "kind": "userTask", "name": "Ship goods", "id": "userTask_shipGoods", "after": "userTask_pickAndPackGoods", "lane": "lane_warehouse" },
  { "op": "add", "kind": "sendTask", "name": "Send invoice", "id": "sendTask_sendInvoice", "after": "userTask_shipGoods", "lane": "lane_accounting" },
  { "op": "add", "kind": "receiveTask", "name": "Receive payment", "id": "receiveTask_receivePayment", "message": "Payment", "after": "sendTask_sendInvoice", "lane": "lane_accounting" },
  { "op": "add", "kind": "endEvent", "name": "Order completed", "id": "endEvent_orderCompleted", "after": "receiveTask_receivePayment", "lane": "lane_accounting" },
  { "op": "add", "kind": "sendTask", "name": "Send rejection", "id": "sendTask_sendRejection", "after": "gateway_orderOk", "flowName": "no", "default": true, "lane": "lane_sales" },
  { "op": "add", "kind": "endEvent", "name": "Order rejected", "id": "endEvent_orderRejected", "after": "sendTask_sendRejection", "lane": "lane_sales" },

  { "op": "connect", "source": "participant_customer", "target": "startEvent_orderReceived", "name": "Order", "id": "messageFlow_customerToOrderReceived" },
  { "op": "connect", "source": "sendTask_sendRejection", "target": "participant_customer", "name": "Rejection", "id": "messageFlow_sendRejectionToCustomer" },
  { "op": "connect", "source": "sendTask_sendInvoice", "target": "participant_customer", "name": "Invoice", "id": "messageFlow_sendInvoiceToCustomer" },
  { "op": "connect", "source": "participant_customer", "target": "receiveTask_receivePayment", "name": "Payment", "id": "messageFlow_customerToReceivePayment" }
]' | bpmn apply order-to-cash.bpmn - --summary
bpmn validate order-to-cash.bpmn --strict
bpmn show order-to-cash.bpmn
```

Notes:

- The first `participant` wraps the existing process; the customer is a black
  box (no process). Lanes go `in` the pool; every node names its `lane`.
- Sequence flows get speaking ids from their ends
  (`flow_checkOrderToOrderOk`); message flows here got explicit ones.
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
bpmn show order-to-cash.bpmn --around gateway_orderOk --depth 1
bpmn show order-to-cash.bpmn receiveTask_receivePayment --context
bpmn show order-to-cash.bpmn --layout
printf '%s' '[
  { "op": "add", "kind": "userTask", "name": "Check credit limit", "id": "userTask_checkCreditLimit", "flow": "flow_checkOrderToOrderOk", "lane": "lane_sales" },
  { "op": "add", "kind": "boundaryEvent:timer", "name": "14 days", "id": "event_paymentOverdue", "on": "receiveTask_receivePayment", "timer": "P14D", "nonInterrupting": true },
  { "op": "add", "kind": "sendTask", "name": "Send payment reminder", "id": "sendTask_sendPaymentReminder", "after": "event_paymentOverdue", "lane": "lane_accounting" },
  { "op": "add", "kind": "endEvent", "name": "Reminder sent", "id": "endEvent_reminderSent", "after": "sendTask_sendPaymentReminder", "lane": "lane_accounting" },
  { "op": "connect", "source": "sendTask_sendPaymentReminder", "target": "participant_customer", "name": "Reminder", "id": "messageFlow_sendPaymentReminderToCustomer" }
]' | bpmn apply order-to-cash.bpmn - --dry-run --layout incremental
```

The dry run prints exactly what the write will do: the created ids, the flow
that was split (`flow` splices into it; it keeps its name and condition, and a
flow whose id named its old ends is renamed, here
`flow_checkOrderToOrderOk -> flow_checkOrderToCheckCreditLimit`), what the
layout `placed` / `moved` / `rerouted`, and `layout quality: a -> b` with any
`added:` problem. When it looks right, run the same batch without `--dry-run`:

```bash
printf '%s' '[
  { "op": "add", "kind": "userTask", "name": "Check credit limit", "id": "userTask_checkCreditLimit", "flow": "flow_checkOrderToOrderOk", "lane": "lane_sales" },
  { "op": "add", "kind": "boundaryEvent:timer", "name": "14 days", "id": "event_paymentOverdue", "on": "receiveTask_receivePayment", "timer": "P14D", "nonInterrupting": true },
  { "op": "add", "kind": "sendTask", "name": "Send payment reminder", "id": "sendTask_sendPaymentReminder", "after": "event_paymentOverdue", "lane": "lane_accounting" },
  { "op": "add", "kind": "endEvent", "name": "Reminder sent", "id": "endEvent_reminderSent", "after": "sendTask_sendPaymentReminder", "lane": "lane_accounting" },
  { "op": "connect", "source": "sendTask_sendPaymentReminder", "target": "participant_customer", "name": "Reminder", "id": "messageFlow_sendPaymentReminderToCustomer" }
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
  { "op": "set", "id": "userTask_checkOrder", "values": { "name": "Check order and stock", "doc": "Sales checks prices, terms and stock." } },
  { "op": "retype", "id": "userTask_shipGoods", "kind": "serviceTask" },
  { "op": "set", "id": "event_paymentOverdue", "values": { "timer": "P10D", "name": "10 days" } },
  { "op": "remove", "ids": ["userTask_checkCreditLimit"] },
  { "op": "move", "ids": ["sendTask_sendInvoice"], "lane": "lane_sales" }
]' | bpmn apply order-to-cash.bpmn - --summary
bpmn validate order-to-cash.bpmn
bpmn show order-to-cash.bpmn --around sendTask_sendInvoice --depth 1
```

- `--summary` lists `created <kind>: ids`, `changed:`, `renamed:`, `removed:`,
  the added warnings and one layout line. Here the bridge renamed
  `flow_checkOrderToCheckCreditLimit` back to `flow_checkOrderToOrderOk`.
- `move` with only `lane` changes the lane; with `after` / `before` / `flow` it
  moves the node to another place in the flow (bridging the old one).

## 4. Camunda 7: external task with input and error mapping

```bash
bpmn new payment.bpmn --name "Payment" --id payment --target camunda7
printf '%s' '[
  { "op": "add", "kind": "startEvent", "name": "Payment requested", "id": "startEvent_paymentRequested", "in": "payment" },
  { "op": "add", "kind": "serviceTask", "name": "Charge credit card", "id": "serviceTask_chargeCreditCard", "after": "startEvent_paymentRequested" },
  { "op": "add", "kind": "endEvent", "name": "Payment received", "id": "endEvent_paymentReceived", "after": "serviceTask_chargeCreditCard" },
  { "op": "set", "id": "serviceTask_chargeCreditCard", "values": { "camunda:type": "external", "camunda:topic": "charge-credit-card" } },
  { "op": "ext", "id": "serviceTask_chargeCreditCard", "action": "add", "type": "camunda:inputParameter", "attrs": { "name": "amount" }, "body": "${order.total}" },
  { "op": "add", "kind": "boundaryEvent:error", "name": "Card declined", "id": "event_cardDeclined", "on": "serviceTask_chargeCreditCard", "error": "Card declined", "errorCode": "CARD_DECLINED" },
  { "op": "add", "kind": "userTask", "name": "Inform customer", "id": "userTask_informCustomer", "after": "event_cardDeclined" },
  { "op": "add", "kind": "endEvent", "name": "Payment failed", "id": "endEvent_paymentFailed", "after": "userTask_informCustomer" },
  { "op": "ext", "id": "serviceTask_chargeCreditCard", "action": "add", "type": "camunda:errorEventDefinition", "attrs": { "id": "ErrorMapping_CardDeclined", "errorRef": "error_cardDeclined", "expression": "${declined}" } }
]' | bpmn apply payment.bpmn - --summary
bpmn validate payment.bpmn --strict
bpmn ext list payment.bpmn serviceTask_chargeCreditCard
```

- `--target camunda7` writes the namespaces, the platform version and
  `camunda:historyTimeToLive=180` (the engines refuse an executable process
  without it).
- `camunda:inputParameter` is filed into a `camunda:inputOutput` container that
  is created when missing.
- The error boundary event creates the root error `error_cardDeclined` (its id
  comes from the name; the result line `created error ...` names it), which the
  external task's `camunda:errorEventDefinition` references with `errorRef`, so
  that op comes after the boundary event.
- Details and more Camunda 7 settings: reference/camunda7.md.

## 5. Camunda 8: job worker with mappings, headers and a message

```bash
bpmn new shipping.bpmn --name "Shipping" --id shipping --target camunda8
printf '%s' '[
  { "op": "add", "kind": "startEvent", "name": "Order paid", "id": "startEvent_orderPaid", "in": "shipping" },
  { "op": "add", "kind": "serviceTask", "name": "Create shipping label", "id": "serviceTask_createShippingLabel", "after": "startEvent_orderPaid" },
  { "op": "ext", "id": "serviceTask_createShippingLabel", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "create-shipping-label", "retries": "5" } },
  { "op": "ext", "id": "serviceTask_createShippingLabel", "action": "add", "type": "zeebe:input", "attrs": { "source": "=order.address", "target": "address" } },
  { "op": "ext", "id": "serviceTask_createShippingLabel", "action": "add", "type": "zeebe:output", "attrs": { "source": "=labelId", "target": "shippingLabelId" } },
  { "op": "ext", "id": "serviceTask_createShippingLabel", "action": "add", "type": "zeebe:header", "attrs": { "key": "carrier", "value": "dhl" } },
  { "op": "add", "kind": "receiveTask", "name": "Wait for pickup", "id": "receiveTask_waitForPickup", "message": "ParcelPickedUp", "refAs": "$parcelPickedUp", "after": "serviceTask_createShippingLabel" },
  { "op": "ext", "id": "$parcelPickedUp", "action": "add", "type": "zeebe:subscription", "attrs": { "correlationKey": "=orderId" } },
  { "op": "add", "kind": "endEvent", "name": "Order shipped", "id": "endEvent_orderShipped", "after": "receiveTask_waitForPickup" },
  { "op": "add", "kind": "boundaryEvent:error", "name": "Address invalid", "id": "event_addressInvalid", "on": "serviceTask_createShippingLabel", "error": "Address invalid", "errorCode": "ADDRESS_INVALID" },
  { "op": "add", "kind": "userTask", "name": "Correct address", "id": "userTask_correctAddress", "after": "event_addressInvalid" },
  { "op": "ext", "id": "userTask_correctAddress", "action": "add", "type": "zeebe:assignmentDefinition", "attrs": { "candidateGroups": "logistics" } },
  { "op": "add", "kind": "endEvent", "name": "Shipping stopped", "id": "endEvent_shippingStopped", "after": "userTask_correctAddress" }
]' | bpmn apply shipping.bpmn - --summary
bpmn validate shipping.bpmn --strict
bpmn show shipping.bpmn --around serviceTask_createShippingLabel --depth 1
```

- `zeebe:input` / `zeebe:output` go into `zeebe:ioMapping`, `zeebe:header` into
  `zeebe:taskHeaders`; an item with the same target / key replaces the old one.
- The receive task creates the message from its name (`message_<name>`); `refAs` names it in the batch, so the subscription's
  correlation key goes on that message without guessing its id.
- New user tasks of a Camunda 8 file are Camunda user tasks (`zeebe:userTask`).
- Details and more Camunda 8 settings: reference/camunda8.md.
