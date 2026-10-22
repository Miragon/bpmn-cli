# getting-started.md and the landing page: the first model of "Getting started".
bpmn new order.bpmn --name "Order handling"
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Check invoice" --after Event_OrderReceived
bpmn add order.bpmn end "Done" --after Activity_CheckInvoice
bpmn render order.bpmn -o getting-started-order.svg
