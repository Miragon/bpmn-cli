# bpmnlint

`bpmn validate` runs your project's `.bpmnlintrc`, the same rules CI runs. A write does not run them;
its state line points to `bpmn validate`.

## Set it up

Put a `.bpmnlintrc` next to the models or in the repository root. bpmnlint's rules, camunda-compat and
`@miragon/rules` ship with bpmn-cli.

::: code-group

```json [Camunda 8]
{
  "extends": ["bpmnlint:recommended", "plugin:camunda-compat/camunda-cloud-8-10"],
  "moddleExtensions": { "zeebe": "zeebe-bpmn-moddle/resources/zeebe.json" }
}
```

```json [Camunda 7]
{
  "extends": ["bpmnlint:recommended", "plugin:camunda-compat/camunda-platform-7-24"],
  "moddleExtensions": { "camunda": "camunda-bpmn-moddle/resources/camunda.json" }
}
```

```json [Modeling only]
{
  "extends": ["bpmnlint:recommended", "plugin:@miragon/rules/recommended-for-modeling"]
}
```

:::

Keep `moddleExtensions`: without it camunda-compat cannot see `camunda:` or `zeebe:` settings and
reports them missing.

bpmn-cli takes the nearest `.bpmnlintrc` from the model's folder up to the repository root.
`--lint-config <path>` picks another one, `--no-lint-config` runs none.

## Read the result

```console
$ bpmn validate models/order.bpmn
W_C7_DEPLOY_EXTERNAL_TOPIC serviceTask_bookOrder: serviceTask serviceTask_bookOrder is an external task without camunda:topic; the engines refuse the file  (`bpmn set <file> serviceTask_bookOrder camunda:topic=<topic>`.)
[bpmnlint] @miragon/rules/element-id-naming Activity_CheckOrder: Element id must match the naming convention <userTask_camelCase>
platform: c7 (modeler:executionPlatform "Camunda Platform") - 1 refused at deploy, 0 runtime, 0 practice finding(s)
validator bpmnlint (.bpmnlintrc in .): 0 error(s), 1 warning(s) in the file
layout: ok
valid, 2 warning(s)
```

`[bpmnlint error]` fails the check (exit 2), `[bpmnlint]` is a warning (exit 5 under `--strict`).
Under `bpmnlint:recommended` a fresh file from `bpmn new` fails until it has a start and an end event.

## Id conventions

New ids follow `@miragon/rules/element-id-naming`, so they pass that rule out of the box: a prefix
per type (`userTask_`, `gateway_`, `flow_`) and the name in camelCase. Configure the rule and new ids
follow your settings:

```json
{
  "extends": ["bpmnlint:recommended"],
  "rules": {
    "@miragon/rules/element-id-naming": ["warn", {
      "case": "snake_case",
      "prefixes": { "bpmn:UserTask": "ut_" }
    }]
  }
}
```

A user task "Check order" then becomes `ut_check_order`. `case` takes `camelCase`, `PascalCase`,
`snake_case`, `kebab-case` or `any`; a prefix of `false` switches a type off. `bpmn conventions <file>`
prints the pattern of each kind and where it comes from.

Existing ids are never renamed for the rule. `bpmn set <file> <id> id=<newId>` renames one, and every
reference follows. An explicit id (`--id`, `"id"` in a batch) is taken as given.

## Untrusted repositories

A `.bpmnlintrc` can name plugins from the repository's `node_modules`, and `bpmn validate` then runs
their code, as `npx bpmnlint` would. That happens only inside a git repository owned by the current
user. In a repository you do not trust, pass `--no-lint-config`; the Claude Code skill does so too.
When the project installs a plugin bpmn-cli also ships, the project's copy runs.

## Troubleshooting

| symptom | fix |
| --- | --- |
| `W_LINT_UNAVAILABLE ... is not installed` | install the plugin next to the `.bpmnlintrc`, or remove it from the configuration |
| `W_LINT_UNAVAILABLE` for the `.bpmnlintrc` itself | the file must be strict JSON: no comments, no trailing commas |
| `import-warning` | bpmnlint cannot read an attribute: add the moddle extension that declares it |
| `W_LINT_FAILED` | a rule threw; its findings are left out |
