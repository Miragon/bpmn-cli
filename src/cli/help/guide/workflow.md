# Workflow

1. `bpmn show <file>` for the ids; `bpmn conventions <file>` before new ids.
2. Change: one command, or `bpmn apply` for related changes.
3. `bpmn validate <file>`, then render and look.

```text
bpmn apply order.bpmn ops.json
bpmn apply order.bpmn ops.json --dry-run
bpmn add order.bpmn userTask Approve --after userTask_check -o copy.bpmn
```

`ops.json`: `[{"op": "add", "kind": "userTask", "name": "Approve", "after": "userTask_check", "as": "$approve"}, {"op": "set", "id": "$approve", "set": {"doc": "Four eyes"}}]`. `split` builds branches, only in `apply`.
