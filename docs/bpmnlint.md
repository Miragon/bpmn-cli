# bpmnlint: the project's .bpmnlintrc

Teams keep their modeling rules in a `.bpmnlintrc`: naming schemes, `standard-size`, engine
compatibility (camunda-compat), plugins of their own. bpmn-cli runs that configuration in
`bpmn validate` and in every write. An agent sees a violation in the result of the command that
caused it and fixes it in the same batch, not later in CI.

## Which configuration runs

- The nearest `.bpmnlintrc` from the model's directory upwards, up to the repository root (the
  first directory with a `.git` directory or file). A write looks it up from the file it writes
  (`-o`), a model from stdin (`-`) without `-o` from the working directory. Outside a git
  repository only the model's own directory counts, so a `.bpmnlintrc` in `~` or `/tmp` does not
  apply to every model below it. A `.git` file that names no git directory (a moved worktree)
  makes no repository, as for git.
- Whose repository it is does not matter for the lookup. In a repository of another user a
  `.bpmnlintrc` can only switch on rules bpmn-cli ships and name moddle descriptors, which are
  read as JSON, never run, and its findings never block a write. So a job that runs as root over
  a checkout of another uid (a CI `container:` job, `docker run -v`, `sudo`) gets the
  repository's `.bpmnlintrc`, and so does a repository outside the home directory on Windows
  (`C:\dev`, `D:\src`). The owner decides only whether project plugins run (see
  [Project code](#project-code)); where they do not, each one is left out with a
  `W_LINT_UNAVAILABLE` that says why, and the rest runs.
- `--lint-config <path>` (relative to the working directory) names another file; it must exist
  and be strict JSON (`E_LINT_CONFIG`, exit 4). `--no-lint-config` switches bpmnlint off.
- Without a `.bpmnlintrc` nothing of bpmnlint is loaded, and bpmnlint adds nothing to the output.

bpmnlint's own CLI reads the `.bpmnlintrc` of the working directory (or `-c <file>`). bpmn-cli
takes the one nearest to the model instead, so a nested `.bpmnlintrc` that CI never reads applies
to the models below it. Keep one per repository, or let CI use the same files.

## validate

`validate` lists every finding with the validator, the severity, the rule and the element id: an
error reads `[bpmnlint error] <rule>`, a warning `[bpmnlint] <rule>`. An error fails the check
(exit 2); `--strict` exits 5 on warnings, as before. Three or more findings of one rule with one
hint are one line: its most common message with the ids that have it, and how many other findings
and messages there are. A finding with a hint of its own (a real dead end in a file without
incoming / outgoing lists) keeps its line, and so does each `W_LINT_UNAVAILABLE`, `W_LINT_FAILED`
and `import-warning`. `--json` lists every finding (`"validator": "bpmnlint"`, `severity`, the
rule as `code`).

```
$ bpmn validate models/order.bpmn
[bpmnlint error] local/external-task-topic Activity_BookOrder: External task has no topic
W_C7_DEPLOY_EXTERNAL_TOPIC Activity_BookOrder: serviceTask Activity_BookOrder is an external task without camunda:topic; the engines refuse the file  (`bpmn set <file> Activity_BookOrder camunda:topic=<topic>`.)
[bpmnlint] @miragon/rules/element-id-naming x7 [Flow_CheckOrderToBookOrder, Flow_BookOrderToOrderChecked, Flow_OrderReceivedToCheckOrder]: Element id must match the naming convention <flow_camelCase> (3 of 7; 4 others with 4 other messages, --json lists them)
platform: c7 (modeler:executionPlatform "Camunda Platform") - 1 refused at deploy, 0 runtime, 0 practice finding(s)
validator bpmnlint (.bpmnlintrc in .; project plugins: bpmnlint-plugin-local@1.0.0): 1 error(s), 7 warning(s) in the file
layout: ok
1 error(s), 8 warning(s)
```

## Writes

Every mutating command and `apply` run the configuration on the model before the change and on
what they would write. The result lists only the findings the change added, never refuses because
of them, and counts the rest in the validator line (`--summary`: in its `warnings:` line). An error
reads `[bpmnlint error]`; three or more findings of one rule with one message are one line.
`--strict` exits 5 on the findings the change added; `bpmn validate --strict` also fails on the
rest.

```
$ bpmn add models/order.bpmn serviceTask "Book order" --after Activity_CheckOrder camunda:type=external
created serviceTask Activity_BookOrder "Book order" - after Activity_CheckOrder
...
warning W_C7_DEPLOY_EXTERNAL_TOPIC Activity_BookOrder: serviceTask Activity_BookOrder is an external task without camunda:topic; the engines refuse the file  (`bpmn set <file> Activity_BookOrder camunda:topic=<topic>`.)
warning [bpmnlint] @miragon/rules/element-id-naming Activity_BookOrder: Element id must match the naming convention <serviceTask_camelCase>
warning [bpmnlint] @miragon/rules/element-id-naming Flow_BookOrderToOrderChecked: Element id must match the naming convention <flow_camelCase>
warning [bpmnlint error] local/external-task-topic Activity_BookOrder: External task has no topic
validator bpmnlint (.bpmnlintrc in .; project plugins: bpmnlint-plugin-local@1.0.0): 1 error(s), 7 warning(s) in the result (3 added, 0 resolved, 5 already in the file)
layout: ok - full (engine-owned diagram: redrawn)
written: models/order.bpmn
```

A finding the file already had is not listed again, also when its element was renamed or a sibling
before it removed. What the configuration names but cannot run (`W_LINT_UNAVAILABLE`) is the same
before and after, so a write only counts it, and its validator line says so: `1 left out
(W_LINT_UNAVAILABLE; bpmn validate lists it)`. A file from `bpmn new` lists the findings of the new
model, `W_LINT_UNAVAILABLE` too. An empty process has no start and no end event, so
`start-event-required` and `end-event-required` are errors and `bpmn validate` exits 2 until the
first `apply` batch adds them.

Some rules say what bpmn-cli's own lint says. There only the bpmnlint finding is listed, with the
fixing command of bpmn-cli's warning as its hint:

| rule | bpmn-cli warning |
| --- | --- |
| `start-event-required` | `W_NO_START` |
| `end-event-required` | `W_NO_END` |
| `no-implicit-end` | `W_DEAD_END` |

camunda-compat and bpmn-cli's `W_C7_*` / `W_C8_*` rules overlap too (a service task without
implementation); both are listed, the platform finding with its fixing command.

## Which rules are available

bpmn-cli ships bpmnlint 11.15.0 and @miragon/bpmnlint-plugin-rules 0.12.0. A rule or config
resolves from the first of:

1. the plugin's bundled resolver: bpmnlint's rules and configs (`bpmnlint:recommended`, `all`,
   `correctness`), camunda-compat's `camunda-platform-7-24` and `camunda-cloud-8-10` with their
   rules, and `@miragon/rules` (`recommended-for-modeling`, `recommended-for-automation`, `all`);
2. the camunda-compat bpmn-cli installs with the plugin (2.61.1): every other camunda-compat
   config and rule (`camunda-platform-7-19` to `7-23`, `camunda-cloud-8-0` to `8-9`, ...);
3. the repository's `node_modules`, from the directory of the `.bpmnlintrc`: a plugin bpmn-cli
   does not ship (`plugin:acme/recommended`), or a newer camunda-compat for a config the shipped
   one does not know. A package whose config comes from here gives its rules from here too.

The first two work offline and without an install. For a name they know, bpmn-cli's versions win
over the project's. What none of them resolves is left out with one `W_LINT_UNAVAILABLE` per
package and reason, and the rest runs:

```
[bpmnlint] W_LINT_UNAVAILABLE: plugin:missing/recommended, missing/foo left out: bpmnlint-plugin-missing is not installed (looked up from .)  (Install it next to the .bpmnlintrc (npm i -D bpmnlint-plugin-missing) or remove it from the configuration; --no-lint-config skips bpmnlint.)
[bpmnlint] W_LINT_UNAVAILABLE: miragon/element-id-naming left out: bpmnlint-plugin-miragon is not installed (looked up from .)  (Did you mean @miragon/rules/element-id-naming? bpmn-cli bundles that rule.)
```

A rule that throws is one `W_LINT_FAILED` and its findings are left out; nothing goes to stderr.
So is an async check that rejects, and a rule factory that returns a promise (bpmnlint rules are
synchronous). When bpmnlint cannot lint the model at all (a moddle descriptor it cannot load), no
rule runs: one `W_LINT_FAILED` that `bpmn validate` lists and a later write only counts.

## Project code

Only the third source runs code of the project: a plugin bpmn-cli does not ship. It runs only
inside a git repository of the user running bpmn-cli, by owner as git checks it: the repository's
directory, its `.git` (a symbolic or hard link by its own owner, not by what it points to) and the
directory a `.git` file names must belong to that user (root: also those of the `SUDO_UID` sudo
sets). git's `safe.directory` is not read. So a planted `/tmp/.git`, also a link to `/` or a hard
link to a file of root, does not count. On Windows, where Node reads no file owners, only a
repository inside the user's home directory counts, so a `C:\.git` that any user can create does
not. The plugin's entry module must lie inside the repository root; one in a parent directory, in
`NODE_PATH` or in `~/node_modules` is not loaded (`W_LINT_UNAVAILABLE`: "resolves outside the
repository"). Outside a repository, or in one that does not count, also with `--lint-config`, the
bundled and shipped rules run and a project plugin is left out (`W_LINT_UNAVAILABLE` says why:
"only inside a git repository", "belongs to another user", "only in one inside the home
directory"). A CI job that runs as root over another uid's checkout gets its plugins by running
bpmn-cli as the checkout's owner (`docker run --user "$(id -u)"`); on Windows, keep the repository
inside the home directory. The validator line names every project plugin that ran (`project
plugins: bpmnlint-plugin-local@1.0.0`). `moddleExtensions` are read as JSON, never executed. The
CLI runs project plugins; a library host runs them only with `lintProjectCode: true` (and, like
the CLI, only in a repository of its user).

So a repository's `.bpmnlintrc` can make `bpmn validate` run the repository's plugin code, as
`npx bpmnlint` would. In Claude Code the plugin's skill pre-approves `bpmn` commands, so that code
runs without a prompt. In a repository you do not trust (a clone, an unpacked archive with its
`.git`), pass `--no-lint-config` (the skill tells the agent to). Project plugins stay loaded in a
long-running host until it restarts, and so does what the `.bpmnlintrc` could not resolve (see
Limits).

## moddleExtensions

camunda-compat and other engine rules read `camunda:` / `zeebe:` properties only through a moddle
extension, as bpmnlint does in CI. A module path is resolved from the directory of the
`.bpmnlintrc` and read as JSON (a `.json` is appended when the path has no extension).
`camunda-bpmn-moddle/resources/camunda.json` and `zeebe-bpmn-moddle/resources/zeebe.json` also
work without the package installed (the plugin brings them). A path to a JavaScript module, or one
that cannot be found, is left out with `W_LINT_UNAVAILABLE`, and so is a value that is neither a
path nor a descriptor object (`5`, `null`), and a `moddleExtensions` that is a string, not an
object of prefix -> path (bpmnlint fails on the whole file with either); rules that read its
properties may then report findings that are not there, as they would in CI without the
extension.

## Import warnings

bpmnlint parses the file with the moddle extensions of the `.bpmnlintrc` only, and its CLI fails on
what that parse cannot read or resolve (`Import warning: unknown attribute <x>`). bpmn-cli reports
such a warning as an `import-warning` error, and `validate` exits 2. The hint says what to fix. A
warning bpmn-cli's own reader reports too is an `import:` line instead (only `--strict` fails on
it), although bpmnlint's CLI fails on it as well. In a design model, design-iq's decision link
(`calledDecision` on a business rule task) is such an error. Keep the link, and declare the
attribute in a JSON descriptor that adds `calledDecision` (`isAttr`) to `bpmn:BusinessRuleTask`.
Name the descriptor by file path in `moddleExtensions`: bpmnlint's CLI loads only paths.

## The file

bpmnlint reads the `.bpmnlintrc` with `JSON.parse`: no comments, no trailing commas. A broken
`.bpmnlintrc` found by the lookup is one `W_LINT_UNAVAILABLE` and bpmnlint does not run; a broken
`--lint-config` file is `E_LINT_CONFIG`. Severities as in bpmnlint: `off` / `0` switches a rule off,
`error` / `2` is an error, `warn` / `1` and `info` / `3` are warnings, and any other value (`false`,
`"warning"`) runs the rule as a warning, as bpmnlint does. A name bpmnlint cannot parse
(`@acme/foo`) is left out alone; bpmnlint fails on the whole file with it. A config that extends
itself, directly or through the configs it extends, is walked once (its rules apply) and named in a
`W_LINT_UNAVAILABLE`; bpmnlint fails on it.

## Lists of incoming and outgoing flows

`no-implicit-end`, `no-implicit-start` and `no-disconnected` read a node's `incoming` /
`outgoing` lists, and `event-based-gateway` counts a gateway's `outgoing` list. bpmn-cli writes
those lists only where a file keeps them, so in a generated or hand-written file without them these
rules report nodes that do have flows, and an event-based gateway with two branches (bpmnlint in
CI does too). A write leaves such findings out; `validate` lists them with a hint that says so. A
node that really has no flow, or a gateway with one branch, is reported in both.

## A hoisted bpmnlint

When a project has its own bpmnlint and installs bpmn-cli as a dependency, npm may hoist
@miragon/bpmnlint-plugin-rules next to the project's bpmnlint, and the plugin uses that one. From
11.14 on it works (the validator line names the version, `bpmnlint 11.14.0 from node_modules/bpmnlint
(bpmn-cli pins 11.15.0)`); an older one cannot load the plugin, and bpmn-cli says so in one
`W_LINT_UNAVAILABLE` and writes anyway. Update the project's bpmnlint, or run bpmn-cli with `npx`.

## Library use

The file helpers of `@miragon/bpmn-cli/node` run the `.bpmnlintrc` like the CLI, with the rules
bpmn-cli ships only (`lintProjectCode` for project plugins) and advisory (`lintBlocks: true` lets
its errors block a write with `E_VALIDATION`). The core has the validator itself
(`bpmnlintValidator`, `resolveBpmnlintConfig`); bpmnlint is injected. See
[library.md](library.md#building-blocks) and [Advisory validators](validators.md#advisory-validators).

## Limits

- bpmn-cli's new ids follow the file's id style, not `@miragon/rules/element-id-naming`: a write
  lists the ids that break that convention, and `bpmn set <file> <id> id=<Id>` fixes one.
- For a rule the bundle lacks, the project's plugin version can mix with the shipped one of the
  same package; the validator line names the project plugins that ran.
- A long-running host keeps a project plugin loaded after it changed; restart it. It also keeps
  what it could not resolve, since the load is cached on the `.bpmnlintrc`'s text: after
  installing a missing plugin or moddle package, or editing a moddle descriptor, restart it (or
  change the `.bpmnlintrc`).
