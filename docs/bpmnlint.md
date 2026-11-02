# bpmnlint

bpmn-cli runs your project's `.bpmnlintrc` in `bpmn validate` and in every write. The agent sees a
rule violation in the result of the command that caused it, not later in CI.

::: tip From the CLI
`bpmn guide bpmnlint` and `bpmn guide conventions` print the full reference.
:::

## Quick start

Put a `.bpmnlintrc` next to the models or in the repository root. bpmnlint's rules, camunda-compat
and `@miragon/rules` come with bpmn-cli and need no install.

::: code-group

```json [Camunda 8]
{
  "extends": [
    "bpmnlint:recommended",
    "plugin:camunda-compat/camunda-cloud-8-10"
  ],
  "moddleExtensions": {
    "zeebe": "zeebe-bpmn-moddle/resources/zeebe.json"
  }
}
```

```json [Camunda 7]
{
  "extends": [
    "bpmnlint:recommended",
    "plugin:camunda-compat/camunda-platform-7-24"
  ],
  "moddleExtensions": {
    "camunda": "camunda-bpmn-moddle/resources/camunda.json"
  }
}
```

```json [Modeling only]
{
  "extends": [
    "bpmnlint:recommended",
    "plugin:@miragon/rules/recommended-for-modeling"
  ]
}
```

:::

Keep the `moddleExtensions` entry. Without it camunda-compat sees no `camunda:` or `zeebe:`
properties and reports them missing, as bpmnlint does in CI.

bpmn-cli runs camunda-compat and the Miragon engine layer for every Camunda 7 / 8 file anyway, as
its `W_C7_*` / `W_C8_*` findings ([Camunda 7 and Camunda 8](camunda.md#where-the-checks-come-from)).
Extend them in the `.bpmnlintrc` when CI runs `npx bpmnlint` too: the same findings are then listed
twice, once under their code and once under the rule name.

::: warning Untrusted repositories
A `.bpmnlintrc` can name plugins of the repository, and `bpmn validate` then runs their code, as
`npx bpmnlint` would. In a repository you do not trust, pass `--no-lint-config`. See
[Project code](#project-code).
:::

## Which configuration runs

| case | what runs |
| --- | --- |
| default | the nearest `.bpmnlintrc` from the model's directory up to the repository root |
| `--lint-config <path>` | that file (must exist and be strict JSON, else `E_LINT_CONFIG`) |
| `--no-lint-config` | no bpmnlint, no [id conventions](#id-conventions) |
| no `.bpmnlintrc` found | nothing of bpmnlint |

bpmnlint's own CLI reads the `.bpmnlintrc` of the working directory. bpmn-cli takes the one nearest to
the model, so keep one per repository, or let CI use the same files.

## validate

An error reads `[bpmnlint error] <rule>` and fails the check (exit 2). A warning reads
`[bpmnlint] <rule>`; `--strict` exits 5 on it. Three or more findings of one rule are one line.

```console
$ bpmn validate models/order.bpmn
[bpmnlint error] local/external-task-topic serviceTask_bookOrder: External task has no topic
W_C7_DEPLOY_EXTERNAL_TOPIC serviceTask_bookOrder: serviceTask serviceTask_bookOrder is an external task without camunda:topic; the engines refuse the file  (`bpmn set <file> serviceTask_bookOrder camunda:topic=<topic>`.)
[bpmnlint] @miragon/rules/element-id-naming x3 [Event_OrderReceived]: Element id must match the naming convention <startEvent_camelCase> (1 of 3; 2 others with 2 other messages, --json lists them)
platform: c7 (modeler:executionPlatform "Camunda Platform") - 1 refused at deploy, 0 runtime, 0 practice finding(s)
validator bpmnlint (.bpmnlintrc in .; project plugins: bpmnlint-plugin-local@1.0.0): 1 error(s), 3 warning(s) in the file
layout: ok
1 error(s), 4 warning(s)
```

## Writes

A write lists only the findings the change added and never refuses because of them. The rest is
counted in the validator line.

```console
$ bpmn add models/order.bpmn serviceTask "Book order" --after Activity_CheckOrder camunda:type=external
created serviceTask serviceTask_bookOrder "Book order" - after Activity_CheckOrder
...
warning W_C7_DEPLOY_EXTERNAL_TOPIC serviceTask_bookOrder: serviceTask serviceTask_bookOrder is an external task without camunda:topic; the engines refuse the file  (`bpmn set <file> serviceTask_bookOrder camunda:topic=<topic>`.)
warning [bpmnlint error] local/external-task-topic serviceTask_bookOrder: External task has no topic
validator bpmnlint (.bpmnlintrc in .; project plugins: bpmnlint-plugin-local@1.0.0): 1 error(s), 3 warning(s) in the result (1 added, 0 resolved, 3 already in the file)
layout: ok - full (engine-owned diagram: redrawn)
written: models/order.bpmn
```

The new ids follow `element-id-naming`, so the write adds none of its findings. Under
`bpmnlint:recommended` a file from `bpmn new` has no start and no end event yet, so `bpmn validate`
exits 2 until the first `apply` batch adds them.

## Id conventions

`@miragon/rules/element-id-naming` sets a prefix per BPMN type (`serviceTask_`, `gateway_`,
`flow_`) and the case of the rest. The ids bpmn-cli generates always follow it, so they pass the
rule as soon as someone turns it on.

### Without a .bpmnlintrc

New ids follow the rule's defaults, in camelCase, whatever ids the file already has:

| element | prefix | example |
| --- | --- | --- |
| start / end event | `startEvent_`, `endEvent_` | `startEvent_orderReceived` |
| boundary and intermediate event | `event_` | `event_paymentOverdue` |
| task of each type | `task_`, `userTask_`, `serviceTask_`, `sendTask_`, ... | `userTask_checkOrder` |
| call activity, sub-process | `callActivity_`, `subProcess_` | `subProcess_archiveInvoice` |
| every gateway | `gateway_` | `gateway_orderOk` |
| sequence flow, message flow | `flow_`, `messageFlow_` | `flow_checkOrderToShipOrder` |
| pool, lane, collaboration | `participant_`, `lane_`, `collaboration_` | `lane_accounting` |
| data object, data store (reference) | `dataObject_`, `dataStore_` | `dataObject_invoice` |
| text annotation, group, association | `textAnnotation_`, `group_`, `association_` | `group_payment` |

An event with a trigger takes the plain prefix (`event_paymentOverdue`); the qualified one
(`timerEvent_paymentOverdue`) passes the rule too.

### With element-id-naming in the .bpmnlintrc

Its `prefixes`, `case` (`camelCase`, `PascalCase`, `snake_case`, `kebab-case`, `any`) and
`eventDefinitionQualifier` decide. The configured prefixes replace the defaults per type; `false`
switches a type off.

```json
{
  "extends": ["bpmnlint:recommended"],
  "rules": {
    "@miragon/rules/element-id-naming": ["warn", {
      "case": "snake_case",
      "eventDefinitionQualifier": "required",
      "prefixes": { "bpmn:UserTask": "ut_", "bpmn:Lane": false }
    }]
  }
}
```

With it, a user task "Check order" becomes `ut_check_order`, a timer boundary event
`timerEvent_payment_overdue` and the flow between two tasks `flow_check_order_to_ship_order`. A
taken id gets `_2` under snake_case (`ut_check_order_2`), `2` under camelCase and PascalCase
(`userTask_checkOrder2`) and `-2` under kebab-case. Under `any` the body is camelCase.

### Types the rule does not check

The rule leaves some types out on purpose, and a `.bpmnlintrc` can switch more off. Their new ids
take bpmn-cli's own prefix: the type's name in lower camelCase, with the first letter of the
declared prefixes (`Message_` next to `Activity_`) and the body in the declared case.

| type | prefix | why |
| --- | --- | --- |
| process | none: a named process is its name (`orderToCash`), an unnamed one `Process_1` | the process id is the deployment key and the target of call activities, so it names the business process; a new pool's process takes the pool's name; a declared `bpmn:Process` prefix wins |
| definitions | `definitions_` (unnamed: `Definitions_1`) | |
| message, signal, error, escalation | `message_`, `signal_`, `error_`, `escalation_` | root elements, found and named by their name |
| lane set, category, category value, property | `laneSet_`, `category_`, `categoryValue_`, `property_` | |
| data object, data store (the backing element) | `dataObjectItem_`, `dataStoreItem_` | apart from the reference's `dataObject_`, so both get the same name without a suffix |
| event definition and any other type | its name: `timerEventDefinition_` | |

### Existing ids

Ids the file already has are never renamed, also where they break the rule:
`bpmn set <file> <id> id=<newId>` renames one, and its flows and DI follow. After a `retype` or a
trigger change under declared conventions, `W_ID_PREFIX_STALE` names an id whose prefix no longer
fits, with the `bpmn set` that renames it. A flow whose id names its ends in the form above
(`flow_checkOrderToShipOrder`) is renamed when an edit gives it other ends; an older one
(`Flow_CheckOrderToShipOrder`, `SequenceFlow_1`) keeps its id.

### Choosing ids yourself

An explicit id is taken as given: `--id` on `bpmn add`, `"id"` in an `apply` op, `--flow-id` /
`"flowId"` for the flow into a new node and `"joinId"` for the join of a split.

### Checking

`bpmn show <file> --conventions` lists the patterns new ids follow and where each comes from, also
for a file that does not exist yet:

```console
$ bpmn show models/order.bpmn --conventions
conventions of models/order.bpmn
element-id-naming (.bpmnlintrc in .): warn, case camelCase, eventDefinitionQualifier optional
  <kind>_{name:camel}             lint      task userTask serviceTask scriptTask sendTask receiveTask manualTask businessRuleTask subProcess callActivity startEvent endEvent participant lane dataObject dataStore textAnnotation group collaboration
  subProcess_{name:camel}         lint      eventSubProcess adHocSubProcess transaction
  gateway_{name:camel}            lint      exclusiveGateway parallelGateway inclusiveGateway complexGateway eventBasedGateway
  event_{name:camel}              lint      intermediateCatchEvent intermediateThrowEvent boundaryEvent
  {name:camel}                    bpmn-cli  process (not checked; unnamed: Process_1)
  message_{name:camel}            bpmn-cli  message (not checked)
  flow_{source}To{target}         lint      sequenceFlow
  messageFlow_{source}To{target}  lint      messageFlow
  events with a trigger: <trigger><Prefix> (timerStartEvent_, messageEvent_, errorEndEvent_) also accepted, new ids take the plain prefix
sources: lint = element-id-naming; bpmn-cli = bpmn-cli's own prefix for a type element-id-naming does not check
```

The sources: `lint` is the `.bpmnlintrc`'s `element-id-naming`, `default` its defaults with nothing
declared (no `.bpmnlintrc`, `--no-lint-config`, the rule off), `bpmn-cli` a type the rule does not
check. `bpmn validate` reports ids that break the rule.
A value new ids cannot follow (a prefix that cannot start an id, an unknown case) gets a
`W_CONFIG_IGNORED` note.

::: warning Breaking change
Earlier versions learned the id style from the file's own ids (`Activity_CheckOrder`,
`Flow_CheckOrderToShipOrder`). A file without a `.bpmnlintrc` now gets the defaults above even
where its existing ids look different. Library hosts that call `idConventionsFromLint` pass the
`naming` namespace of `@miragon/bpmnlint-plugin-rules` 0.19 or later.
:::

## Project code

A rule resolves from bpmn-cli's bundled rules first, then from the repository's `node_modules`. Only
that last source runs project code, and only inside a git repository owned by the user running
bpmn-cli. A plugin that cannot be resolved or may not run is left out with one `W_LINT_UNAVAILABLE`
that says why; the rest runs.

In Claude Code the skill pre-approves `bpmn` commands, so project plugin code runs without a
prompt. In a repository you do not trust, pass `--no-lint-config`.

## Troubleshooting

| symptom | cause and fix |
| --- | --- |
| `W_LINT_UNAVAILABLE ... is not installed` | install the plugin next to the `.bpmnlintrc`, or remove it from the configuration |
| `W_LINT_UNAVAILABLE` for the `.bpmnlintrc` itself | the file is not strict JSON: no comments, no trailing commas |
| `import-warning` error | bpmnlint cannot read an attribute: add a moddle extension that declares it |
| dead ends reported on nodes that have flows | the file keeps no `incoming` / `outgoing` lists; bpmnlint in CI reports them too |
| `W_LINT_FAILED` | a rule threw; its findings are left out |
| `W_LINT_UNAVAILABLE: bpmnlint could not be loaded` | the project's bpmnlint is older than 11.14: update it, or run bpmn-cli with `npx` |

A long-running host keeps a project plugin that loaded; restart it after changing the plugin.

## Next steps

- [Camunda 7 and Camunda 8](camunda.md): the engine rules bpmn-cli checks itself.
- [Commands](commands.md): `validate` and the options of every write.
- [Validators](validators.md): the same validator in a host that embeds the library.
