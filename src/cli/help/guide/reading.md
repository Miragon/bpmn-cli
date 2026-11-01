# Reading

```text
bpmn show order.bpmn
bpmn show order.bpmn --in lane_sales
bpmn show order.bpmn --around gateway_ok --depth 2
bpmn show order.bpmn userTask_check
bpmn find order.bpmn check
bpmn find order.bpmn --kind task --in lane_billing
bpmn diagram order.bpmn
```

`show` cuts a long outline and says what it left out and which `--in` opens it. `show <id>` is the read before `set`, `move` or `ext remove`: place, flows, what catches it, attributes, numbered extensions. `find` prints one line per hit, id first, tabs when piped. `--kind` takes a kind or `task`, `event`, `gateway`. `diagram` judges the drawing, score first.
