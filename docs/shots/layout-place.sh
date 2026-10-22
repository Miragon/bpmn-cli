# layout.md, formatting: the customer pool on top adds a crossing, place moves Ask customer and resolves it.
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

bpmn order order.bpmn Collaboration_OrderHandling Participant_Customer
bpmn render order.bpmn --problems -o layout-place-before.svg
bpmn place order.bpmn Activity_AskCustomer --row-of Activity_CheckInvoice
bpmn render order.bpmn -o layout-place-after.svg
