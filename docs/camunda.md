# Camunda 7 and Camunda 8

How to make a model deployable, and what `bpmn validate` checks before the engine does.

| engine | namespace | `bpmn new --target` |
| --- | --- | --- |
| Camunda 7, CIB seven | `camunda:` | `camunda7` |
| Operaton | `operaton:`, then `camunda:` | `camunda7` |
| Camunda 8 (Zeebe) | `zeebe:` | `camunda8` |

::: tip From the CLI
`bpmn guide camunda7`, `bpmn guide camunda8` and `bpmn kinds` print the full reference.
:::

## Platform and checks

`bpmn new <file> --target camunda7` (or `camunda8`) writes the namespace and the execution platform.
An existing file is detected from `modeler:executionPlatform` or its namespace; `--platform
c7|c8|none` overrides it.

The CLI knows where each engine attribute belongs and refuses a wrong place with `E_WRONG_HOST`,
whose hint is the right command. Engine findings are warnings that name the fixing command, so use
`bpmn validate <file> --strict` (exit 5) in a pipeline.

## Camunda 7

`--target camunda7` also sets `camunda:historyTimeToLive="180"`: without a TTL the engines refuse
an executable process. Attributes are `set` keys with the `camunda:` prefix. Extension elements are
added with `ext add`.

| what | command |
| --- | --- |
| external task | `bpmn set <file> <id> camunda:type=external camunda:topic=<topic>` |
| input mapping | `bpmn ext add <file> <id> camunda:inputParameter name=<name> --body '${<expression>}'` |
| user task | `bpmn set <file> <id> camunda:candidateGroups=<groups>` |
| form field | `bpmn ext add <file> <id> camunda:formField id=<field> type=boolean` |
| multi-instance | `bpmn set <file> <id> 'loop.camunda:collection=${<list>}' loop.camunda:elementVariable=<variable>` |

To change a repeatable element (a listener, a form field), remove that one by its selector and add
it again. `--replace` would delete its siblings of the same type.

### Example

An external worker checks a claim. A BPMN error catches the "not covered" case, the claims group
approves the rest.

```sh
bpmn new claim.bpmn --name "Claim handling" --target camunda7
bpmn add claim.bpmn start "Claim received"
bpmn add claim.bpmn serviceTask "Check coverage" \
  --after startEvent_claimReceived camunda:type=external \
  camunda:topic=check-coverage
bpmn ext add claim.bpmn serviceTask_checkCoverage camunda:inputParameter \
  name=amount --body '${amount}'
bpmn add claim.bpmn boundary:error "Not covered" \
  --on serviceTask_checkCoverage --error "Not covered" \
  --error-code NOT_COVERED
bpmn add claim.bpmn end "Claim rejected" --after event_notCovered
bpmn add claim.bpmn userTask "Approve claim" \
  --after serviceTask_checkCoverage camunda:candidateGroups=claims
bpmn add claim.bpmn end "Claim settled" --after userTask_approveClaim
```

```console
$ bpmn validate claim.bpmn --strict
platform: c7 (modeler:executionPlatform "Camunda Platform") - 0 refused at deploy, 0 runtime, 0 practice finding(s)
layout: ok
valid, 0 warning(s)
```

The `platform:` line counts three groups: refused at deploy (`W_C7_DEPLOY_*`, such as a missing TTL
or an external task without topic), runtime, and practice.

## Camunda 8

`--target camunda8` gives a new user task `<zeebe:userTask />`. Without it Camunda 8 runs a job
worker user task, which Tasklist in V2 mode does not list.

Settings are extension elements, added with `ext add`. FEEL values start with `=`, so write
`attr==<expression>`: `source==order.total` is `source="=order.total"`. `bpmn kinds --section
zeebeElements` lists every zeebe element.

| what | command |
| --- | --- |
| job worker | `bpmn ext add <file> <id> zeebe:taskDefinition type=<jobType> retries=3` |
| input mapping | `bpmn ext add <file> <id> zeebe:input source==<FEEL> target=<variable>` |
| user task | `bpmn ext add <file> <id> zeebe:assignmentDefinition candidateGroups=<groups>` |
| message correlation | `bpmn ext add <file> <id> zeebe:subscription correlationKey==<FEEL>` |
| call activity | `bpmn ext add <file> <id> zeebe:calledElement processId=<processId>` |
| condition | `bpmn set <file> <flowId> 'condition== amount > 1000'` |

### Example

A job worker checks an invoice. Amounts over 1000 go to the finance group, the rest take the default
flow. The process then waits for the payment message.

```sh
bpmn new invoice.bpmn --name "Invoice approval" --target camunda8
bpmn add invoice.bpmn start "Invoice received"
bpmn add invoice.bpmn serviceTask "Check invoice" \
  --after startEvent_invoiceReceived
bpmn ext add invoice.bpmn serviceTask_checkInvoice zeebe:taskDefinition \
  type=check-invoice retries=3
bpmn ext add invoice.bpmn serviceTask_checkInvoice zeebe:input \
  source==invoice.amount target=amount
bpmn add invoice.bpmn exclusiveGateway "Amount over 1000?" \
  --after serviceTask_checkInvoice
bpmn add invoice.bpmn userTask "Approve invoice" \
  --after gateway_amountOver1000 --flow-name yes \
  --condition '= amount > 1000'
bpmn ext add invoice.bpmn userTask_approveInvoice \
  zeebe:assignmentDefinition candidateGroups=finance
bpmn add invoice.bpmn exclusiveGateway --id gateway_approved \
  --after userTask_approveInvoice
bpmn connect invoice.bpmn gateway_amountOver1000 gateway_approved \
  --name no --default
bpmn add invoice.bpmn receiveTask "Wait for payment" \
  --after gateway_approved --message "Payment received"
bpmn ext add invoice.bpmn receiveTask_waitForPayment zeebe:subscription \
  correlationKey==invoiceId
bpmn add invoice.bpmn end "Invoice settled" --after receiveTask_waitForPayment
```

### The FEEL pitfall

A JUEL `${...}` condition deploys on Camunda 7 and is refused by Camunda 8. `validate` catches it
with the fix:

```console
$ bpmn set invoice.bpmn flow_amountOver1000ToApproveInvoice 'condition=${amount > 1000}'
...
$ bpmn validate invoice.bpmn --strict
W_C8_DEPLOY_EXPRESSION flow_amountOver1000ToApproveInvoice: The condition "${amount > 1000}" of sequence flow flow_amountOver1000ToApproveInvoice is no FEEL expression; Camunda 8 needs one starting with = and refuses the file  (`bpmn set <file> flow_amountOver1000ToApproveInvoice 'condition== amount > 1000'` (check the FEEL syntax: and / or, = for equality).)
platform: c8 (modeler:executionPlatform "Camunda Cloud") - 1 refused at deploy, 0 runtime, 0 practice finding(s)
layout: ok
valid, 1 warning(s)
```

## bpmnlint and camunda-compat

camunda-compat comes with bpmn-cli and runs from the project's `.bpmnlintrc`. Its findings overlap
with the `W_C7_*` / `W_C8_*` rules; both are listed. Setup: [bpmnlint](bpmnlint.md).

## Next steps

- [bpmnlint](bpmnlint.md): run the project's `.bpmnlintrc` on every write.
- [Commands](commands.md): `set` and `ext` with all their options.
- [A worked session](walkthrough.md): a Camunda 8 model from an empty file.
