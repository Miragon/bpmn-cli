# Camunda 7 and Camunda 8

A model gets its platform in one of two ways. `bpmn new <file> --target camunda7` (or `camunda8`)
writes the vendor namespace and the execution platform into a new file. An existing file is
detected from `modeler:executionPlatform` or, without it, from the vendor namespace it uses;
`bpmn validate` names the result in its `platform:` line, and `--platform c7|c8|none` overrides it.

Engine content (`camunda:`, `zeebe:`) is kept byte for byte by every edit. The CLI knows where each
attribute and extension element belongs and refuses a wrong place with `E_WRONG_HOST`, whose hint
is the right command. `bpmn validate` runs the platform's rules. Their findings are warnings that
name the fixing command, so `validate` alone exits 0; `bpmn validate <file> --strict` exits 5 and
is the form for a pipeline. Every write also reports the findings it introduced and resolved.

This page is an overview. The CLI prints the full reference itself (`bpmn guide camunda7`, `bpmn
guide camunda8`, `bpmn kinds`); commands and flags are in [commands.md](commands.md).

## Camunda 7

Camunda 7, CIB seven and Operaton read the `camunda:` namespace. The rules were checked on Camunda
7.24.0, CIB seven 2.2.0 and Operaton 2.1.5, which behaved identically. Operaton also reads its own
`operaton:` namespace, first, with `camunda:` as the fallback; the CLI applies the same rules to
it. The `activiti:` namespace is not modelled.

`bpmn new claim.bpmn --name "Claim handling" --target camunda7` declares the `camunda:` and
`modeler:` namespaces, the platform (`Camunda Platform`, `7.24.0`) and
`camunda:historyTimeToLive="180"` on the process. Without a TTL the engines refuse to deploy an
executable process.

**Attributes** are `set` keys with the `camunda:` prefix. They are also accepted as trailing
`key=value` pairs of `add`.

| element | typical attributes |
| --- | --- |
| process | `camunda:historyTimeToLive`, `camunda:versionTag`, `camunda:candidateStarterGroups` |
| start event | `camunda:initiator`, `camunda:formKey` |
| user task | `camunda:assignee`, `camunda:candidateGroups`, `camunda:candidateUsers`, `camunda:dueDate`, `camunda:priority`, `camunda:formKey` / `camunda:formRef` |
| service / send / business rule task | `camunda:type=external` + `camunda:topic`, or `camunda:class` / `camunda:delegateExpression` / `camunda:expression` (+ `camunda:resultVariable`); `camunda:decisionRef` |
| call activity | `calledElement` (BPMN), `camunda:calledElementBinding`, `camunda:calledElementVersion` |
| any activity, gateway, event | `camunda:asyncBefore`, `camunda:asyncAfter`, `camunda:exclusive`, `camunda:jobPriority` |

Nested elements without an id take the prefix of their slot: `definition.` (the event definition),
`loop.` (the loop characteristics, `loop.camunda:collection`) and `condition.` (the condition
expression). `bpmn kinds --section nestedKeys` lists all of them.

**Extension elements** are added with `ext add`. Child types are filed into their container
(`camunda:inputParameter` into `camunda:inputOutput`, `camunda:formField` into `camunda:formData`)
and an item with the same key replaces the old one. `bpmn ext list claim.bpmn <id>` prints the
tree, a selector removes one item (`bpmn ext remove claim.bpmn Activity_CheckCoverage
'camunda:inputParameter[name=amount]'`), and a path reaches into nested containers
(`'camunda:formField[id=approved]/camunda:validation/camunda:constraint'`). To change a repeatable
element (a listener, an error mapping, a form field), remove that one by its selector and add it
again: `--replace` would delete its siblings of the same type.

### Example

A claim is checked by an external worker with an input mapping. An error mapping turns the
worker's `covered=false` into a BPMN error that a boundary event catches. The claims group then
approves the claim in a generated form, and every party is informed (multi-instance over a
collection).

```
bpmn new claim.bpmn --name "Claim handling" --target camunda7
bpmn add claim.bpmn start "Claim received"
bpmn add claim.bpmn serviceTask "Check coverage" --after Event_ClaimReceived camunda:type=external camunda:topic=check-coverage
bpmn ext add claim.bpmn Activity_CheckCoverage camunda:inputParameter name=amount --body '${amount}'
bpmn add claim.bpmn boundary:error "Not covered" --on Activity_CheckCoverage --error "Not covered" --error-code NOT_COVERED definition.camunda:errorCodeVariable=rejectCode
bpmn ext add claim.bpmn Activity_CheckCoverage camunda:errorEventDefinition id=Mapping_NotCovered errorRef=Error_NotCovered 'expression=${not covered}'
bpmn add claim.bpmn end "Claim rejected" --after Event_NotCovered
bpmn add claim.bpmn userTask "Approve claim" --after Activity_CheckCoverage camunda:candidateGroups=claims
bpmn ext add claim.bpmn Activity_ApproveClaim camunda:formField id=approved type=boolean
bpmn add claim.bpmn userTask "Inform party" --after Activity_ApproveClaim 'loop.camunda:collection=${parties}' loop.camunda:elementVariable=party 'camunda:assignee=${party}'
bpmn add claim.bpmn end "Claim settled" --after Activity_InformParty
```

```
$ bpmn validate claim.bpmn --strict
platform: c7 (modeler:executionPlatform "Camunda Platform") - 0 refused at deploy, 0 runtime, 0 practice finding(s)
layout: ok
valid, 0 warning(s)
```

### What `validate` checks

The Camunda 7 profile has about 40 rules in three groups, counted in the `platform:` line:

- **refused at deploy** (`W_C7_DEPLOY_*`): a missing TTL, a service task without implementation, an
  external task without topic, a multi-instance loop without collection or cardinality, two
  `camunda:inputOutput`, a sub-process without start event, a link throw without its catch, an
  attribute BPMN does not define.
- **runtime**: content the engines ignore or fail on when the process runs, such as unknown or
  misplaced attributes and elements, a dangling error mapping, an empty condition, `zeebe:` content.
- **practice**: what the engines warn about.

A finding looks like the Camunda 8 one [below](#camunda-8): code, element, message and the fixing
command, for a removed TTL `W_C7_DEPLOY_HISTORY_TTL` with `bpmn set <file> <processId>
camunda:historyTimeToLive=180`. Full reference: `bpmn guide camunda7`.

## Camunda 8

Camunda 8 (Zeebe) reads the `zeebe:` namespace. The rules were checked on Camunda 8.9.22: every
deploy rule by deploying, every runtime rule by running the process.

`bpmn new invoice.bpmn --name "Invoice approval" --target camunda8` declares the `zeebe:` and
`modeler:` namespaces and the platform (`Camunda Cloud`, `8.9.0`). In a Camunda 8 file a new user
task gets `<zeebe:userTask />`, a Camunda user task like the Modeler creates. Without it Camunda 8
runs a job worker user task, which Tasklist in V2 mode does not list
(`W_C8_JOB_WORKER_USER_TASK`). A new event definition gets an id, because Camunda 8.9 refuses
conditional, compensation and link catch event definitions without one.

**Settings are extension elements**, added with `ext add`. FEEL values start with `=`, so write
`attr==<expression>`: the first `=` separates key and value, and `source==order.total` is
`source="=order.total"`. Child types go into their container, single elements are merged, keyed
items are replaced. `bpmn kinds --section zeebeElements` lists every zeebe element, where it goes
and its attributes.

| what | command |
| --- | --- |
| job worker (service, send, script, business rule task, message throw / end event) | `bpmn ext add <file> <id> zeebe:taskDefinition type=<jobType> retries=3` |
| input / output mapping | `bpmn ext add <file> <id> zeebe:input source==<FEEL> target=<variable>` (`zeebe:output` likewise) |
| task header | `bpmn ext add <file> <id> zeebe:header key=<key> value=<value>` |
| FEEL script task | `bpmn ext add <file> <id> zeebe:script expression==<FEEL> resultVariable=<variable>` |
| DMN decision | `bpmn set <file> <id> calledDecision=<decisionId>`, then `bpmn ext add <file> <id> zeebe:calledDecision resultVariable=<variable>` |
| call activity | `bpmn ext add <file> <id> zeebe:calledElement processId=<processId> propagateAllChildVariables=false` |
| user task | `zeebe:assignmentDefinition assignee=<user> candidateGroups=<groups>`, `zeebe:formDefinition formId=<formId>` (or `externalReference=<url>`), `zeebe:taskSchedule dueDate=<date-time>`, `zeebe:priorityDefinition priority=<0..100>`, `zeebe:taskListener eventType=completing type=<jobType>` |
| message correlation | `bpmn ext add <file> <id> zeebe:subscription correlationKey==<FEEL>` on the catch event, receive task or message; it is written to the message |
| multi-instance | `bpmn ext add <file> <id> loop.zeebe:loopCharacteristics inputCollection==<FEEL> inputElement=<variable>` (creates the parallel loop; `set <id> loop=sequential`) |
| execution listener | `bpmn ext add <file> <id> zeebe:executionListener eventType=start type=<jobType>` |
| condition | `add ... --condition '= amount > 1000'`, `bpmn set <file> <flowId> 'condition== amount > 1000'` |
| process version tag | `bpmn ext add <file> <processId> zeebe:versionTag value=v1` |

A zeebe attribute set on the element itself (`bpmn set <file> <id> zeebe:candidateGroups=finance`)
is refused with `E_WRONG_HOST`; the hint is the `ext add` that writes it where Camunda 8 reads it.

### Example

An invoice is checked by a job worker with an input mapping. Amounts over 1000 are approved by the
finance group (FEEL condition, Camunda user task), the others take the default flow. The process
then waits for the payment message, correlated by invoice id. Each step reports what is still
missing: the service task warns `W_C8_DEPLOY_IMPLEMENTATION` until it has a job type, the receive
task `W_C8_DEPLOY_MESSAGE` until its message has a correlation key.

```
bpmn new invoice.bpmn --name "Invoice approval" --target camunda8
bpmn add invoice.bpmn start "Invoice received"
bpmn add invoice.bpmn serviceTask "Check invoice" --after Event_InvoiceReceived
bpmn ext add invoice.bpmn Activity_CheckInvoice zeebe:taskDefinition type=check-invoice retries=3
bpmn ext add invoice.bpmn Activity_CheckInvoice zeebe:input source==invoice.amount target=amount
bpmn add invoice.bpmn exclusiveGateway "Amount over 1000?" --after Activity_CheckInvoice
bpmn add invoice.bpmn userTask "Approve invoice" --after Gateway_AmountOver1000 --flow-name yes --condition '= amount > 1000'
bpmn ext add invoice.bpmn Activity_ApproveInvoice zeebe:assignmentDefinition candidateGroups=finance
bpmn add invoice.bpmn exclusiveGateway --id Gateway_Approved --after Activity_ApproveInvoice
bpmn connect invoice.bpmn Gateway_AmountOver1000 Gateway_Approved --name no --default
bpmn add invoice.bpmn receiveTask "Wait for payment" --after Gateway_Approved --message "Payment received"
bpmn ext add invoice.bpmn Activity_WaitForPayment zeebe:subscription correlationKey==invoiceId
bpmn add invoice.bpmn end "Invoice settled" --after Activity_WaitForPayment
```

```
$ bpmn validate invoice.bpmn --strict
platform: c8 (modeler:executionPlatform "Camunda Cloud") - 0 refused at deploy, 0 runtime, 0 practice finding(s)
layout: ok
valid, 0 warning(s)
```

### What `validate` checks

The Camunda 8 profile checks executable processes, including the content of ad-hoc sub-processes.
Its findings are `W_C8_*` warnings with a `severity` in `--json` (`deploy`, `runtime` or
`practice`), counted in the `platform:` line:

- **deploy** (`W_C8_DEPLOY_*`, Camunda 8 refuses the file): a task or message throw / end event
  without job type, a call activity without `zeebe:calledElement` (the BPMN `calledElement` is not
  read), a catching message without correlation key, a JUEL `${...}` condition or a static value
  where Camunda 8 wants FEEL, a FEEL syntax error, a timer value it cannot parse (`PT2D` instead of
  `P2D`, a date without offset, a 5-field cron), a multi-instance loop without `inputCollection`,
  unsupported elements (transaction, cancel events), what the BPMN schema refuses, a file without
  an executable process.
- **runtime** (it deploys, but the setting is ignored or fails when the process runs): a flow
  without condition out of an exclusive or inclusive gateway with other outgoing flows, a condition
  on a flow out of a task or parallel gateway, a standard loop (runs once), `camunda:*` content,
  unknown or misplaced zeebe content.

FEEL is checked by a built-in parser of the grammar Camunda 8.9 accepts, which reports slips with
their FEEL spelling (`&&`, `||`, `==`, `<>`, `%`, upper-case keywords, `if` without `else`, single
quotes). Every finding names the command that fixes it, here after a JUEL condition was set:

```
$ bpmn set invoice.bpmn Flow_AmountOver1000ToApproveInvoice 'condition=${amount > 1000}'
...
$ bpmn validate invoice.bpmn --strict
W_C8_DEPLOY_EXPRESSION Flow_AmountOver1000ToApproveInvoice: The condition "${amount > 1000}" of sequence flow Flow_AmountOver1000ToApproveInvoice is no FEEL expression; Camunda 8 needs one starting with = and refuses the file  (`bpmn set <file> Flow_AmountOver1000ToApproveInvoice 'condition== amount > 1000'` (check the FEEL syntax: and / or, = for equality).)
platform: c8 (modeler:executionPlatform "Camunda Cloud") - 1 refused at deploy, 0 runtime, 0 practice finding(s)
layout: ok
valid, 1 warning(s)
```

Full reference: `bpmn guide camunda8`.

## bpmnlint and camunda-compat

A project that checks its models with bpmnlint in CI keeps that configuration in a `.bpmnlintrc`;
`bpmn validate` and every write run it too ([bpmnlint.md](bpmnlint.md)). Camunda's deployability
rules (`plugin:camunda-compat/camunda-platform-7-24`, `camunda-cloud-8-10`, the older versions
`camunda-platform-7-19` to `7-23` and `camunda-cloud-8-0` to `8-9`) come with bpmn-cli and work
without an install. They read the `camunda:` / `zeebe:` properties only through a moddle extension,
as bpmnlint does in CI:

```json
{
  "extends": ["bpmnlint:recommended", "plugin:camunda-compat/camunda-platform-7-24"],
  "moddleExtensions": { "camunda": "camunda-bpmn-moddle/resources/camunda.json" }
}
```

`camunda-bpmn-moddle/resources/camunda.json` and `zeebe-bpmn-moddle/resources/zeebe.json` work
without the package installed. Without the entry the rules see no `camunda:historyTimeToLive` and
report it missing. camunda-compat and bpmn-cli's own `W_C7_*` / `W_C8_*` rules overlap in places
(a service task without implementation); both are listed.
