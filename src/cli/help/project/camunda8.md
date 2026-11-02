# Camunda 8

Settings are extension elements (`bpmn guide zeebe-elements`). Child types go into their container, a single element merges, an item with the same key replaces. A FEEL value starts with `=`, so `key==expression`.

```text
bpmn new claim.bpmn Claim --target camunda8
bpmn ext add order.bpmn serviceTask_charge zeebe:taskDefinition type=charge-card retries=3
bpmn ext add order.bpmn serviceTask_charge zeebe:input source==order.total target=amount
bpmn ext add order.bpmn userTask_check zeebe:assignmentDefinition assignee=kermit
bpmn ext remove order.bpmn serviceTask_charge 'zeebe:input[target=amount]'
```

Before deploying, `bpmn validate <file>`: Camunda 8 refuses a file with `W_C8_DEPLOY_*`; other `W_C8_*` deploy but misbehave.
