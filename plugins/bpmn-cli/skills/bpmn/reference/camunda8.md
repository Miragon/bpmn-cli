# Camunda 8 (Zeebe)

Camunda 8 reads the `zeebe:` namespace, and almost every setting is a zeebe
**extension element** added with `ext add` (not a `set` attribute). FEEL values
start with `=`: write `attr==<expression>` on the command line (the first `=`
separates key and value, so `source==order.total` is `source="=order.total"`);
in ops JSON write `"source": "=order.total"`. The CLI reference is
`bpmn guide camunda8` and `bpmn kinds --section zeebeElements` (every zeebe
element, where it goes, its attributes). The examples run on `shipping.bpmn`
from [recipes.md](recipes.md) (recipe 5).

## A new file

`bpmn new <file> --name "..." --target camunda8` writes the `zeebe:` and
`modeler:` namespaces and the platform (`Camunda Cloud`, 8.9.0). In a Camunda 8
file new user tasks get `zeebe:userTask` (Camunda user tasks, like the Modeler
creates them) and new event definitions an id.

## Settings

| what | command |
| --- | --- |
| job worker (service, send, script, business rule task, message throw / end event) | `ext add <file> <id> zeebe:taskDefinition type=<jobType> retries=3` |
| input / output mapping | `ext add <file> <id> zeebe:input source==<FEEL> target=<variable>` (`zeebe:output`; filed into `zeebe:ioMapping`, replaced by target) |
| task header | `ext add <file> <id> zeebe:header key=<key> value=<value>` |
| user task | `zeebe:assignmentDefinition assignee=<user> candidateGroups=<groups>`, `zeebe:formDefinition formId=<formId>`, `zeebe:taskSchedule dueDate=<date-time>`, `zeebe:priorityDefinition priority=<0..100>` |
| DMN decision | `set <file> <id> calledDecision=<decisionId>`, then `ext add <file> <id> zeebe:calledDecision resultVariable=<variable>` |
| call activity | `ext add <file> <id> zeebe:calledElement processId=<processId> propagateAllChildVariables=false` (the BPMN `calledElement` is not read) |
| FEEL script task | `ext add <file> <id> zeebe:script expression==<FEEL> resultVariable=<variable>` |
| message correlation | the message name on the event / receive task (`message=<Name>`), then `ext add <file> Message_<Name> zeebe:subscription correlationKey==<FEEL>` |
| multi-instance | `ext add <file> <id> loop.zeebe:loopCharacteristics inputCollection==<FEEL> inputElement=<variable>` (creates the parallel loop) |
| condition | `add ... --condition '= amount > 1000'`, `set <file> <flowId> 'condition== amount > 1000'` |

```bash
bpmn ext add shipping.bpmn Activity_CorrectAddress zeebe:formDefinition formId=correct-address
bpmn ext add shipping.bpmn Activity_CorrectAddress zeebe:assignmentDefinition assignee==order.owner
bpmn add shipping.bpmn businessRuleTask "Choose carrier" --id Activity_ChooseCarrier --before Activity_CreateShippingLabel calledDecision=choose-carrier
bpmn ext add shipping.bpmn Activity_ChooseCarrier zeebe:calledDecision resultVariable=carrier
bpmn add shipping.bpmn callActivity "Notify customer" --id Activity_NotifyCustomer --after Activity_WaitForPickup
bpmn ext add shipping.bpmn Activity_NotifyCustomer zeebe:calledElement processId=notify-customer propagateAllChildVariables=false
bpmn ext add shipping.bpmn Activity_NotifyCustomer loop.zeebe:loopCharacteristics inputCollection==order.contacts inputElement=contact
bpmn ext add shipping.bpmn Activity_CreateShippingLabel zeebe:header key=carrier value=ups
bpmn ext list shipping.bpmn Activity_CreateShippingLabel
bpmn ext remove shipping.bpmn Activity_CreateShippingLabel 'zeebe:header[key=carrier]'
bpmn validate shipping.bpmn --strict
```

- `zeebe:assignmentDefinition` and the other single elements are merged: the
  second `ext add` adds `assignee` to the existing `candidateGroups`.
- A zeebe attribute set on the element itself is refused (`set X
  zeebe:assignee=...` is `E_WRONG_HOST`; the hint is the `ext add`).
- `show --around` / `show <id> --context` print each implementation in one line
  (`zeebe:taskDefinition type=create-shipping-label retries=5, io: in address;
  out shippingLabelId`); `ext list` prints the whole tree.

## Validate before deploying

`bpmn validate` runs the Camunda 8 profile. `W_C8_DEPLOY_*` findings are files
Camunda 8 refuses: a service / send / script / business rule task or message
throw / end event without job type, a call activity without
`zeebe:calledElement`, a catching message without correlation key, a JUEL
`${...}` condition or another non-FEEL value, FEEL slips (`&&`, `||`, `==`),
timers it cannot parse (`PT2D` instead of `P2D`, a date without offset),
unsupported elements (transactions, cancel events) and more. Runtime findings
(`W_C8_*`) deploy but misbehave: a flow without condition out of an exclusive
gateway with other outgoing flows is never taken, `camunda:*` content is
ignored, a standard loop runs once. Each hint is the fixing command; use
`--strict` when the model must deploy.
