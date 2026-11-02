# Camunda 7 and 8

Make a model deployable, and let `bpmn validate` find what the engine would refuse.

| engine | `bpmn new --target` | settings live in |
| --- | --- | --- |
| Camunda 7, CIB seven, Operaton | `camunda7` | `camunda:` attributes (`bpmn set`) and extension elements (`bpmn ext add`) |
| Camunda 8 (Zeebe) | `camunda8` | `zeebe:` extension elements (`bpmn ext add`) |

An existing file is recognised by its `modeler:executionPlatform` or its namespace. A setting in the
wrong place is refused with `E_WRONG_HOST`, whose hint is the right command. Engine findings are
warnings with the fixing command; `bpmn validate <file> --strict` exits 5 on them, for CI.

## Camunda 7

`--target camunda7` also sets `camunda:historyTimeToLive="180"`, without which the engine refuses an
executable process.

| what | command |
| --- | --- |
| external task | `bpmn set <file> <id> camunda:type=external camunda:topic=<topic>` |
| input mapping | `bpmn ext add <file> <id> camunda:inputParameter name=<name> 'body=${<expression>}'` |
| user task | `bpmn set <file> <id> camunda:candidateGroups=<groups>` |
| form field | `bpmn ext add <file> <id> camunda:formField id=<field> type=boolean` |
| multi-instance | `bpmn set <file> <id> 'loop.camunda:collection=${<list>}' loop.camunda:elementVariable=<variable>` |

To change one of several repeatable elements (a listener, a form field), remove it by its selector
(`bpmn ext remove <file> <id> 'camunda:formField[id=<field>]'`) and add it again.

An external worker checks a claim; a BPMN error catches the "not covered" case:

```sh
bpmn new claim.bpmn "Claim handling" --target camunda7
bpmn add claim.bpmn start "Claim received"
bpmn add claim.bpmn serviceTask "Check coverage" --after startEvent_claimReceived \
  camunda:type=external camunda:topic=check-coverage
bpmn ext add claim.bpmn serviceTask_checkCoverage camunda:inputParameter name=amount 'body=${amount}'
bpmn add claim.bpmn boundary:error "Not covered" --on serviceTask_checkCoverage \
  error="Not covered" errorCode=NOT_COVERED
bpmn add claim.bpmn end "Claim rejected" --after event_notCovered
bpmn add claim.bpmn userTask "Approve claim" --after serviceTask_checkCoverage \
  camunda:candidateGroups=claims
bpmn add claim.bpmn end "Claim settled" --after userTask_approveClaim
bpmn validate claim.bpmn --strict
```

## Camunda 8

`--target camunda8` gives every new user task `<zeebe:userTask />`; without it Camunda 8 runs a job
worker user task, which Tasklist V2 does not list. FEEL values start with `=`, so a FEEL attribute
reads `attr==<expression>`: `source==order.total` writes `source="=order.total"`.

| what | command |
| --- | --- |
| job worker | `bpmn ext add <file> <id> zeebe:taskDefinition type=<jobType> retries=3` |
| input mapping | `bpmn ext add <file> <id> zeebe:input source==<FEEL> target=<variable>` |
| user task | `bpmn ext add <file> <id> zeebe:assignmentDefinition candidateGroups=<groups>` |
| message correlation | `bpmn ext add <file> <id> zeebe:subscription correlationKey==<FEEL>` |
| call activity | `bpmn ext add <file> <id> zeebe:calledElement processId=<processId>` |
| condition | `bpmn set <file> <flowId> 'condition== amount > 1000'` |

`bpmn guide zeebe-elements` lists every zeebe element. A job worker checks an invoice, amounts over
1000 go to finance, then the process waits for the payment:

```sh
bpmn new invoice.bpmn "Invoice approval" --target camunda8
bpmn add invoice.bpmn start "Invoice received"
bpmn add invoice.bpmn serviceTask "Check invoice" --after startEvent_invoiceReceived
bpmn ext add invoice.bpmn serviceTask_checkInvoice zeebe:taskDefinition type=check-invoice retries=3
bpmn add invoice.bpmn exclusiveGateway "Amount over 1000?" --after serviceTask_checkInvoice
bpmn add invoice.bpmn userTask "Approve invoice" --after gateway_amountOver1000 \
  --flow-name yes --condition '= amount > 1000'
bpmn ext add invoice.bpmn userTask_approveInvoice zeebe:assignmentDefinition candidateGroups=finance
bpmn add invoice.bpmn exclusiveGateway --id gateway_approved --after userTask_approveInvoice
bpmn connect invoice.bpmn gateway_amountOver1000 gateway_approved name=no default=true
bpmn add invoice.bpmn receiveTask "Wait for payment" --after gateway_approved message="Payment received"
bpmn ext add invoice.bpmn receiveTask_waitForPayment zeebe:subscription correlationKey==invoiceId
bpmn add invoice.bpmn end "Invoice settled" --after receiveTask_waitForPayment
bpmn validate invoice.bpmn --strict
```

A JUEL condition (`${amount > 1000}`) deploys on Camunda 7 but not on 8. `validate` reports it with
the fix:

```console
$ bpmn validate invoice.bpmn --strict
W_C8_DEPLOY_EXPRESSION flow_amountOver1000ToApproveInvoice: The condition "${amount > 1000}" of sequence flow flow_amountOver1000ToApproveInvoice is no FEEL expression; Camunda 8 needs one starting with = and refuses the file  (`bpmn set <file> flow_amountOver1000ToApproveInvoice 'condition== amount > 1000'` (check the FEEL syntax: and / or, = for equality).)
platform: c8 (modeler:executionPlatform "Camunda Cloud") - 1 refused at deploy, 0 runtime, 0 practice finding(s)
...
```

Write expressions in single quotes: in double quotes the shell turns `${...}` into nothing.

## camunda-compat

Camunda's own bpmnlint rules ship with bpmn-cli and run when the project's `.bpmnlintrc` names them
([bpmnlint](./bpmnlint.md)). Their findings overlap with bpmn-cli's checks; both are listed.
