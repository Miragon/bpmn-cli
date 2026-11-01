# bpmnlint

`bpmn validate` runs your project's `.bpmnlintrc`, the same gate CI runs. A write does not: it loads no
plugin code, and its state line says that `bpmn validate` lists the rest.

::: tip From the CLI
`bpmn guide bpmnlint` and `bpmn guide conventions` print the short form.
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
| `--no-lint-config` | no bpmnlint |
| no `.bpmnlintrc` found | nothing of bpmnlint |

bpmnlint's own CLI reads the `.bpmnlintrc` of the working directory. bpmn-cli takes the one nearest to
the model, so keep one per repository, or let CI use the same files.

## validate

An error reads `[bpmnlint error] <rule>` and fails the check (exit 2). A warning reads
`[bpmnlint] <rule>`; `--strict` exits 5 on it. Three or more findings of one rule are one line.
A finding the structure checks already report, such as a dead end, is listed once.

```console
$ bpmn validate models/order.bpmn
W_C7_DEPLOY_EXTERNAL_TOPIC serviceTask_bookOrder: serviceTask serviceTask_bookOrder is an external task without camunda:topic; the engines refuse the file  (`bpmn set <file> serviceTask_bookOrder camunda:topic=<topic>`.)
[bpmnlint] @miragon/rules/element-id-naming Activity_CheckOrder: Element id must match the naming convention <userTask_camelCase>
platform: c7 (modeler:executionPlatform "Camunda Platform") - 1 refused at deploy, 0 runtime, 0 practice finding(s)
validator bpmnlint (.bpmnlintrc in .): 0 error(s), 1 warning(s) in the file
layout: ok
valid, 2 warning(s)
```

Under `bpmnlint:recommended` a file from `bpmn new` has no start and no end event yet, so `bpmn validate`
exits 2 until the first batch adds them.

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

With it, a user task "Check order" becomes `ut_check_order` and a start event "Order received"
`startEvent_order_received`. A taken id gets `_2` under snake_case (`ut_check_order_2`), `2` under camelCase and PascalCase
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

An explicit id is taken as given: `--id` on `bpmn add`, `"id"` in an operation, `--flow-id` /
`"flowId"` for the flow into a new node and `"joinId"` for the join of a split.

### Checking

`bpmn conventions <file>` lists the patterns new ids follow and where they come from, also for a file
that does not exist yet:

```console
$ bpmn conventions models/order.bpmn
conventions of models/order.bpmn
element-id-naming (.bpmnlintrc in .): warn, case snake_case, eventDefinitionQualifier required
  task_{name:snake}              task
  ut_{name:snake}                userTask
  serviceTask_{name:snake}       serviceTask
...
  gateway_{name:snake}           exclusiveGateway parallelGateway inclusiveGateway complexGateway eventBasedGateway
  startEvent_{name:snake}        startEvent
...
```

Without a `.bpmnlintrc` it says so and lists the rule's defaults. `bpmn validate` reports ids that break
the rule. A value new ids cannot follow (a prefix that cannot start an id, an unknown case) gets a
`W_CONFIG_IGNORED` note.

## Project code

bpmn-cli's bundled rules and the repository's `node_modules` can both serve a plugin. When the project
installs a plugin that bpmn-cli also bundles, the project's copy runs, as it does in the project's CI; the
bundled copy runs only when the project has none. A rule the project's copy lacks is left out and named.

Project code runs only inside a git repository owned by the user running bpmn-cli. A plugin that cannot
be resolved or may not run is left out with one `W_LINT_UNAVAILABLE` that says why; the rest runs.

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

## Next steps

- [Camunda 7 and Camunda 8](camunda.md): the engine rules bpmn-cli checks itself.
- [Commands](commands.md): `validate` and the options of every write.
- [Validators](validators.md): a host's own rules inside a write.
