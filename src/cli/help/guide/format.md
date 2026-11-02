# Format

Say where shapes go by naming other elements; the model does not change. Look with `bpmn diagram`, fix, look again, stop after two rounds.

```text
bpmn place order.bpmn endEvent_rejected --below gateway_ok
bpmn place order.bpmn --branch flow_okToRejected --below gateway_ok
bpmn place order.bpmn event_overdue --side top
bpmn color order.bpmn userTask_check --color green
bpmn color order.bpmn --path startEvent_received endEvent_done --color blue
bpmn route order.bpmn flow_okToRejected --exit bottom --entry left
bpmn label order.bpmn gateway_ok --side above
bpmn space order.bpmn --after userTask_check
bpmn tidy order.bpmn
bpmn compact order.bpmn
```

In `apply` these come after the model operations; a model operation behind one answers `E_USAGE`. A node stays in its lane: `move --lane` first (`E_LEAVES_CONTAINER`). `E_NO_ROOM`: run the `space` of its hint, then place again.
