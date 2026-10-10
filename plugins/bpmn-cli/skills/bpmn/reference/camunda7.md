# Camunda 7 (also CIB seven and Operaton)

Camunda 7, CIB seven and Operaton read the `camunda:` namespace (Operaton also
`operaton:`, handled the same way). The CLI knows where every `camunda:`
attribute and extension element belongs and refuses a wrong place with the
right command in the hint (`E_WRONG_HOST`). The CLI reference is
`bpmn guide camunda7`; the examples run on `payment.bpmn` from
[recipes.md](recipes.md) (recipe 4).

## A new file

`bpmn new <file> --name "..." --target camunda7` writes the `camunda:` and
`modeler:` namespaces, the platform (`Camunda Platform`, 7.24.0) and
`camunda:historyTimeToLive="180"` - the engines refuse an executable process
without a TTL. An existing file's platform is in the `platform:` line of
`bpmn validate`; `bpmn show` lists the namespaces in its first line.

## Attributes: `set` with the prefix

| element | typical attributes |
| --- | --- |
| process | `camunda:historyTimeToLive`, `camunda:versionTag`, `camunda:candidateStarterGroups` |
| start event | `camunda:initiator`, `camunda:formKey` |
| user task | `camunda:assignee`, `camunda:candidateGroups`, `camunda:candidateUsers`, `camunda:dueDate`, `camunda:priority`, `camunda:formKey` / `camunda:formRef` |
| service / send / business rule task | `camunda:type=external` + `camunda:topic`, or `camunda:class` / `camunda:delegateExpression` / `camunda:expression` (+ `camunda:resultVariable`); `camunda:decisionRef` |
| call activity | `calledElement`, `camunda:calledElementBinding`, `camunda:calledElementVersion` |
| activities, gateways, events | `camunda:asyncBefore`, `camunda:asyncAfter`, `camunda:exclusive`, `camunda:jobPriority` |

Nested elements without an id take the prefix of their slot:
`definition.` (the event definition: `definition.camunda:errorCodeVariable`,
`definition.camunda:type=external` + `definition.camunda:topic` on a message
end / throw event), `loop.` (multi-instance: `loop.camunda:collection`,
`loop.camunda:elementVariable`, `loop.camunda:asyncBefore`) and `condition.`
(`condition.camunda:resource` for a script resource condition). All of them:
`bpmn kinds --section nestedKeys`. Quote values with `${...}` in single quotes.

```bash
bpmn set payment.bpmn Activity_InformCustomer camunda:candidateGroups=support camunda:formKey=camunda-forms:deployment:inform-customer.form
bpmn set payment.bpmn Event_CardDeclined definition.camunda:errorCodeVariable=declineCode definition.camunda:errorMessageVariable=declineMessage
bpmn set payment.bpmn Activity_ChargeCreditCard camunda:asyncBefore=true
bpmn add payment.bpmn userTask "Notify party" --id Activity_NotifyParty --after Activity_InformCustomer 'loop.camunda:collection=${parties}' loop.camunda:elementVariable=party 'camunda:assignee=${party}'
```

## Extension elements: `ext add`

Child types are filed into their container, created when missing
(`camunda:inputParameter` / `camunda:outputParameter` -> `camunda:inputOutput`,
`camunda:formField` -> `camunda:formData`, `camunda:property` ->
`camunda:properties`); an item with the same key (name, id) replaces the old one;
a path reaches into nested containers.

```bash
bpmn ext add payment.bpmn Activity_ChargeCreditCard camunda:outputParameter name=transactionId --body '${transactionId}'
bpmn ext add payment.bpmn Activity_ChargeCreditCard camunda:failedJobRetryTimeCycle --body R3/PT5M
bpmn ext add payment.bpmn Activity_InformCustomer camunda:taskListener event=create 'expression=${task.setPriority(80)}'
bpmn ext add payment.bpmn Activity_NotifyParty camunda:formField id=notified type=boolean
bpmn ext add payment.bpmn Activity_NotifyParty 'camunda:formField[id=notified]/camunda:validation/camunda:constraint' name=required
bpmn ext list payment.bpmn Activity_ChargeCreditCard
bpmn ext remove payment.bpmn Activity_ChargeCreditCard 'camunda:outputParameter[name=transactionId]'
```

- Call activity mappings: `bpmn ext add <file> <callActivityId> camunda:in variables=all`,
  `camunda:in source=amount target=payoutAmount`, `camunda:out source=transactionId target=transactionId`.
- External task error mapping: `camunda:errorEventDefinition` with `id`,
  `errorRef` (the root error, e.g. `Error_CardDeclined` that an error boundary
  event created) and `expression` - see recipe 4.
- A single container exists once (`E_DUPLICATE_EXTENSION` on a conflict); a
  repeatable element (listener, error mapping, form field) is changed by
  removing just that one by its selector and adding it again - never with
  `--replace`, which replaces all elements of that type.
- `--xml '<camunda:... />'` adds a snippet as given, for content without a
  simpler form.

## Validate before deploying

```bash
bpmn validate payment.bpmn --strict
```

`validate` runs the Camunda 7 profile: `W_C7_DEPLOY_*` findings are files the
engines refuse (no TTL, a service task without implementation, an external
task without topic, a multi-instance loop without collection or cardinality,
two `camunda:inputOutput`, ...), other `W_C7_*` findings deploy but misbehave
(misplaced or unknown attributes, Camunda 8 content, ...). Each finding's hint
is the fixing command; every write reports the findings it introduced. The
findings are warnings, so plain `validate` exits 0 - use `--strict` when the
model must be clean.
