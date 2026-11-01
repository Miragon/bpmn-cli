# bpmn

You edit BPMN models by kind, name and id; the CLI keeps the XML and draws the diagram. Address elements by id, names may repeat. Every result names the ids it created: use them in the next command.

```text
bpmn new <file> [name] --target <camunda8|camunda7>
bpmn show <file> [id]
bpmn add <file> <kind[:trigger]> [name] --after <id> [key=value…]
bpmn set <file> <id> [key=value…]
bpmn validate <file>
```

```text
bpmn new claim.bpmn "Claim handling" --target camunda8
bpmn show order.bpmn userTask_check
bpmn add order.bpmn serviceTask Notify --after serviceTask_charge --lane lane_billing
bpmn set order.bpmn userTask_check doc="Four eyes"
bpmn validate order.bpmn
```

A flag says where an element goes and how the command runs; what the element holds is a `key=value`. `bpmn <command> --help` lists the flags. Related changes go into one `apply`: one transaction, one layout. A model built over several writes ends with `bpmn layout <file>`. A refusal names its fix.

Topics, `bpmn guide <topics…>`: contract, workflow, reading, output, layout, format, render, ops, placement, triggers, errors, quoting, camunda7, camunda8, bpmnlint, conventions, commands, kinds, set-keys, nested-keys, zeebe-elements, ids, colors, exit-codes.
