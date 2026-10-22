# claude-code-plugin.md: what the skill looks at after a change, the result with the change marked.
bpmn new order.bpmn --name "Order handling"
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived
bpmn add order.bpmn end "Done" --after Activity_CheckInvoice
cat > ops.json <<'OPS'
{ "ops": [
  { "op": "add", "kind": "boundaryEvent:timer", "name": "3 days", "on": "Activity_CheckInvoice", "timer": "P3D", "nonInterrupting": true, "as": "$wait" },
  { "op": "add", "kind": "sendTask", "name": "Send reminder", "after": "$wait", "as": "$remind" },
  { "op": "add", "kind": "endEvent", "name": "Reminder sent", "after": "$remind" }
] }
OPS
bpmn apply order.bpmn ops.json --render plugin-change.svg
