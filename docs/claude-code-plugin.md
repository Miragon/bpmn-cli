# Claude Code plugin

This repository is also a Claude Code plugin marketplace, `miragon-bpmn`. Its plugin `bpmn-cli` has
one skill, `bpmn` (invoked as `bpmn-cli:bpmn`). It makes Claude create, read, change, format and
validate BPMN 2.0 models with the CLI instead of writing BPMN XML by hand.

## Install

In Claude Code:

```txt
/plugin marketplace add Miragon/bpmn-cli
/plugin install bpmn-cli@miragon-bpmn
```

Or from your shell:

```sh
claude plugin marketplace add Miragon/bpmn-cli
claude plugin install bpmn-cli@miragon-bpmn
```

The skill runs `bpmn` when it is on your PATH, else `npx -y @miragon/bpmn-cli@<version>` with the
version of the plugin, so you need Node.js 22.12 or later. It pre-approves only these two commands.

## Update

The plugin carries the version of the CLI it describes, and each release of bpmn-cli is a new
plugin version. Claude Code does not fetch it on its own: refresh the marketplace, update the
plugin and restart Claude Code.

```sh
claude plugin marketplace update miragon-bpmn
claude plugin update bpmn-cli@miragon-bpmn
```

Or turn on auto-update for the marketplace under `/plugin` > Marketplaces.

## For your team

Commit the marketplace and the plugin to your repository's `.claude/settings.json`, so everyone who
works in the repository gets them:

```json
{
  "extraKnownMarketplaces": {
    "miragon-bpmn": { "source": { "source": "github", "repo": "Miragon/bpmn-cli" } }
  },
  "enabledPlugins": {
    "bpmn-cli@miragon-bpmn": true
  }
}
```

## What the skill does

- **Standing rules.** Claude never writes or patches `.bpmn` XML, addresses elements by id, gives
  every new element a speaking id such as `Activity_CheckInvoice`, sends one `bpmn apply` batch per
  change and keeps your drawing.
- **The loop.** Claude reads the model with `bpmn show` and `bpmn find`, changes it in one batch,
  reads the result, renders a change that drew something to a PNG in `.bpmn-render/` and fixes the
  numbered layout problems, then runs `bpmn validate`. Delete `.bpmn-render/` or add it to
  `.gitignore`.
- **Your rules.** With a `.bpmnlintrc` in the repository, the results list the
  [bpmnlint](./bpmnlint.md) findings a change added, and Claude fixes them in the same batch. In a
  repository you do not trust, the skill tells Claude to pass `--no-lint-config`.
- **Camunda 7 and Camunda 8.** Recipes for external tasks, job workers, mappings and error handling,
  loaded only when a request needs them.

The skill, its reference files and its eval suite are in
[plugins/bpmn-cli](https://github.com/Miragon/bpmn-cli/tree/main/plugins/bpmn-cli) on GitHub.
