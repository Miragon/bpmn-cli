# layout.md, layout: the same change on a formatted drawing, kept by the write and redrawn by bpmn layout.
# The model of "Model a process" (modeling.md): an invoice split, two pools, a message flow.
cat > ops.json <<'EOF'
{ "ops": [
  { "op": "split", "after": "userTask_checkInvoice", "name": "Invoice ok?",
    "branches": [
      { "flowName": "yes", "condition": "= ok", "nodes": [{ "kind": "serviceTask", "name": "Book invoice", "as": "$book" }] },
      { "flowName": "no", "default": true, "nodes": [{ "kind": "sendTask", "name": "Ask customer", "as": "$ask" }] } ] },
  { "op": "ext", "id": "$book", "action": "add", "type": "zeebe:taskDefinition", "attrs": { "type": "book-invoice" } }
] }
EOF
bpmn new order.bpmn "Order handling" --target camunda8
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Check invoice" --after startEvent_orderReceived
bpmn add order.bpmn end "Invoice handled" --after userTask_checkInvoice
bpmn apply order.bpmn ops.json
bpmn ext add order.bpmn sendTask_askCustomer zeebe:taskDefinition type=ask-customer
bpmn add order.bpmn participant "Order handling"
bpmn add order.bpmn participant "Customer" --black-box
bpmn connect order.bpmn sendTask_askCustomer participant_customer message=Question

bpmn layout order.bpmn
bpmn order order.bpmn collaboration_orderHandling participant_customer
bpmn place order.bpmn sendTask_askCustomer --row-of userTask_checkInvoice
bpmn add order.bpmn userTask "Approve invoice" --after userTask_checkInvoice
bpmn render order.bpmn -o layout-modes-incremental.svg
bpmn layout order.bpmn
bpmn render order.bpmn -o layout-modes-full.svg
