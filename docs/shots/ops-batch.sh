# ops.md: the result of the full example batch.
bpmn new order.bpmn "Order handling" --target camunda8
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Check invoice" --after startEvent_orderReceived
bpmn add order.bpmn end "Invoice handled" --after userTask_checkInvoice
cat > ops.json <<'OPS'
{ "ops": [
  { "op": "split", "after": "userTask_checkInvoice", "kind": "exclusiveGateway", "name": "Invoice ok?", "as": "$ok",
    "branches": [
      { "flowName": "yes", "condition": "= ok", "nodes": [{ "kind": "serviceTask", "name": "Book invoice", "as": "$book" }] },
      { "flowName": "no", "default": true, "nodes": [{ "kind": "userTask", "name": "Clarify invoice", "as": "$clarify",
        "set": { "doc": "Call the customer and clarify the open positions." } }] } ] },
  { "op": "add", "kind": "boundaryEvent:timer", "name": "Reminder", "on": "$clarify", "as": "$reminder",
    "set": { "timer": "P2D", "nonInterrupting": true } },
  { "op": "add", "kind": "sendTask", "name": "Remind customer", "after": "$reminder", "as": "$remind" },
  { "op": "add", "kind": "endEvent", "name": "Reminder sent", "in": "orderHandling", "as": "$sent" },
  { "op": "connect", "source": "$remind", "target": "$sent" },
  { "op": "set", "id": "$book", "set": { "name": "Book invoice in ERP", "doc": "Posts the invoice to the ledger." } },
  { "op": "ext", "id": "$book", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "book-invoice", "retries": "3" } },
  { "op": "ext", "id": "$remind", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "remind-customer" } }
] }
OPS
bpmn apply order.bpmn ops.json
bpmn render order.bpmn -o ops-batch-result.svg
