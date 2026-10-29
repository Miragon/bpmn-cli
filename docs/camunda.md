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
- bpmn-cli's own rules for what camunda-compat leaves out, nine for Camunda 7 and eight for Camunda 8 in
  `src/adapters/out/bpmnlint/engine/rules/`, written on the plugin's `EngineRule`: `c7-events`,
  `c7-flows`, `c7-implementation`, `c7-values`, `c7-extension-content`, `c7-vendor-content` and
  `c8-events`, `c8-subscriptions`, `c8-extensions`, `c8-vendor-content`, `c8-feel-expression`
  (`bpmn-cli/<rule>`). Each declares the checks it reports with their code and
  severity, and gives its hint with the finding;
- among them the rules on content the engine's parser drops or rewrites, which read the file as
  written: `c7-unprefixed-attributes`, `c7-camunda-booleans`, `c7-unknown-vendor-elements` and
  `c8-unprefixed-attributes`, `c8-publish-message`, `c8-unknown-vendor-elements`.

bpmn-cli maps each camunda-compat rule to its code. The hint of a camunda-compat finding is built
from where it points; its message is camunda-compat's. A rule's severity says what the finding
means: `error` is deploy, `warn` runtime, `info` practice.

Where camunda-compat reads a file differently than Camunda 8.9 (engine-checked), bpmn-cli drops its
finding and follows the engine: white space only is a value for a job type, a message, signal,
process or decision name, a result variable, a listener type, an error or escalation code and a link
name; timer values are read as Camunda 8 parses them (`bpmn-cli/c8-events`); a
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
reports `zeebe-user-task` as practice and checks FEEL with its own rule (`bpmn-cli/c8-feel-expression`,
camunda-compat's `feel` is off).

<details>
<summary>Camunda 7: code and rules</summary>

| code | rules |
| --- | --- |
| `W_C7_BAD_VALUE` | `bpmn-cli/c7-values`, `bpmn-cli/c7-camunda-booleans` |
| `W_C7_DANGLING_REF` | `bpmn-cli/c7-vendor-content` |
| `W_C7_DEPLOY_AD_HOC_SUBPROCESS` | `bpmn-cli/c7-flows` |
| `W_C7_DEPLOY_BAD_VALUE` | `bpmn-cli/c7-values` |
| `W_C7_DEPLOY_BINDING_VERSION` | `bpmn-cli/c7-values` |
| `W_C7_DEPLOY_CALLED_ELEMENT` | `bpmn-cli/c7-values` |
| `W_C7_DEPLOY_COMPLEX_GATEWAY` | `bpmn-cli/c7-flows` |
| `W_C7_DEPLOY_ERROR` | `bpmn-cli/c7-events` |
| `W_C7_DEPLOY_ESCALATION` | `bpmn-cli/c7-events` |
| `W_C7_DEPLOY_EVENT_DEFINITION` | `bpmn-cli/c7-events` |
| `W_C7_DEPLOY_EVENT_GATEWAY` | `bpmn-cli/c7-flows` |
| `W_C7_DEPLOY_EXCLUSIVE_GATEWAY` | `bpmn-cli/c7-flows` |
| `W_C7_DEPLOY_EXTENSION` | `bpmn-cli/c7-extension-content` |
| `W_C7_DEPLOY_EXTERNAL_TOPIC` | `bpmn-cli/c7-implementation` |
| `W_C7_DEPLOY_FORM` | `bpmn-cli/c7-values` |
| `W_C7_DEPLOY_HISTORY_TTL` | `camunda-compat/history-time-to-live`, `bpmn-cli/c7-values` |
| `W_C7_DEPLOY_IMPLEMENTATION` | `bpmn-cli/c7-implementation` |
| `W_C7_DEPLOY_INPUT_OUTPUT` | `bpmn-cli/c7-extension-content` |
| `W_C7_DEPLOY_LINK` | `bpmn-cli/c7-events` |
| `W_C7_DEPLOY_LISTENER` | `bpmn-cli/c7-extension-content` |
| `W_C7_DEPLOY_MESSAGE` | `bpmn-cli/c7-events` |
| `W_C7_DEPLOY_MULTI_INSTANCE` | `bpmn-cli/c7-values` |
| `W_C7_DEPLOY_RESULT_VARIABLE` | `bpmn-cli/c7-implementation` |
| `W_C7_DEPLOY_SCHEMA` | `bpmn-cli/c7-unprefixed-attributes` |
| `W_C7_DEPLOY_SCRIPT` | `bpmn-cli/c7-implementation` |
| `W_C7_DEPLOY_SIGNAL` | `bpmn-cli/c7-events` |
| `W_C7_DEPLOY_START_EVENT` | `bpmn-cli/c7-flows` |
| `W_C7_EXCLUSIVE_GATEWAY_DEFAULT` | `bpmn-cli/c7-flows` |
| `W_C7_FOREIGN_CONTENT` | `bpmn-cli/c7-vendor-content` |
| `W_C7_MESSAGE_NO_IMPLEMENTATION` | `bpmn-cli/c7-implementation` |
| `W_C7_MISPLACED_ATTRIBUTE` | `bpmn-cli/c7-vendor-content` |
| `W_C7_MISPLACED_EXTENSION` | `bpmn-cli/c7-vendor-content`, `bpmn-cli/c7-unknown-vendor-elements` |
| `W_C7_TRANSACTION_NO_START` | `bpmn-cli/c7-flows` |
| `W_C7_UNKNOWN_ATTRIBUTE` | `bpmn-cli/c7-vendor-content` |
| `W_C7_UNKNOWN_ELEMENT` | `bpmn-cli/c7-unknown-vendor-elements` |

</details>

<details>
<summary>Camunda 8: code and rules</summary>

| code | rules |
| --- | --- |
| `W_C8_BAD_VALUE` | `bpmn-cli/c8-extensions` |
| `W_C8_CONDITION_IGNORED` | `camunda-compat/sequence-flow-condition` |
| `W_C8_DEPLOY_AD_HOC_SUBPROCESS` | `camunda-compat/ad-hoc-sub-process`, `bpmn-cli/c8-events` |
| `W_C8_DEPLOY_CALLED_ELEMENT` | `camunda-compat/called-element`, `camunda-compat/no-business-id`, `camunda-compat/no-propagate-all-parent-variables` |
| `W_C8_DEPLOY_DUPLICATE_EXTENSION` | `bpmn-cli/c8-extensions` |
| `W_C8_DEPLOY_ERROR` | `camunda-compat/error-reference`, `bpmn-cli/c8-subscriptions` |
| `W_C8_DEPLOY_ESCALATION` | `camunda-compat/escalation-boundary-event-attached-to-ref`, `camunda-compat/escalation-reference` |
| `W_C8_DEPLOY_EVENT_DEFINITION` | `camunda-compat/wait-for-completion`, `bpmn-cli/c8-events` |
| `W_C8_DEPLOY_EVENT_GATEWAY` | `camunda-compat/event-based-gateway-target`, `bpmn-cli/c8-events` |
| `W_C8_DEPLOY_EXECUTABLE` | `camunda-compat/executable-process` |
| `W_C8_DEPLOY_EXPRESSION` | `camunda-compat/feel`, `camunda-compat/feel-compatibility`, `camunda-compat/no-expression`, `bpmn-cli/c8-feel-expression` |
| `W_C8_DEPLOY_EXTENSION` | `camunda-compat/agent-fromai-contract`, `camunda-compat/agent-tool-documentation`, `camunda-compat/agent-tool-output-key`, `camunda-compat/connector-properties`, `camunda-compat/duplicate-task-headers`, `camunda-compat/io-mapping`, `camunda-compat/no-binding-type`, `camunda-compat/no-job-priority-definition`, `camunda-compat/no-version-tag`, `camunda-compat/no-zeebe-properties`, `camunda-compat/secrets`, `camunda-compat/start-event-form`, `camunda-compat/start-event-form-embedded`, `camunda-compat/unresolvable-secret-reference`, `camunda-compat/variable-name`, `camunda-compat/version-tag`, `bpmn-cli/c8-extensions` |
| `W_C8_DEPLOY_IMPLEMENTATION` | `camunda-compat/implementation`, `bpmn-cli/c8-subscriptions`, `bpmn-cli/c8-publish-message` |
| `W_C8_DEPLOY_LINK` | `camunda-compat/link-event`, `bpmn-cli/c8-events` |
| `W_C8_DEPLOY_LISTENER` | `camunda-compat/before-all-execution-listener`, `camunda-compat/cancel-execution-listener`, `camunda-compat/duplicate-execution-listener-headers`, `camunda-compat/duplicate-execution-listeners`, `camunda-compat/execution-listener`, `camunda-compat/no-before-all-execution-listener`, `camunda-compat/no-cancel-execution-listener`, `camunda-compat/no-execution-listener-headers`, `camunda-compat/no-execution-listeners`, `camunda-compat/no-task-listeners`, `camunda-compat/task-listener`, `bpmn-cli/c8-extensions` |
| `W_C8_DEPLOY_MESSAGE` | `camunda-compat/message-reference`, `camunda-compat/subscription`, `bpmn-cli/c8-subscriptions`, `bpmn-cli/c8-publish-message` |
| `W_C8_DEPLOY_MULTI_INSTANCE` | `camunda-compat/loop-characteristics` |
| `W_C8_DEPLOY_SCHEMA` | `bpmn-cli/c8-unprefixed-attributes` |
| `W_C8_DEPLOY_SIGNAL` | `camunda-compat/signal-reference`, `bpmn-cli/c8-subscriptions` |
| `W_C8_DEPLOY_START_EVENT` | `bpmnlint/start-event-required`, `camunda-compat/no-multiple-none-start-events`, `bpmn-cli/c8-events` |
| `W_C8_DEPLOY_TIMER` | `camunda-compat/timer`, `bpmn-cli/c8-events` |
| `W_C8_DEPLOY_UNSUPPORTED` | `camunda-compat/collapsed-subprocess`, `camunda-compat/element-type`, `camunda-compat/inclusive-gateway`, `camunda-compat/no-interrupting-event-subprocess`, `camunda-compat/no-loop`, `camunda-compat/no-signal-event-sub-process` |
| `W_C8_DEPLOY_USER_TASK` | `camunda-compat/no-candidate-users`, `camunda-compat/no-priority-definition`, `camunda-compat/no-task-schedule`, `camunda-compat/no-zeebe-user-task`, `camunda-compat/priority-definition`, `camunda-compat/task-schedule`, `camunda-compat/user-task-definition`, `camunda-compat/user-task-form` |
| `W_C8_EXCLUSIVE_GATEWAY` | `camunda-compat/sequence-flow-condition` |
| `W_C8_EXPRESSION` | `bpmn-cli/c8-extensions` |
| `W_C8_FOREIGN_CONTENT` | `bpmn-cli/c8-vendor-content` |
| `W_C8_JOB_WORKER_USER_TASK` | `camunda-compat/zeebe-user-task` |
| `W_C8_MISPLACED_ATTRIBUTE` | `bpmn-cli/c8-vendor-content` |
| `W_C8_MISPLACED_EXTENSION` | `bpmn-cli/c8-vendor-content`, `bpmn-cli/c8-unknown-vendor-elements` |
| `W_C8_STANDARD_LOOP` | `camunda-compat/loop-characteristics` |
| `W_C8_UNKNOWN_ATTRIBUTE` | `bpmn-cli/c8-vendor-content` |
| `W_C8_UNKNOWN_ELEMENT` | `bpmn-cli/c8-unknown-vendor-elements` |
| `W_C8_UNSUPPORTED_IMPLEMENTATION` | `bpmn-cli/c8-publish-message` |

</details>

## bpmnlint and camunda-compat

A project's `.bpmnlintrc` runs on top, as an advisory validator ([bpmnlint](bpmnlint.md)). When it
extends camunda-compat or the Miragon engine layers too, their findings are listed twice: once
under their bpmn-cli code, once under the rule name of the `.bpmnlintrc`.

## Next steps

- [bpmnlint](bpmnlint.md): run the project's `.bpmnlintrc` on every write.
- [Commands](commands.md): `set` and `ext` with all their options.
- [A worked session](walkthrough.md): a Camunda 8 model from an empty file.
