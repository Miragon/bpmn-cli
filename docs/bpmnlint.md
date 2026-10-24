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
[bpmnlint] @miragon/rules/element-id-naming x4 [Event_OrderReceived]: Element id must match the naming convention <startEvent_camelCase> (1 of 4; 3 others with 3 other messages, --json lists them)
platform: c7 (modeler:executionPlatform "Camunda Platform") - 1 refused at deploy, 0 runtime, 0 practice finding(s)
validator bpmnlint (.bpmnlintrc in .; project plugins: bpmnlint-plugin-local@1.0.0): 1 error(s), 4 warning(s) in the file
layout: ok
1 error(s), 5 warning(s)
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
resolved: [bpmnlint] @miragon/rules/element-id-naming Flow_CheckOrderToOrderChecked
validator bpmnlint (.bpmnlintrc in .; project plugins: bpmnlint-plugin-local@1.0.0): 1 error(s), 4 warning(s) in the result (1 added, 1 resolved, 4 already in the file)
conventions: serviceTask_bookOrder, flow_checkOrderToBookOrder, flow_bookOrderToOrderChecked follow element-id-naming (.bpmnlintrc in .), not the file's own id style  (`bpmn show <file> --conventions`)
layout: ok - full (engine-owned diagram: redrawn)
written: models/order.bpmn
```

The new ids follow `element-id-naming`, so the write adds none of its findings. Under
`bpmnlint:recommended` a file from `bpmn new` has no start and no end event yet, so `bpmn validate`
exits 2 until the first `apply` batch adds them.

## Id conventions

`@miragon/rules/element-id-naming` sets a prefix per BPMN type (`serviceTask_`, `gateway_`, `flow_`)
and the case of the rest. When the `.bpmnlintrc` turns it on, the ids bpmn-cli generates follow it.
Ids the file already has are never renamed; `bpmn set <file> <id> id=<newId>` renames one.

`bpmn show <file> --conventions` lists the patterns new ids follow and where each comes from, also
for a file that does not exist yet:

```console
$ bpmn show models/order.bpmn --conventions
conventions of models/order.bpmn
element-id-naming (.bpmnlintrc in .): warn, case camelCase, eventDefinitionQualifier optional
  <kind>_{name:camel}                lint        task userTask serviceTask scriptTask sendTask receiveTask manualTask businessRuleTask subProcess callActivity startEvent endEvent
  subProcess_{name:camel}            lint        eventSubProcess adHocSubProcess transaction
  gateway_{name:camel}               lint        exclusiveGateway parallelGateway inclusiveGateway complexGateway eventBasedGateway
  event_{name:camel}                 lint        intermediateCatchEvent intermediateThrowEvent boundaryEvent
  <Kind>_{name:pascal}               file        participant lane textAnnotation group collaboration message (not checked)
  DataObjectReference_{name:pascal}  file        dataObject (not checked)
  DataStoreReference_{name:pascal}   file        dataStore (not checked)
  Process_{name:pascal}              default     process (not checked)
  flow_{source}To{target}            lint        sequenceFlow
  flow_{source}To{target}            lint shape  messageFlow (not checked)
  events with a trigger: <trigger><Prefix> (timerStartEvent_, messageEvent_, errorEndEvent_) also accepted, new ids take the plain prefix
sources: lint = element-id-naming; file = the file's ids; default = bpmn-cli's default; lint shape = shaped like the declared prefixes (the file shows none)
```

What the rule does not name (pools, lanes, data) follows the file's own id style. After a `retype`,
`W_ID_PREFIX_STALE` names an id whose prefix no longer fits, with the `bpmn set` that renames it.

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
