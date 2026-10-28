# The animated demo on the landing page (theme/LandingDemo.vue): the model of
# "Getting started" before and after one `bpmn add`. The before picture gets the canvas of the
# after picture, so both line up when the demo fades from one to the other.
bpmn new order.bpmn --name "Order handling"
bpmn add order.bpmn start "Order received"
bpmn add order.bpmn userTask "Check invoice" --after startEvent_orderReceived
bpmn add order.bpmn end "Done" --after userTask_checkInvoice
bpmn render order.bpmn -o landing-demo-before.svg
bpmn add order.bpmn userTask "Approve invoice" --after userTask_checkInvoice
bpmn render order.bpmn -o landing-demo-after.svg
canvas=$(sed -nE 's/.*<svg [^>]*width="([0-9.]+)" height="[0-9.]+" viewBox="[0-9.-]+ [0-9.-]+ ([0-9.]+) .*/\1 \2/p' landing-demo-after.svg)
set -- $canvas
sed -i.bak -E "1s/width=\"[0-9.]+\"/width=\"$1\"/; 1s/(viewBox=\"[0-9.-]+ [0-9.-]+ )[0-9.]+/\1$2/; 2s/width=\"[0-9.]+\"/width=\"$2\"/" landing-demo-before.svg
rm landing-demo-before.svg.bak
