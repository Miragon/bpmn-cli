# ops.md: the result of the full example batch.
bpmn new order.bpmn --name "Order handling" --target camunda8
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived
bpmn add order.bpmn end "Invoice handled" --after Activity_CheckInvoice
bpmn kinds --json | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(JSON.parse(s).opsExample)))' > ops.json
bpmn apply order.bpmn ops.json
bpmn render order.bpmn -o ops-batch-result.svg
