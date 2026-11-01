# claude-code-plugin.md: what the skill looks at after a change.
bpmn new order.bpmn "Order handling"
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Check invoice" --after startEvent_orderReceived
bpmn add order.bpmn end "Done" --after userTask_checkInvoice
cat > ops.json <<'OPS'
{ "ops": [
  { "op": "add", "kind": "boundaryEvent:timer", "name": "3 days", "on": "userTask_checkInvoice", "set": { "timer": "P3D", "nonInterrupting": true }, "as": "$wait" },
  { "op": "add", "kind": "sendTask", "name": "Send reminder", "after": "$wait", "as": "$remind" },
  { "op": "add", "kind": "endEvent", "name": "Reminder sent", "after": "$remind" }
] }
OPS
bpmn apply order.bpmn ops.json
bpmn render order.bpmn -o plugin-change.svg
