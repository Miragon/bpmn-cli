# bpmn-cli plugin for Claude Code

One skill, `bpmn` (invoked as `bpmn-cli:bpmn`), that makes Claude create, read, change, format
and validate BPMN 2.0 models with [@miragon/bpmn-cli](https://github.com/Miragon/bpmn-cli)
instead of writing BPMN XML: elements by id, explicit speaking ids, one `apply` batch per change,
hand-made drawings kept, formatting by naming elements, a look at the drawing after a change
(`bpmn render` to a PNG in `.bpmn-render/`, read and fixed by the ids of its numbered problems),
Camunda 7 / Camunda 8 settings, and `bpmn validate` before a model is called done.

Install it from the marketplace in this repository:

```
/plugin marketplace add Miragon/bpmn-cli
/plugin install bpmn-cli@miragon-bpmn
```

or from the shell with `claude plugin marketplace add Miragon/bpmn-cli` and
`claude plugin install bpmn-cli@miragon-bpmn` (Claude Code 2.1.275 and later also take one
step: `/plugin install bpmn-cli --marketplace Miragon/bpmn-cli`).
`/plugin marketplace update miragon-bpmn` fetches a new release, or enable auto-update for the
marketplace under `/plugin` > Marketplaces.

The skill runs `bpmn` when it is on `PATH`, else `npx -y @miragon/bpmn-cli@<version>` with the
version of this plugin (Node 22.12+). It pre-approves only those two commands.

- `skills/bpmn/SKILL.md` - the standing rules and the core loop; `skills/bpmn/reference/` - batch
  format, formatting, Camunda 7, Camunda 8 and complete recipes, loaded when needed
- `evals/` - the eval suite (`claude plugin eval`), see [evals/README.md](evals/README.md)

## What the skill does

- **Runs the CLI** - `bpmn` from `PATH`, else `npx -y @miragon/bpmn-cli@<version>` pinned to the
  plugin's version (Node 22.12+); these two commands are the only ones it pre-approves. Batches are
  piped in with `printf '%s' '<json>' | bpmn apply <file> -`, which runs under that
  pre-approval (a heredoc holding JSON makes Claude Code ask first).
- **Standing rules** - never write or patch `.bpmn` XML or BPMNDI; address elements by id only;
  give every created element an explicit speaking id in the conventions `bpmn show --conventions`
  lists (`userTask_checkInvoice`); aliases for back references inside a batch; one `bpmn apply`
  batch per change; keep the user's drawing (`--relayout` only on request).
- **The loop** - orient with `show`, `show --around`, `show <id> --context`, `find`; change in one
  batch; read the result (layout mode, placed / moved, added layout problems, the warnings the
  change added); look at a change that drew something (`bpmn render <file> --problems -o
  .bpmn-render/<name>.png`, or `--render` on the change, then Read the PNG and fix the numbered
  problems by their ids with the format commands, at most two more renders; `--around` /
  `--path` on large models); `validate` (`--strict` for deployable models); format with
  `show --layout`, dry runs and the format commands; Camunda 7 and Camunda 8 recipes; the
  common errors and their fixes. With a `.bpmnlintrc` in the repository the results list the
  bpmnlint findings a change added (`warning [bpmnlint error] ...`), and Claude fixes them in the
  same batch. A plugin of that configuration that bpmn-cli does not ship runs from the
  repository's `node_modules` under the pre-approved `bpmn` command; the skill tells Claude to
  pass `--no-lint-config` in a repository the user does not trust. `.bpmn-render/` in the working directory is scratch: delete it
  or add it to `.gitignore`.
- **Progressive disclosure** - `SKILL.md` holds the rules (about 480 tokens always loaded, about
  6.7k when it fires); `reference/` has the batch format, formatting and rendering, Camunda 7,
  Camunda 8 and complete recipes; for everything else the skill sends Claude to
  `bpmn guide <topic>` and `bpmn kinds`, so the CLI's own documentation stays the single source.

The plugin's version is the package version: release-please bumps
`plugins/bpmn-cli/.claude-plugin/plugin.json` and the pinned `npx` version of the skill in each
release PR ([docs/releasing.md](../../docs/releasing.md)). `test/e2e/plugin.test.ts` (part of `npm test`)
keeps the skill honest: it runs every recipe and reference example and the look step's render
against the CLI built from `src/`, checks that every `bpmn <command> --option` the skill mentions
exists, and that the versions agree. To work on the plugin:

```
claude plugin validate --strict plugins/bpmn-cli   # the plugin (CI runs both)
claude plugin validate --strict .                  # the marketplace
claude --plugin-dir plugins/bpmn-cli               # a session with the local plugin loaded
claude plugin eval plugins/bpmn-cli --scaffold --allow-tools Bash Write Edit
```

The eval suite (seven cases: an order-to-cash model from scratch, a change to a hand-drawn model,
a Camunda 7 external task, a formatting request, a change plus a clean-up of a messy drawing
where the look step matters, a German Camunda 8 request, and an unrelated question the skill
must ignore) and how to run it are described in
[evals/README.md](evals/README.md).
