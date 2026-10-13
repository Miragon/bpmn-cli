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
- A model whose directory is reached through a symbolic link: the lookup takes the path as given
  first. Where that finds no `.bpmnlintrc`, it walks again from the physical directory, where git
  finds the repository. So `bpmn validate mlink/x.bpmn` with `mlink -> repo/models` runs the
  repository's `.bpmnlintrc` (`validator bpmnlint (.bpmnlintrc in ../repo)`), also for a new file
  in a subdirectory the write creates (`bpmn new mlink/sub/x.bpmn`), and a link inside a
  repository to a directory outside it (`repo/extlink -> ../ext`) keeps the repository's. A linked
  model file counts by the directory of the link, as git counts the working directory.
- Whose repository it is does not matter for the lookup. In a repository of another user a
  `.bpmnlintrc` can only switch on rules bpmn-cli ships (element-id-naming then also sets the
  [id conventions](#id-conventions) of new ids) and name moddle descriptors, which are read as
  JSON, never run, and its findings never block a write. So a job that runs as root over
  a checkout of another uid (a CI `container:` job, `docker run -v`, `sudo`) gets the
  repository's `.bpmnlintrc`, and so does a repository outside the home directory on Windows
  (`C:\dev`, `D:\src`). The owner decides only whether project plugins run (see
  [Project code](#project-code)); where they do not, each one is left out with a
  `W_LINT_UNAVAILABLE` that says why, and the rest runs.
- `--lint-config <path>` (relative to the working directory) names another file; it must exist
  and be strict JSON (`E_LINT_CONFIG`, exit 4). `--no-lint-config` switches off bpmnlint and the
  id conventions bpmn-cli reads from the `.bpmnlintrc` ([Id conventions](#id-conventions)).
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
incoming / outgoing lists) keeps its line, and so does each `W_LINT_UNAVAILABLE`, `W_LINT_FAILED`,
`W_CONFIG_IGNORED` and `import-warning`. `--json` lists every finding (`"validator": "bpmnlint"`,
`severity`, the rule as `code`).

```
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

Every mutating command and `apply` run the configuration on the model before the change and on
what they would write. The result lists only the findings the change added, never refuses because
of them, and counts the rest in the validator line (`--summary`: in its `warnings:` line, and what
it left out in a `validator bpmnlint:` line). An error
reads `[bpmnlint error]`; three or more findings of one rule with one message are one line.
`--strict` exits 5 on the findings the change added; `bpmn validate --strict` also fails on the
rest.

```
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

The new task and the flows bpmn-cli names take the prefixes and the case of `element-id-naming`, so the
write adds none of its findings, and the spliced flow, renamed after its new ends, resolves one. The
ids the file had keep theirs ([Id conventions](#id-conventions)).

A finding the file already had is not listed again, also when its element was renamed or a sibling
before it removed. What the configuration names but cannot run (`W_LINT_UNAVAILABLE`) is the same
before and after, so a write only counts it, and its validator line says so: `1 left out
(W_LINT_UNAVAILABLE; bpmn validate lists it)`. Findings a write does not compare at all are counted
in its totals and named at the end of the line, so the totals are those of `bpmn validate` on the
result: the findings of the [incoming / outgoing lists](#lists-of-incoming-and-outgoing-flows) a
file does not keep (``7 left out (incoming / outgoing lists the file does not keep; `bpmn validate
<file>` lists them)``), and the `W_LINT_FAILED` of a model bpmnlint could not lint at all (``1 left
out (W_LINT_FAILED, no rule ran; `bpmn validate <file>` lists it)``). Such a finding is never added
or resolved, also where the file had it before as a real one. `--json` has them in
`validation.validators[].leftOut` (`[{ "reason", "count" }]`); `--summary` names them in their own
line (``validator bpmnlint: 7 left out (...; `bpmn validate <file>` lists them)``, `--json`:
`leftOut: [{ "validator", "reason", "count" }]`), not in its `warnings:` line. A file from `bpmn
new` lists the findings of the new model, `W_LINT_UNAVAILABLE` and `W_LINT_FAILED` too. An empty
process has no start and no end event, so
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

## Id conventions

`@miragon/rules/element-id-naming` says how ids look: a prefix per BPMN type (`serviceTask_`,
`gateway_`, `flow_`, ...), the case of the rest (`camelCase` by default) and whether an event names its
trigger (`eventDefinitionQualifier`). `plugin:@miragon/rules/recommended-for-automation` turns it on,
and so do the plugin's engine defaults (`getDefaultLintConfig({ engine: 'c7' })`, `'c8'`).
When the `.bpmnlintrc` that runs has it on, the ids bpmn-cli generates follow it, so a write adds no
finding of it. bpmn-cli reads the rule's options as the rule reads them (its options over the plugin's
defaults) with the rule's own helpers.

- A new element of a type the rule names takes that prefix and a body in the rule's case:
  `serviceTask_checkInvoice`, `gateway_approved`, `event_timer2Days`. Under
  `eventDefinitionQualifier: "required"` an event with a trigger takes the qualified prefix
  (`timerStartEvent_monthly`, `messageEvent_paid`); under `optional` (the default) the plain one.
- The word for an element's kind leaves out what the prefix says. It names an unnamed element
  (`endEvent_terminateAfterPaid`, `scriptTask_afterPaid`). Under camelCase or PascalCase it begins a
  body that would begin with a number (`startEvent_timer1stOfMonth`). Where the prefix says all of it
  and the body would else be empty or begin with a number, the whole word stays (`scriptTask_scriptTask`,
  `scriptTask_scriptTask4AugenPrinzip`). Under camelCase or PascalCase a taken id gets a glued `2`
  (`serviceTask_checkInvoice2`) and the join of a split is `<gatewayId>Join` (snake_case:
  `<gatewayId>_join`). A split whose explicit id the rule rejects gets a join under the rule's prefix,
  named after the gateway (`gateway_checkJoin` for `Gateway_Check`, `gateway_approvedJoin` for
  `gateway_Approved` under camelCase).
- Sequence flows take the rule's prefix and name their ends (`flow_checkInvoiceToBookInvoice`), also
  when bpmn-cli renames one after its new ends. Message flows take an exact `bpmn:MessageFlow` prefix,
  else the style the file's own message flows show (two that agree; the ones under the sequence flows'
  prefix do not count), else the sequence flows' prefix, so the second message flow looks like the first.
- What the rule does not name (lanes, pools, data objects, messages) follows the file's id style,
  learned without the ids that already follow the rule (`Activity_CheckOrder` counts,
  `serviceTask_bookOrder` does not). In a file that shows none, it takes the rule's case and the
  shape of its prefixes (`lane_sales`, then `lane_backOffice`: single lower-case words show no case;
  under PascalCase, which they are not, they read as camelCase).
  Where its ids show no case but their prefixes begin with the other letter than the rule's
  (`Participant_`, `Activity_` with hashed ids), it keeps bpmn-cli's PascalCase (`Participant_Customer`).
- The process and the definitions keep bpmn-cli's `Process_<Name>` and `Definitions_<Name>` (the rule
  leaves `bpmn:Process` out on purpose: a process id is a deployment key), also the process of a new
  pool in a file whose pools follow the rule's prefix shape (`participant_customer` with
  `Process_Customer`), unless the `.bpmnlintrc` names `bpmn:Process` or `bpmn:Definitions` exactly
  (`process_orderHandling`; `process_main` and `definitions_main` without a name).
- Explicit ids (`--id`, `"id"`, `--flow-id`, `"joinId"`) are taken as given. Existing ids are never
  renamed for the conventions. After a `retype` or a trigger change, `W_ID_PREFIX_STALE` names an id
  whose prefix no longer fits (or that the rule checks only now: a type it switched off), with the
  `bpmn set <file> <id> id=<newId>` that renames it. In an `apply` batch it compares the element before
  the batch with the element after it, once per element. An element the same batch created (a split's
  join too) is nobody's API yet: a retype or a trigger change gives it the new prefix
  (`serviceTask_checkInvoice`, retyped to a user task, is `userTask_checkInvoice`), and the flows the
  batch named after it follow (`SFGoToSTCheck` becomes `SFGoToUTCheck`), without a warning.
- A result names the new ids under a prefix the rule declares that differ from what the file's own
  style would give (`conventions: ... follow element-id-naming (.bpmnlintrc in .), not the file's own
  id style`; JSON: `conventions.ids`). Ids the rule does not check (a lane, a pool, a message flow)
  are never on it. The file's own style needs two ids per rule (one in a file whose ids are mostly
  prefixed), so a file that follows the rule gets the line too while its ids do not show the style
  yet: its first ids, or a kind it has no id of (`gateway_approved` in a file without gateways).

`bpmn show <file> --conventions` lists the patterns new ids follow, the kinds of each and where each
comes from: `lint` (the rule), `file` (the file's ids), `lint shape` (shaped like the rule's prefixes,
the file shows none), `default` (bpmn-cli's). A kind the rule declares nothing for is `not checked`.
It works for a file that does not exist yet, so an agent sees the conventions before `bpmn new`.
Where none are declared, the second line says why: `--no-lint-config`, no `.bpmnlintrc`, one that could
not be loaded (with its `W_LINT_UNAVAILABLE` below), the rule off or not configured in it, or no
prefix new ids can follow. `--json` gives the same as data (`undeclared`). `--lint-config` and
`--no-lint-config` go only with `--conventions` (`E_USAGE`).

```
$ bpmn show models/order.bpmn --conventions
conventions of models/order.bpmn
element-id-naming (.bpmnlintrc in .): warn, case camelCase, eventDefinitionQualifier optional
  <kind>_{name:camel}                lint        task userTask serviceTask scriptTask sendTask receiveTask manualTask businessRuleTask subProcess callActivity startEvent endEvent
  subProcess_{name:camel}            lint        eventSubProcess adHocSubProcess transaction
  gateway_{name:camel}               lint        exclusiveGateway parallelGateway inclusiveGateway eventBasedGateway
  event_{name:camel}                 lint        intermediateCatchEvent intermediateThrowEvent boundaryEvent
  <Kind>_{name:pascal}               file        participant lane textAnnotation collaboration message (not checked)
  DataObjectReference_{name:pascal}  file        dataObject (not checked)
  DataStoreReference_{name:pascal}   file        dataStore (not checked)
  Process_{name:pascal}              default     process (not checked)
  flow_{source}To{target}            lint        sequenceFlow
  flow_{source}To{target}            lint shape  messageFlow (not checked)
  events with a trigger: <trigger><Prefix> (timerStartEvent_, messageEvent_, errorEndEvent_) also accepted, new ids take the plain prefix
sources: lint = element-id-naming; file = the file's ids; default = bpmn-cli's default; lint shape = shaped like the declared prefixes (the file shows none)
```

The file's `Event_OrderReceived` and `Activity_CheckOrder` do not follow the rule, so they still teach
the style of what it does not name: pools, lanes and data in PascalCase.

A value of the rule bpmn-cli cannot make ids from never blocks a command. A prefix that is no string,
cannot start an XML id, has a character outside ASCII (bpmn-cli writes ASCII ids) or is longer than 56
characters, an unknown `case` or an unknown `eventDefinitionQualifier` gives one `W_CONFIG_IGNORED`
that names the `.bpmnlintrc`, the key and the value. New ids of that type then follow the learned id
style, and the rule reports them; `show --conventions` marks the type `checked; prefix ignored
(W_CONFIG_IGNORED)`. Under `eventDefinitionQualifier: "required"` a qualified prefix longer than 56
characters (`escalation` before a long `bpmn:EndEvent` prefix) is one too: new ids of such events
follow the learned id style, and `show --conventions` names those triggers on the type's row
(`escalation, terminate, compensate: qualified prefix ignored`). An unknown case takes the rule's
fallback (PascalCase, which the rule then checks), an unknown qualifier `optional`. Like
`W_LINT_UNAVAILABLE`, `validate`, `new` and `show --conventions` list it, and a write only counts
it in its validator line (`1 element-id-naming value ignored (W_CONFIG_IGNORED; bpmn validate lists
it)`).

`--no-lint-config`, no `.bpmnlintrc`, or the rule `off` (as in `recommended-for-modeling`): new ids
follow the file's id style alone, byte for byte as before. DI ids (`bpmndi:`) are out of scope: they
follow their element (`<id>_di`).

## Which rules are available

bpmn-cli ships bpmnlint 11.15.0 and @miragon/bpmnlint-plugin-rules 0.12.1. A rule or config
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
synchronous). When bpmnlint cannot lint the model at all, no rule runs: one `W_LINT_FAILED` that
`bpmn validate` and `bpmn new` list, and a later write's validator line says ``1 left out
(W_LINT_FAILED, no rule ran; `bpmn validate <file>` lists it)``. A moddle descriptor that
BpmnModdle rejects outright no longer stops every rule (see [moddleExtensions](#moddleextensions));
what is left is one it takes but cannot parse the file with (a property that redefines one bpmn
does not have).

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
`.git`), pass `--no-lint-config` (the skill tells the agent to). A project plugin that loaded stays
loaded in a long-running host until it restarts; what the `.bpmnlintrc` could not resolve is
looked up again by the next call, with one exception (see Limits).

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
extension. So is a descriptor BpmnModdle rejects: a prefix or uri another descriptor (or bpmn
itself) already has, a type that extends one that does not exist. bpmn-cli adds the descriptors
one prefix at a time, leaves out each one BpmnModdle rejects (`moddle extension x (descriptor
object) left out: BpmnModdle rejects it (package with prefix <bpmn> already defined)`; a module
path instead of `descriptor object` for one read from a file) and runs the rules with the others.
bpmnlint in CI fails on the whole file with such a descriptor: fix it or remove its entry.

## Import warnings

bpmnlint parses the file with the moddle extensions of the `.bpmnlintrc` only, and its CLI fails on
what that parse cannot read or resolve (`Import warning: unknown attribute <x>`). bpmn-cli reports
such a warning as an `import-warning` error, and `validate` exits 2. The hint says what to fix. A
warning bpmn-cli's own reader reports too is an `import:` line instead (only `--strict` fails on
it), although bpmnlint's CLI fails on it as well. In a model without an engine, bpmn-cli's own
decision link (an unprefixed `calledDecision` on a business rule task,
[Set keys](reference.md#set-keys)) is such an error. Keep the link, and declare the attribute in a
JSON descriptor that adds `calledDecision` (`isAttr`) to `bpmn:BusinessRuleTask`. Name the
descriptor by file path in `moddleExtensions`: bpmnlint's CLI loads only paths.

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
CI does too). `validate` lists them with a hint that says so. A write does not compare them, so
they are never added or resolved, but it counts them: its totals are those of `validate`, and its
validator line ends with ``7 left out (incoming / outgoing lists the file does not keep; `bpmn
validate <file>` lists them)``. The count grows with the nodes a change adds: CI reports their
findings too. A node that really has no flow, or a gateway with one branch, is reported in both.

## A hoisted bpmnlint

When a project has its own bpmnlint and installs bpmn-cli as a dependency, npm may hoist
@miragon/bpmnlint-plugin-rules next to the project's bpmnlint, and the plugin uses that one. npm
does so only for a bpmnlint the plugin's peer range accepts (`>=11.14.0`, since 0.12.1), and that
works (the validator line names the version, `bpmnlint 11.14.0 from node_modules/bpmnlint (bpmn-cli
pins 11.15.0)`). For an older one npm keeps the plugin under bpmn-cli, next to bpmn-cli's own
bpmnlint, and lint runs with the pinned version. Only an install that ignores peer dependencies
(`npm install --legacy-peer-deps`, or a package manager that does not check them) still puts the
plugin next to an older bpmnlint: that one cannot load the plugin, and bpmn-cli says so in one
`W_LINT_UNAVAILABLE` and writes anyway. Update the project's bpmnlint, install without
`--legacy-peer-deps`, or run bpmn-cli with `npx`.

## Library use

The file helpers of `@miragon/bpmn-cli/node` run the `.bpmnlintrc` like the CLI, with the rules
bpmn-cli ships only (`lintProjectCode` for project plugins) and advisory (`lintBlocks: true` lets
its errors block a write with `E_VALIDATION`), and they give the core the id conventions of its
`element-id-naming`. The core has the validator itself (`bpmnlintValidator`,
`resolveBpmnlintConfig`) and reads the conventions with `idConventionsFromLint`; bpmnlint and the
plugin's naming helpers are injected. A host that lints with a configuration of its own passes the
conventions of that same configuration (`conventions`), or its own lint reports bpmn-cli's ids.
`bpmnlintEngine()` gives a host without a `.bpmnlintrc` the first two sources of
[Which rules are available](#which-rules-are-available), offline and without project code, so
`plugin:camunda-compat/camunda-cloud-8-5` resolves there as it does in a `.bpmnlintrc`. See
[library.md](library.md#building-blocks) and [Advisory validators](validators.md#advisory-validators).

## Limits

- Ids the file already has stay, also where they break `@miragon/rules/element-id-naming`:
  `bpmn validate` lists them, and `bpmn set <file> <id> id=<Id>` renames one.
- For a rule the bundle lacks, the project's plugin version can mix with the shipped one of the
  same package; the validator line names the project plugins that ran.
- A long-running host keeps a project plugin that loaded after it changed; restart it. The load
  is cached on the `.bpmnlintrc`'s text and on what it left out or read from the project: a
  plugin or moddle package installed after the hint (also inside the repository after one above
  it was found), a plugin that failed to load and was fixed or reinstalled, and an edited moddle
  descriptor of the project are picked up by the next call. A fix inside a module the failed one
  requires in turn is not seen; reinstalling the plugin is. A failed plugin reinstalled as a
  version whose entry module moved (another `main`) needs a restart: Node keeps the
  `package.json` it read, so until then the host reports the plugin as not installed.
