# Claude Code plugin

With the plugin, Claude creates and changes `.bpmn` files through the CLI: it names the elements,
keeps your drawing and validates the model before it is done.

**Requirements:** Claude Code and Node.js 22.12 or later. The skill runs `bpmn` when it is on your
PATH, else `npx -y @miragon/bpmn-cli@<version>`.

## Install

::: code-group

```txt [In Claude Code]
/plugin marketplace add Miragon/bpmn-cli
/plugin install bpmn-cli@miragon-bpmn
```

```sh [From your shell]
claude plugin marketplace add Miragon/bpmn-cli
claude plugin install bpmn-cli@miragon-bpmn
```

:::

## Try it

Open Claude Code in a folder and ask in plain words, in English or German:

```txt
Add a reminder timer on "Check invoice" that sends a reminder after 3 days.
```

Claude runs `bpmn` commands and never writes the XML itself. After a change to the drawing it
renders the result and looks at it:

<figure class="diagram">
  <img src="/shots/plugin-change.svg" alt="The order process with a non-interrupting timer on Check invoice, followed by Send reminder and Reminder sent, the new elements marked green" />
  <figcaption>The reminder added by one <code>bpmn apply</code> batch, new elements in green</figcaption>
</figure>

It then runs `bpmn validate`. With a `.bpmnlintrc` in the repository, it also fixes the
[bpmnlint](./bpmnlint.md) findings its change added. Renders go to `.bpmn-render/`; add it to
`.gitignore`.

## Check that it works

Run `/plugin`: `bpmn-cli@miragon-bpmn` is listed and enabled. When you ask for a model, the session
shows the skill `bpmn-cli:bpmn`, and Claude's first step is `bpmn show` or `bpmn new`.

| problem | fix |
| --- | --- |
| Claude writes the XML anyway | restart Claude Code after an install or update, or invoke the skill: `/bpmn-cli:bpmn <request>` |
| the first command is slow | `npx` downloads the CLI; install it once with `npm install -g @miragon/bpmn-cli` |

## Update

Claude Code does not fetch new versions on its own. Update, then restart Claude Code:

```sh
claude plugin marketplace update miragon-bpmn
claude plugin update bpmn-cli@miragon-bpmn
```

Or turn on auto-update under `/plugin` > Marketplaces.

## For your team

Commit this to the repository's `.claude/settings.json`, so everyone gets the plugin:

```json [.claude/settings.json]
{
  "extraKnownMarketplaces": {
    "miragon-bpmn": {
      "source": { "source": "github", "repo": "Miragon/bpmn-cli" }
    }
  },
  "enabledPlugins": {
    "bpmn-cli@miragon-bpmn": true
  }
}
```

::: warning A repository you do not trust
A `.bpmnlintrc` can run the project's own code ([bpmnlint: project code](./bpmnlint.md#project-code)).
There, the skill tells Claude to pass `--no-lint-config`.
:::

## Next steps

- [Getting started](./getting-started.md): the same commands at the shell.
- [A worked session](./walkthrough.md): what Claude does for a larger request.
- [plugins/bpmn-cli](https://github.com/Miragon/bpmn-cli/tree/main/plugins/bpmn-cli): the skill and its evals on GitHub.
