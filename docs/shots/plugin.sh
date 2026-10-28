# claude-code-plugin.md: what the skill looks at after a change, the result with the change marked.
bpmn new order.bpmn --name "Order handling"
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Check invoice" --after startEvent_orderReceived
bpmn add order.bpmn end "Done" --after userTask_checkInvoice
cat > ops.json <<'OPS'
{ "ops": [
  { "op": "add", "kind": "boundaryEvent:timer", "name": "3 days", "on": "userTask_checkInvoice", "timer": "P3D", "nonInterrupting": true, "as": "$wait" },
  { "op": "add", "kind": "sendTask", "name": "Send reminder", "after": "$wait", "as": "$remind" },
  { "op": "add", "kind": "endEvent", "name": "Reminder sent", "after": "$remind" }
] }
OPS
bpmn apply order.bpmn ops.json --render plugin-change.svg
