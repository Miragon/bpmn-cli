# getting-started.md and the landing page: the first model of "Getting started".
bpmn new order.bpmn --name "Order handling"
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Check invoice" --after startEvent_orderReceived
bpmn add order.bpmn end "Done" --after userTask_checkInvoice
bpmn render order.bpmn -o getting-started-order.svg
