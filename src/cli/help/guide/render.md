# Render

`.png` or `.svg` by the extension of `-o`.

```text
bpmn render order.bpmn --problems -o order.png
bpmn render order.bpmn --around gateway_ok --depth 2 -o near.svg
bpmn render order.bpmn --path startEvent_received endEvent_done -o path.png
bpmn render order.bpmn lane_sales -o lane.png
```

Ids crop to these elements; on a large model render a crop. `--problems` numbers the problems of `bpmn diagram` in the image.
