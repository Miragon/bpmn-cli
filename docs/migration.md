# From 0.9 to 1.0

1.0 is rebuilt from zero: one way to say each thing, a contract of ten exports, and a write that touches
only what it changed. This page lists what you type or call differently. An item that is gone answers
`E_USAGE` and names no replacement, so look it up here.

**Node 24 or later is required.** Until 1.0.0 is released, the release
candidates install with `npm install -g @miragon/bpmn-cli@next`.

## The one rule

A flag says where an element goes and how the command runs; what the element holds is a `key=value`
([Flag or key](reference.md#flag-or-key-value)).

```text
0.9  bpmn add <file> boundaryEvent:timer [name] --on <activityId> --timer <iso> --non-interrupting
     bpmn add order.bpmn boundaryEvent:timer Reminder --on check --timer P2D --non-interrupting

1.0  bpmn add <file> boundaryEvent:timer [name] --on <activityId> timer=<iso> nonInterrupting=true
     bpmn add order.bpmn boundaryEvent:timer Reminder --on check timer=P2D nonInterrupting=true
```

A key the element does not take is refused with the keys it does take, where 0.9 ignored the flag with a
warning.

## Commands

| 0.9 | 1.0 |
| --- | --- |
| `bpmn metrics <file>` | `bpmn diagram <file>` |
| `bpmn show <file> --layout` | `bpmn diagram <file>` |
| `bpmn show <file> --conventions` | `bpmn conventions <file>` |
| `bpmn ext list <file> <id>` | `bpmn show <file> <id>`, which numbers the extensions |
| `bpmn kinds`, `bpmn kinds --section <part>` | `bpmn guide kinds`, `bpmn guide <topic>`; programs read `kindsJson()` and `OPS_SCHEMA` |
| `bpmn guide --short` | `bpmn guide` |
| `bpmn align <file> <ids…>` | one `bpmn place` per id |
| `bpmn rm`, `bpmn replace`, `bpmn colour` | `bpmn remove`, `bpmn retype`, `bpmn color` |
| `bpmn layout <file> --tidy` | `bpmn tidy <file>` |
| `bpmn layout <file> --collapse <id>`, `--expand <id>` | `bpmn set <file> <id> expanded=false`, `expanded=true`, in place; `bpmn layout <file>` only for a full redraw |

## Flags of every write

Every write keeps `-o`, `--dry-run`, `--force` and `--json`.

| 0.9 | 1.0 |
| --- | --- |
| `--summary` | the default text is the short report |
| `--pretty` | `--json`; `jq` indents |
| `--render <file>` | `bpmn render <file> <ids…> -o <image>` |
| `--show` | `bpmn show <file>` |
| `--layout <mode>` | gone: a plane with shapes is drawn incrementally, an empty one in full |
| `--relayout`, `--layout full` | `bpmn layout <file>`, or a last `layout` operation |
| `--no-layout` | gone, without a replacement for vertical lanes: a write that places, moves or routes something on a vertical plane answers `E_LAYOUT_INCREMENTAL`; `bpmn layout` redraws it horizontally |
| `--strict` | `bpmn validate --strict` |
| `--lint-config`, `--no-lint-config` | `bpmn validate --lint-config`, `--no-lint-config` |
| `--backup` | Git, or `-o` |

## Flags of one command

| 0.9 | 1.0 |
| --- | --- |
| `bpmn new <file> --name <text>` | `bpmn new <file> [name]`, as on `add` |
| `bpmn new <file> --no-executable` | `bpmn new <file> --target none` |
| `--timer <iso>`, `--timer-kind <kind>` | `timer=<iso>`: `R/PT1H` is a cycle, `PT5M` a duration, a date a date |
| `--message`, `--signal`, `--link <name>` | `message=<name>`, `signal=<name>`, `link=<name>` |
| `--error <name> --error-code <code>` | `error=<name> errorCode=<code>` |
| `--escalation <name> --escalation-code <code>` | `escalation=<name> escalationCode=<code>` |
| `--when <expr>` | `when=<expr>` |
| `--non-interrupting` | `nonInterrupting=true` |
| `--doc <text>`, `--text <text>` | `doc=<text>`, `text=<text>` |
| `--collapsed` | `expanded=false` |
| `bpmn connect … --name <text> --condition <expr>` | `bpmn connect … name=<text> condition=<expr>` |
| `bpmn connect … --default`, `--language <lang>`, `--message <name>` | `default=true`, `language=<lang>`, `message=<name>` |
| `bpmn set … --unset <key>` | `<key>=` |
| `bpmn remove … --no-bridge`, `--bridge-all` | `--bridge none`, `--bridge all` |
| `bpmn ext add … --body <text>` | `body=<text>` |
| `bpmn show --scope <id>`, `--inner` | `bpmn show --in <id>`, which also takes a lane |
| `bpmn show <id> --context` | `bpmn show <id>` |
| `bpmn validate --platform <p>` | gone: the file says its platform |
| `bpmn render --format svg` | `-o x.svg` |
| `bpmn render --scope <id>`, `--plane <id>` | `bpmn render <id>` |
| `bpmn render --inner`, `--via`, `--highlight`, `--tiles`, `--max-size`, `--scale` | gone |
| `bpmn tidy --path`, `--via`, `--kind`, `--branch` | `bpmn tidy <ids…>` |
| `bpmn place`, `bpmn color`: `--via`, `--kind` | `--branch`, or ids from `bpmn find --kind` |

`bpmn show --depth` now defaults to 1, not 2.

## Operations

| 0.9 | 1.0 |
| --- | --- |
| `{ "op": "add", …, "timer": "P2D" }`, also `message`, `error`, `errorCode`, `signal`, `escalation`, `escalationCode`, `when`, `link`, `nonInterrupting`, `doc`, `text`, on `add` and `retype` | `{ "op": "add", …, "set": { "timer": "P2D" } }` |
| `collapsed` on `add` | `"set": { "expanded": false }` |
| `{ "op": "connect", …, "name": "yes" }`, also `condition`, `language`, `default`, `message` | `{ "op": "connect", …, "set": { "name": "yes" } }` |
| `{ "op": "set", "values": { … }, "unset": ["key"] }` | `{ "op": "set", "set": { …, "key": "" } }` |
| `bridge: false`, `bridgeAll: true` on `remove` | `bridge: "none"`, `bridge: "all"` |
| `timerKind` | gone: `timer` tells the kinds apart |
| `flowName`, `flowId`, `condition`, `language`, `default` on `move` | `set` on the flow after the move |
| `path`, `via`, `kind`, `branch` on `tidy` | `ids` |
| `via`, `kind` on `place`, `color` | `branch`, or ids from `bpmn find --kind` |
| `{ "op": "align" }` | one `place` per id |
| `bpmn apply … --layout full` | a last `{ "op": "layout" }` |

Operations are parsed strictly: an unknown key answers `E_USAGE` and names the keys the operation takes.

## Behaviour that changed

| 0.9 | 1.0 |
| --- | --- |
| every write with model operations redrew a diagram the CLI drew itself | the drawing stays; a build from scratch over several writes ends with `bpmn layout` |
| when the incremental layout failed, a full redraw replaced the drawing | `E_LAYOUT_INCREMENTAL` with a hint to a last `layout` operation |
| a model operation could follow a drawing operation in one batch | `E_USAGE`: model operations first, or two batches |
| a write turned vertical lanes horizontal | a write that places, moves or routes something on a vertical plane answers `E_LAYOUT_INCREMENTAL`; `set`, `retype`, `ext` and the drawing commands pass, and `bpmn layout` redraws it horizontally |
| every write ran the `.bpmnlintrc` before and after | `bpmn validate` runs it; a write loads no plugin code |
| a write reported warnings anywhere in the file | warnings at the touched elements; the state line counts the rest. An error a write adds anywhere still refuses, as in 0.9 |
| a new shape took the median size of its kind on the plane | the bpmn-js size: task 100 by 80, gateway 50 by 50, event 36 by 36 |
| a task grew for its boundary events or its name | 100 by 80 whatever the count or the name; a long name wraps |
| `place --side` put a boundary event over the host's corner when the border was full | `E_NO_ROOM` |
| a bundled plugin answered before the project's copy | the project's copy runs, as in its CI; a rule it lacks is left out |
| the text of a write ran up to 9 KB | at most 1 KB, then the layout score and the state; `--json` is never cut |
| `show` ended with `problems:` | `show` ends with the state line; `bpmn validate` lists the problems |

Scripts that read the text of a write change with it: the lines are `created <kind>: <ids>`, and
`layout: ...` is gone. Read `--json`, or `.score` from `bpmn diagram --json`.

## Library

`.` goes from 94 exports to 10, and `./node` goes: nothing reads files any more.
[Library use](library.md) has the contract; every option type lives beside it.

| 0.9 | 1.0 |
| --- | --- |
| `@miragon/bpmn-cli/node`: `mutateFile`, `layoutFile`, `checkFile`, `loadDoc`, `writeAtomic`, `bpmnlintEngine` | read and write the file yourself, and call `applyToXml`, `validateXml` |
| `Doc`, `mutateDoc`, `layoutDoc`, `checkDoc`, `runOps`, `parseOps`, the views, the profiles | gone: the eight functions take and return strings and data |
| `bpmnlintValidator`, `resolveBpmnlintConfig`, `idConventionsFromLint` | gone: a host runs bpmnlint itself, passes a `Validator` and declares `conventions` |
| `findXml(xml, text)`, its hits' `scope` | `(await findXml(xml, { text })).hits`, `in` in place of `scope`: the innermost lane, sub-process or pool |
| `showXml(xml, { id, context })` | `(await showXml(xml, { id })).text` |
| `showXml(xml, { scope })` | `showXml(xml, { in: scope })`, which also takes a lane |
| `viewXml(xml)` | `(await showXml(xml)).view` |
| `newXml({ processName })`, which returned `{ xml }` | `newXml({ name })`, which returns the XML |
| `renderSvg(xml)` | `(await renderXml(xml)).svg` |
| `metricsXml(xml)` | `diagramXml(xml)` |
| `conventionsXml(xml)` | `kindsJson({ conventions })`; the CLI's `bpmn conventions` reads the `.bpmnlintrc` |
| `extensionsXml(xml, id)` | `(await showXml(xml, { id })).view.extensions` |
| `layoutXml(xml)` | `applyToXml(xml, [{ op: 'layout' }])` |
| `layoutXml(xml, { tidy })` | `applyToXml(xml, [{ op: 'tidy' }])` |
| `layoutXml(xml, { expand, collapse })` | `applyToXml` with one `set` of `expanded` per id, which works in place; a last `{ op: 'layout' }` only for a full redraw |
| `renderMutation(result)` | the CLI's text is the CLI's; read the fields of `EditResult` |
| `edit.result.created`, `.warnings.added`, `.validation` | the `EditResult` fields at the top level: `created`, `findings`, `preexisting`, `state`, `score`, `format`, `notes` |
| `result.layout.mode`, `result.layout.reason` | gone: `score` and `format` stay |
| `KINDS` | `kindsJson().kinds`; `prefix` of a kind becomes `pattern` |
| `kindsJson().triggers` as a table | a list, each row named by its `trigger`, without `timerKind` and `option` |
| `kindsJson()`'s other sections, such as `ops` and `errors` | `OPS_SCHEMA`, and the `bpmn guide` topics |
| `FORMAT_OP_NAMES` | `OPS_SCHEMA.$defs.drawingOp`, a `oneOf` of the 8 drawing operations |
| `NamedValidator`, `Warning` | `Validator`, `Finding` |
| `validateDoc`, `covers`, `leftOut` on a validator | gone: a validator takes the XML |
| `context.ops`, `context.doc()` | `context.operations`, and `importWarnings` beside them |
| the options `layout`, `platform`, `file` | gone: a write draws by the one rule, and the file's namespaces give the platform |
| the `problems:` at the end of `showXml`'s text | `(await validateXml(xml)).findings` |
| a drawing operation before the model operation that adds its target: `E_NOT_FOUND` | `E_USAGE` with the hint to send the model operations first |
| `BpmnError` | the same `code`, `category` (`usage`, `model`, `layout`, `io`, `internal`) and `details` |

A host that lets an agent build a model over many calls tells it to end the build with a `layout`
operation: 1.0 no longer redraws by itself. Words a host shows from CLI hints follow the new names:
`diagram` for `show --layout` and `metrics`, `tidy` for `layout --tidy`, `guide` for `kinds`.

## Next steps

- [Commands](commands.md): every command of 1.0.
- [Library use](library.md): the ten exports and their options.
- [Validators](validators.md): the validator hook.
