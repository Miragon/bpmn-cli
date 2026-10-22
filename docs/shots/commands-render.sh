# commands.md, render: the halos of --render on a change.
# The model of "A worked session" (walkthrough.md): an invoice split, two pools, a message flow.
cat > ops.json <<'EOF'
{ "ops": [
  { "op": "split", "after": "Activity_CheckInvoice", "name": "Invoice ok?",
    "branches": [
      { "flowName": "yes", "condition": "= ok", "nodes": [{ "kind": "serviceTask", "name": "Book invoice", "as": "$book" }] },
      { "flowName": "no", "default": true, "nodes": [{ "kind": "sendTask", "name": "Ask customer", "as": "$ask" }] } ] },
  { "op": "ext", "id": "$book", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "book-invoice" } }
] }
EOF
bpmn new order.bpmn --name "Order handling" --target camunda8
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived
bpmn add order.bpmn end "Invoice handled" --after Activity_CheckInvoice
bpmn apply order.bpmn ops.json
bpmn ext add order.bpmn Activity_AskCustomer zeebe:taskDefinition type=ask-customer
bpmn add order.bpmn participant "Order handling"
bpmn add order.bpmn participant "Customer" --black-box
bpmn connect order.bpmn Activity_AskCustomer Participant_Customer --message Question

cat > timeout.json <<'EOF2'
[{ "op": "add", "kind": "boundaryEvent:timer", "name": "No answer", "on": "Activity_AskCustomer", "timer": "P3D", "as": "$timeout" },
 { "op": "add", "kind": "endEvent", "name": "Order cancelled", "after": "$timeout" },
 { "op": "set", "id": "Activity_AskCustomer", "values": { "name": "Ask the customer" } }]
EOF2
bpmn apply order.bpmn timeout.json --render commands-render-halos.svg
