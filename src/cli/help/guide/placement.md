# Placement

The flags of `add` and `move`; one placement per command.

- `--after X`: append behind a gateway or a path's end, else splice into X's one outgoing flow.
- `--before Y`: the same on the incoming side.
- `--after X --before Y`: splice into the flow X to Y.
- `--flow F`: splice into flow F; it keeps name and condition.
- `--in S`: into a process, pool or sub-process, unconnected.
- `--on A`: boundary event on activity A.
- `--to T`: also connect the node to T.

`--flow-name`, `--flow-id`, `--condition`, `--language`, `--default` describe the flow into the node. Data, annotations, lanes and pools take `--in` only; a group `--members`.

```text
bpmn add order.bpmn userTask Rework --after gateway_ok --condition "=rework" --to userTask_check
bpmn add order.bpmn boundaryEvent:timer Reminder --on serviceTask_charge timer=P2D nonInterrupting=true
bpmn add order.bpmn participant Shop
bpmn move order.bpmn serviceTask_charge --lane lane_sales
```
