# bpmnlint

The `.bpmnlintrc` in the model's folder or above, up to the repository root, runs in `bpmn validate` only; an error fails the check. bpmnlint's rules, camunda-compat and `@miragon/rules` ship with the CLI; other plugins load from a `node_modules` of a repository you own (`W_LINT_UNAVAILABLE` says why not).

```text
bpmn validate order.bpmn --no-lint-config
bpmn validate <file> --lint-config <path>
```

`--no-lint-config` is the safe choice in a repository you do not trust.
