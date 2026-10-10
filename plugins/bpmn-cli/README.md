# bpmn-cli plugin for Claude Code

One skill, `bpmn` (invoked as `bpmn-cli:bpmn`), that makes Claude create, read, change, format
and validate BPMN 2.0 models with [@miragon/bpmn-cli](https://github.com/Miragon/bpmn-cli)
instead of writing BPMN XML: elements by id, explicit speaking ids, one `apply` batch per change,
hand-made drawings kept, formatting by naming elements, Camunda 7 / Camunda 8 settings, and
`bpmn validate` before a model is called done.

Install it from the marketplace in this repository:

```
/plugin marketplace add Miragon/bpmn-cli
/plugin install bpmn-cli@miragon-bpmn
```

The skill runs `bpmn` when it is on `PATH`, else `npx -y @miragon/bpmn-cli@<version>` with the
version of this plugin (Node 20+). It pre-approves only those two commands.

- `skills/bpmn/SKILL.md` - the standing rules and the core loop; `skills/bpmn/reference/` - batch
  format, formatting, Camunda 7, Camunda 8 and complete recipes, loaded when needed
- `evals/` - the eval suite (`claude plugin eval`), see [evals/README.md](evals/README.md)

The plugin's version is the package version; release-please bumps it together with the pinned
`npx` version. See the repository README, section "Claude Code plugin".
