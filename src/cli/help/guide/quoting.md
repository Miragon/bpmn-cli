# Quoting

Expressions and anything with `$` go in single quotes; a pair with spaces is quoted whole. In `ops.json` the shell expands nothing, so a batch is the safest place.

```text
bpmn set order.bpmn flow_okToRejected condition='${amount > 100}'
bpmn set order.bpmn userTask_check name="Check the order"
```
