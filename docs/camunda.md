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
W_C8_DEPLOY_EXPRESSION flow_amountOver1000ToApproveInvoice: The condition "${amount > 1000}" of sequence flow flow_amountOver1000ToApproveInvoice is no FEEL expression; Camunda 8 needs one starting with = and refuses the file  (`bpmn set <file> flow_amountOver1000ToApproveInvoice condition==<expression>`.)
platform: c8 (modeler:executionPlatform "Camunda Cloud") - 1 refused at deploy, 0 runtime, 0 practice finding(s)
layout: ok
valid, 1 warning(s)
```

## Where the checks come from

The `W_C7_*` / `W_C8_*` findings come from bpmnlint rules, loaded the first time a file of that
engine is checked and run in one walk of the file by the engine entry point of
`@miragon/bpmnlint-plugin-rules` (`lint`):

- camunda-compat's rules for the file's `modeler:executionPlatformVersion` (`compatRules` of the
  plugin's `camunda-7` / `camunda-8` entry; the latest without one; `--json` platform names the
  version);
- bpmn-cli's own rules for what camunda-compat leaves out, seventy for Camunda 7 and fifty for
  Camunda 8 in `src/adapters/out/bpmnlint/engine/rules/c7|c8/`, written on the plugin's
  `EngineRule` (`bpmn-cli/<rule>`). Each rule checks one thing, is named after what must hold
  (`c7-message-needs-name`, `c8-error-code-unique`) and declares the code and severity of its
  findings; several rules may share a code (the tables below list them by code). It gives its hint
  with the finding;
- among them the rules on content the engine's parser drops or rewrites, which read the file as
  written: `c7-bpmn-attribute-known`, `c7-camunda-boolean-valid`, `c7-io-parameter-in-input-output`,
  `c7-camunda-element-known` and `c8-bpmn-attribute-known`, the four `c8-publish-message-*` rules,
  `c8-zeebe-element-placement`, `c8-zeebe-element-known`.

bpmn-cli maps each camunda-compat rule to its code. The hint of a camunda-compat finding is built
from where it points; its message is camunda-compat's. A rule's severity says what the finding
means: `error` is deploy, `warn` runtime, `info` practice.

Where camunda-compat reads a file differently than Camunda 8.9 (engine-checked), bpmn-cli drops its
finding and follows the engine: white space only is a value for a job type, a message, signal,
process or decision name, a result variable, a listener type, an error or escalation code and a link
name; timer values are read as Camunda 8 parses them (`bpmn-cli/c8-timer-value-valid`); a
`zeebe:jobPriorityDefinition` deploys on 8.9; a condition on a flow out of a gateway is the
structural `W_CONDITION_IGNORED`; of two none start events or two link catch events with one name,
the second is reported; an element with a doubled extension element reports the doubling only.

Where camunda-compat is stricter than Camunda 8.9, bpmn-cli follows camunda-compat:

- a flow without a condition next to conditional ones out of an exclusive or inclusive gateway
  without a default is refused at deploy (`W_C8_EXCLUSIVE_GATEWAY`, reported on the flow), as is a
  condition on a flow from an element that is no gateway (`W_C8_CONDITION_IGNORED`);
- an error or escalation that a catch event references needs its code (`W_C8_DEPLOY_ERROR`,
  `W_C8_DEPLOY_ESCALATION`);
- execution listeners `beforeAll` and `cancel` are accepted from 8.10 on;
- an intermediate catch or boundary event without an event definition is an unsupported element
  (`W_C8_DEPLOY_UNSUPPORTED`);
- a target an event-based gateway may not lead to is reported on the target, not the gateway
  (`W_C8_DEPLOY_EVENT_GATEWAY`).

bpmn-cli switches camunda-compat's `user-task-definition` off (a user task runs without a form),
reports `zeebe-user-task` as practice and checks FEEL with its own rules
(`bpmn-cli/c8-feel-expression-valid` and the `bpmn-cli/c8-*-needs-feel` rules, camunda-compat's
`feel` is off).

<details>
<summary>Camunda 7: code and rules</summary>

| code | rules |
| --- | --- |
| `W_C7_BAD_VALUE` | `bpmn-cli/c7-binding-known`, `bpmn-cli/c7-user-task-priority-valid`, `bpmn-cli/c7-variable-events-known`, `bpmn-cli/c7-camunda-boolean-valid` |
| `W_C7_DANGLING_REF` | `bpmn-cli/c7-camunda-reference-resolves` |
| `W_C7_DEPLOY_AD_HOC_SUBPROCESS` | `bpmn-cli/c7-ad-hoc-sub-process-no-flows`, `bpmn-cli/c7-ad-hoc-sub-process-no-multi-instance` |
| `W_C7_DEPLOY_BAD_VALUE` | `bpmn-cli/c7-job-priority-valid`, `bpmn-cli/c7-decision-result-mapper-known` |
| `W_C7_DEPLOY_BINDING_VERSION` | `bpmn-cli/c7-binding-needs-version` |
| `W_C7_DEPLOY_CALLED_ELEMENT` | `bpmn-cli/c7-call-activity-one-called-element` |
| `W_C7_DEPLOY_COMPLEX_GATEWAY` | `bpmn-cli/c7-complex-gateway-no-flows` |
| `W_C7_DEPLOY_ERROR` | `bpmn-cli/c7-error-end-event-needs-error`, `bpmn-cli/c7-error-needs-code` |
| `W_C7_DEPLOY_ESCALATION` | `bpmn-cli/c7-escalation-throw-needs-escalation`, `bpmn-cli/c7-escalation-needs-code`, `bpmn-cli/c7-escalation-boundary-host-allowed` |
| `W_C7_DEPLOY_EVENT_DEFINITION` | `bpmn-cli/c7-timer-needs-one-time-value`, `bpmn-cli/c7-compensation-names-own-activity`, `bpmn-cli/c7-conditional-event-needs-condition` |
| `W_C7_DEPLOY_EVENT_GATEWAY` | `bpmn-cli/c7-event-gateway-target-allowed`, `bpmn-cli/c7-event-gateway-branches-unique` |
| `W_C7_DEPLOY_EXCLUSIVE_GATEWAY` | `bpmn-cli/c7-exclusive-gateway-needs-outgoing`, `bpmn-cli/c7-exclusive-gateway-default-no-condition`, `bpmn-cli/c7-exclusive-gateway-needs-conditions` |
| `W_C7_DEPLOY_EXTENSION` | `bpmn-cli/c7-call-mapping-needs-source-and-target`, `bpmn-cli/c7-connector-needs-id`, `bpmn-cli/c7-io-parameter-needs-name`, `bpmn-cli/c7-form-field-needs-id-and-type`, `bpmn-cli/c7-field-needs-one-value` |
| `W_C7_DEPLOY_EXTERNAL_TOPIC` | `bpmn-cli/c7-external-task-needs-topic` |
| `W_C7_DEPLOY_FORM` | `bpmn-cli/c7-form-ref-no-form-key`, `bpmn-cli/c7-form-ref-needs-binding` |
| `W_C7_DEPLOY_HISTORY_TTL` | `camunda-compat/history-time-to-live`, `bpmn-cli/c7-history-time-to-live-valid` |
| `W_C7_DEPLOY_IMPLEMENTATION` | `bpmn-cli/c7-task-type-supported`, `bpmn-cli/c7-shell-task-needs-command`, `bpmn-cli/c7-shell-field-values-fixed`, `bpmn-cli/c7-task-needs-implementation` |
| `W_C7_DEPLOY_INPUT_OUTPUT` | `bpmn-cli/c7-io-mapping-host-allowed`, `bpmn-cli/c7-output-mapping-host-allowed` |
| `W_C7_DEPLOY_LINK` | `bpmn-cli/c7-link-catch-name-unique`, `bpmn-cli/c7-link-throw-needs-catch`, `bpmn-cli/c7-link-event-needs-name` |
| `W_C7_DEPLOY_LISTENER` | `bpmn-cli/c7-listener-needs-implementation`, `bpmn-cli/c7-listener-event-known`, `bpmn-cli/c7-listener-script-needs-format`, `bpmn-cli/c7-timeout-listener-needs-timer-and-id` |
| `W_C7_DEPLOY_MESSAGE` | `bpmn-cli/c7-message-subscription-unique`, `bpmn-cli/c7-message-event-needs-message`, `bpmn-cli/c7-message-needs-name` |
| `W_C7_DEPLOY_MULTI_INSTANCE` | `bpmn-cli/c7-multi-instance-needs-cardinality-or-collection`, `bpmn-cli/c7-element-variable-needs-collection` |
| `W_C7_DEPLOY_RESULT_VARIABLE` | `bpmn-cli/c7-result-variable-needs-expression` |
| `W_C7_DEPLOY_SCHEMA` | `bpmn-cli/c7-bpmn-attribute-known` |
| `W_C7_DEPLOY_SCRIPT` | `bpmn-cli/c7-script-task-needs-script` |
| `W_C7_DEPLOY_SIGNAL` | `bpmn-cli/c7-signal-name-unique`, `bpmn-cli/c7-signal-subscription-unique`, `bpmn-cli/c7-signal-event-needs-signal`, `bpmn-cli/c7-signal-needs-name` |
| `W_C7_DEPLOY_START_EVENT` | `bpmn-cli/c7-scope-needs-start-event`, `bpmn-cli/c7-start-event-unique` |
| `W_C7_EXCLUSIVE_GATEWAY_DEFAULT` | `bpmn-cli/c7-exclusive-gateway-needs-default` |
| `W_C7_FOREIGN_CONTENT` | `bpmn-cli/c7-no-zeebe-content` |
| `W_C7_MESSAGE_NO_IMPLEMENTATION` | `bpmn-cli/c7-message-throw-needs-implementation` |
| `W_C7_MISPLACED_ATTRIBUTE` | `bpmn-cli/c7-camunda-attribute-placement` |
| `W_C7_MISPLACED_EXTENSION` | `bpmn-cli/c7-camunda-extension-placement`, `bpmn-cli/c7-io-parameter-in-input-output` |
| `W_C7_TRANSACTION_NO_START` | `bpmn-cli/c7-transaction-needs-start-event` |
| `W_C7_UNKNOWN_ATTRIBUTE` | `bpmn-cli/c7-camunda-attribute-known` |
| `W_C7_UNKNOWN_ELEMENT` | `bpmn-cli/c7-camunda-element-known` |

</details>

<details>
<summary>Camunda 8: code and rules</summary>

| code | rules |
| --- | --- |
| `W_C8_BAD_VALUE` | `bpmn-cli/c8-job-retries-valid`, `bpmn-cli/c8-task-header-needs-key-and-value` |
| `W_C8_CONDITION_IGNORED` | `camunda-compat/sequence-flow-condition` |
| `W_C8_DEPLOY_AD_HOC_SUBPROCESS` | `camunda-compat/ad-hoc-sub-process`, `bpmn-cli/c8-ad-hoc-sub-process-no-start-or-end-event` |
| `W_C8_DEPLOY_CALLED_ELEMENT` | `camunda-compat/called-element`, `camunda-compat/no-business-id`, `camunda-compat/no-propagate-all-parent-variables` |
| `W_C8_DEPLOY_DUPLICATE_EXTENSION` | `bpmn-cli/c8-extension-element-unique` |
| `W_C8_DEPLOY_ERROR` | `camunda-compat/error-reference`, `bpmn-cli/c8-error-catch-needs-static-code`, `bpmn-cli/c8-error-event-interrupting`, `bpmn-cli/c8-error-code-unique` |
| `W_C8_DEPLOY_ESCALATION` | `camunda-compat/escalation-boundary-event-attached-to-ref`, `camunda-compat/escalation-reference` |
| `W_C8_DEPLOY_EVENT_DEFINITION` | `camunda-compat/wait-for-completion`, `bpmn-cli/c8-event-sub-process-start-needs-trigger`, `bpmn-cli/c8-compensation-names-own-activity`, `bpmn-cli/c8-compensation-boundary-needs-association`, `bpmn-cli/c8-compensation-boundary-no-outgoing-flow`, `bpmn-cli/c8-conditional-event-needs-condition` |
| `W_C8_DEPLOY_EVENT_GATEWAY` | `camunda-compat/event-based-gateway-target`, `bpmn-cli/c8-event-gateway-needs-two-branches`, `bpmn-cli/c8-event-gateway-target-allowed` |
| `W_C8_DEPLOY_EXECUTABLE` | `camunda-compat/executable-process` |
| `W_C8_DEPLOY_EXPRESSION` | `camunda-compat/feel`, `camunda-compat/feel-compatibility`, `camunda-compat/no-expression`, `bpmn-cli/c8-condition-needs-feel`, `bpmn-cli/c8-multi-instance-needs-feel`, `bpmn-cli/c8-script-needs-feel`, `bpmn-cli/c8-correlation-key-needs-feel`, `bpmn-cli/c8-feel-expression-valid` |
| `W_C8_DEPLOY_EXTENSION` | `camunda-compat/agent-fromai-contract`, `camunda-compat/agent-tool-documentation`, `camunda-compat/agent-tool-output-key`, `camunda-compat/connector-properties`, `camunda-compat/duplicate-task-headers`, `camunda-compat/io-mapping`, `camunda-compat/no-binding-type`, `camunda-compat/no-job-priority-definition`, `camunda-compat/no-version-tag`, `camunda-compat/no-zeebe-properties`, `camunda-compat/secrets`, `camunda-compat/start-event-form`, `camunda-compat/start-event-form-embedded`, `camunda-compat/unresolvable-secret-reference`, `camunda-compat/variable-name`, `camunda-compat/version-tag`, `bpmn-cli/c8-linked-resource-needs-type`, `bpmn-cli/c8-binding-type-known`, `bpmn-cli/c8-version-tag-binding-needs-tag`, `bpmn-cli/c8-conditional-filter-events-known` |
| `W_C8_DEPLOY_IMPLEMENTATION` | `camunda-compat/implementation`, `bpmn-cli/c8-thrown-message-needs-name`, `bpmn-cli/c8-publish-message-no-task-definition` |
| `W_C8_DEPLOY_LINK` | `camunda-compat/link-event`, `bpmn-cli/c8-link-event-needs-name`, `bpmn-cli/c8-link-throw-needs-catch` |
| `W_C8_DEPLOY_LISTENER` | `camunda-compat/before-all-execution-listener`, `camunda-compat/cancel-execution-listener`, `camunda-compat/duplicate-execution-listener-headers`, `camunda-compat/duplicate-execution-listeners`, `camunda-compat/execution-listener`, `camunda-compat/no-before-all-execution-listener`, `camunda-compat/no-cancel-execution-listener`, `camunda-compat/no-execution-listener-headers`, `camunda-compat/no-execution-listeners`, `camunda-compat/no-task-listeners`, `camunda-compat/task-listener`, `bpmn-cli/c8-sequence-flow-no-execution-listeners`, `bpmn-cli/c8-execution-listener-event-type-valid`, `bpmn-cli/c8-task-listeners-need-camunda-user-task`, `bpmn-cli/c8-task-listener-event-type-valid` |
| `W_C8_DEPLOY_MESSAGE` | `camunda-compat/message-reference`, `camunda-compat/subscription`, `bpmn-cli/c8-message-start-needs-static-name`, `bpmn-cli/c8-message-subscription-unique`, `bpmn-cli/c8-publish-message-needs-message`, `bpmn-cli/c8-publish-message-needs-correlation-key` |
| `W_C8_DEPLOY_MULTI_INSTANCE` | `camunda-compat/loop-characteristics` |
| `W_C8_DEPLOY_SCHEMA` | `bpmn-cli/c8-bpmn-attribute-known` |
| `W_C8_DEPLOY_SIGNAL` | `camunda-compat/signal-reference`, `bpmn-cli/c8-signal-start-needs-static-name`, `bpmn-cli/c8-signal-subscription-unique` |
| `W_C8_DEPLOY_START_EVENT` | `bpmnlint/start-event-required`, `camunda-compat/no-multiple-none-start-events`, `bpmn-cli/c8-embedded-start-event-no-trigger`, `bpmn-cli/c8-sub-process-start-event-unique` |
| `W_C8_DEPLOY_TIMER` | `camunda-compat/timer`, `bpmn-cli/c8-timer-value-valid` |
| `W_C8_DEPLOY_UNSUPPORTED` | `camunda-compat/collapsed-subprocess`, `camunda-compat/element-type`, `camunda-compat/inclusive-gateway`, `camunda-compat/no-interrupting-event-subprocess`, `camunda-compat/no-loop`, `camunda-compat/no-signal-event-sub-process` |
| `W_C8_DEPLOY_USER_TASK` | `camunda-compat/no-candidate-users`, `camunda-compat/no-priority-definition`, `camunda-compat/no-task-schedule`, `camunda-compat/no-zeebe-user-task`, `camunda-compat/priority-definition`, `camunda-compat/task-schedule`, `camunda-compat/user-task-definition`, `camunda-compat/user-task-form` |
| `W_C8_EXCLUSIVE_GATEWAY` | `camunda-compat/sequence-flow-condition` |
| `W_C8_EXPRESSION` | `bpmn-cli/c8-multi-instance-completion-needs-feel` |
| `W_C8_FOREIGN_CONTENT` | `bpmn-cli/c8-no-camunda-7-content` |
| `W_C8_JOB_WORKER_USER_TASK` | `camunda-compat/zeebe-user-task` |
| `W_C8_MISPLACED_ATTRIBUTE` | `bpmn-cli/c8-zeebe-attribute-placement` |
| `W_C8_MISPLACED_EXTENSION` | `bpmn-cli/c8-zeebe-extension-placement`, `bpmn-cli/c8-input-mapping-placement`, `bpmn-cli/c8-zeebe-element-placement` |
| `W_C8_STANDARD_LOOP` | `camunda-compat/loop-characteristics` |
| `W_C8_UNKNOWN_ATTRIBUTE` | `bpmn-cli/c8-zeebe-attribute-known` |
| `W_C8_UNKNOWN_ELEMENT` | `bpmn-cli/c8-zeebe-element-known` |
| `W_C8_UNSUPPORTED_IMPLEMENTATION` | `bpmn-cli/c8-publish-message-unsupported` |

</details>

## bpmnlint and camunda-compat

A project's `.bpmnlintrc` runs on top, as an advisory validator ([bpmnlint](bpmnlint.md)). When it
extends camunda-compat or the Miragon engine layers too, their findings are listed twice: once
under their bpmn-cli code, once under the rule name of the `.bpmnlintrc`.

## Next steps

- [bpmnlint](bpmnlint.md): run the project's `.bpmnlintrc` on every write.
- [Commands](commands.md): `set` and `ext` with all their options.
- [A worked session](walkthrough.md): a Camunda 8 model from an empty file.
