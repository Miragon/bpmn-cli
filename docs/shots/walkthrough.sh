# walkthrough.md: the order process after the first steps, after the split batch, and with the pools.
bpmn new order.bpmn --name "Order handling" --target camunda8
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived
bpmn add order.bpmn end "Invoice handled" --after Activity_CheckInvoice
bpmn render order.bpmn -o walkthrough-1-first-steps.svg
cat > ops.json <<'OPS'
{ "ops": [
  { "op": "split", "after": "Activity_CheckInvoice", "name": "Invoice ok?",
    "branches": [
      { "flowName": "yes", "condition": "= ok", "nodes": [{ "kind": "serviceTask", "name": "Book invoice", "as": "$book" }] },
      { "flowName": "no", "default": true, "nodes": [{ "kind": "sendTask", "name": "Ask customer", "as": "$ask" }] } ] },
  { "op": "ext", "id": "$book", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "book-invoice" } }
] }
OPS
bpmn apply order.bpmn ops.json --render walkthrough-2-split.svg
bpmn ext add order.bpmn Activity_AskCustomer zeebe:taskDefinition type=ask-customer --summary
bpmn add order.bpmn participant "Order handling"
bpmn add order.bpmn participant "Customer" --black-box
bpmn connect order.bpmn Activity_AskCustomer Participant_Customer --message Question
bpmn render order.bpmn -o walkthrough-3-pools.svg
