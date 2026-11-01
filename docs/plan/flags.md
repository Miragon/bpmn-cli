# Flags

What does each flag do, what is it worth, and does 1.0 keep it? Commands, and what goes with them, are
on the [commands page](cli.md).

| measure | today | 1.0 |
| --- | ---: | ---: |
| flag slots over all commands | 443 | 143 |
| shared write flags | 15 | 4 |
| own flags on `add` · `retype` | 31 · 11 | 17 · 0 |

A flag slot is one flag on one command. Two rules cut most of them:

- A flag says where an element goes and how the command runs; what the element holds is a
  `key=value` ([below](#flag-or-keyvalue)).
- A flag stays when it is the only way to say its input, or a refusal names it as the remedy
  (`--replace`, `--bridge`, `--with-branch`). A flag that another command, a
  `key=value` or the default covers goes, used or not, unless it saves a batch a second operation; it then
  answers `E_USAGE` as an unknown flag. The uses below
  decide nothing alone: they show who has to move.

Uses count `bpmn <command> … --flag` calls and operation JSON keys in the skill (`skill`), the docs (`docs`)
and the evals (`evals`), operation keys and library options in design-iq (`diq`) and ask-miragon (`ask`), and calls in
bpmn-to-code's skills (`b2c`); main 4cbec59. A prose mention outside a call is not counted; shared flags
count every mention.

## Flag or `key=value`

Each input of a command has one form.

| form | says | for example |
| --- | --- | --- |
| `--flag` | where the element goes | `--after <id>`, `--before`, `--flow`, `--in <scopeId>`, `--on <activityId>`, `--lane <laneId>`, `--to` |
| `--flag` | which id it gets, and what is made with it: the flow into it, a pool's process, a lane's members | `--id <id>`, `--flow-name`, `--flow-id`, `--condition`, `--language`, `--default`, `--process`, `--members` |
| `--flag` | how the command runs | `-o`, `--dry-run`, `--force`, `--json`, `--if-absent`, `--replace` |
| `key=value` | what the element holds | `timer=P2D`, `doc="Four eyes"`, `camunda:assignee=kermit`, on a flow `name=yes condition="=ok"` |

`--on <activityId>` attaches a boundary event to the edge of a task: while the task runs and the event
fires, the path out of the event starts. `--after <id>` puts the new element behind `<id>` in the flow.

- `key=value` takes the keys of `bpmn set`, the same on `add`, `retype`, `connect` and `set`; in a
  batch they go under `"set"`. What `bpmn add --help` lists is a flag; every other input is a key.
- A key belongs to the element the command makes or changes. `connect` makes a flow, so the flow's name,
  condition, language, default marker and message are keys, the ones `bpmn set <flowId>` takes; the
  catalogue learns `message=` on message flows, which today it takes only on events and on send and receive tasks.
- `add` makes a node. The flow it draws into the node is a second element, so flags describe it
  (`--flow-name`, `--condition`), and `bpmn set <file> <flowId> condition=…` changes it later.
- The name is the positional `[name]` on `new` as on `add`.
- On `ext add` the keys are the extension element's attributes, and `body=` its text, as `show <id>`
  prints them. `--xml` stays a flag: a raw snippet takes the place of the type and the keys.
- The drawing commands keep their flags (`--color`, `--side`, `--by`): they change how a shape is drawn,
  which no key of `bpmn set` holds.
- One catalogue, `PropertyCatalog` in `model/vendor` ([direction](modules.md#direction)), maps each key per element type: `timer=P2D` writes a
  `timerEventDefinition` on an event, `nonInterrupting=true` writes `cancelActivity="false"`, and a key
  the type does not take answers `E_UNKNOWN_KEY` with the keys it does take. A flag cannot: commander
  lists the same flags for every kind, so today `add userTask --timer P2D` writes the task without the
  timer and exits 0, with only the warning `W_OPTION_IGNORED`.
- A retired flag answers `E_USAGE` as an unknown option. A `key=value` that is no key of the element,
  such as `id=` on `add`, answers `E_UNKNOWN_KEY` with the keys it takes. On `ext add` every
  `key=value` is an attribute of the extension element, `type=` and `id=` too
  (`zeebe:taskDefinition type=check-order`); the `ext` operation keeps them in `attrs`.
- Extension elements with attributes of their own, such as `zeebe:taskDefinition`, stay with `ext add`.
- Flags alone cannot carry it: extension attributes are an open set (`camunda:assignee`,
  `definition.<key>`), unknown to commander. kubectl (`kubectl label pod web tier=frontend`), httpie and
  `npm pkg set` split the same way.

### Before and after

Placeholders as `--help` names them: `<file>` the BPMN file, `<kind>` the element kind, `[name]` its
label, `<id>` an element that exists, `<activityId>` the task an event sits on, `<iso>` an ISO 8601
time such as `P2D` (two days).

```text
today  bpmn add <file> boundaryEvent:timer [name] --on <activityId> --timer <iso> --non-interrupting
       bpmn add order.bpmn boundaryEvent:timer Reminder --on check --timer P2D --non-interrupting

1.0    bpmn add <file> boundaryEvent:timer [name] --on <activityId> timer=<iso> nonInterrupting=true
       bpmn add order.bpmn boundaryEvent:timer Reminder --on check timer=P2D nonInterrupting=true
```

| today | 1.0 |
| --- | --- |
| `--timer <iso>` | `timer=<iso>`: `R/PT1H` is a cycle, `PT5M` a duration, a date a date |
| `--timer-kind <kind>` | goes: `timer=` tells the kinds apart |
| `--message <name>`, `--signal <name>`, `--link <name>` | `message=<name>`, `signal=<name>`, `link=<name>` |
| `--error <name> --error-code <code>` | `error=<name> errorCode=<code>` |
| `--escalation <name> --escalation-code <code>` | `escalation=<name> escalationCode=<code>` |
| `--when <expr>` | `when=<expr>` |
| `--non-interrupting` | `nonInterrupting=true` |
| `--doc <text>`, `--text <text>` | `doc=<text>`, `text=<text>` |
| `--collapsed` | `expanded=false` |
| `bpmn retype <file> <id> <kind> --message <name>` | `bpmn retype <file> <id> <kind> message=<name>` |
| `bpmn connect <file> <sourceId> <targetId> --name <text> --condition <expr>` | `bpmn connect <file> <sourceId> <targetId> name=<text> condition=<expr>` |
| `bpmn connect … --default`, `--language <lang>`, `--message <name>` | `default=true`, `language=<lang>`, `message=<name>` |
| `bpmn new <file> --name <text>` | `bpmn new <file> [name]`, as on `add` |
| `bpmn ext add <file> <id> <type> [attrs…] --body <text>` | `bpmn ext add <file> <id> <type> [key=value…] body=<text>` |
| `bpmn remove <file> <ids…> --no-bridge`, `--bridge-all` | `--bridge none`, `--bridge all` |
| `bpmn layout <file> --collapse <id>` | `bpmn set <file> <id> expanded=false`, which collapses in place; `bpmn layout <file>` only for a full redraw |
| `{ "op": "add", …, "timer": "P2D" }` | `{ "op": "add", …, "set": { "timer": "P2D" } }` |
| `{ "op": "connect", …, "name": "yes" }` | `{ "op": "connect", …, "set": { "name": "yes" } }` |

The same as today:

```text
bpmn add <file> <kind> [name] --after <id> --lane <laneId> --id <id>
bpmn add order.bpmn userTask Check --after start --lane sales --id check

bpmn set <file> <id> <key>=<value> …
bpmn set order.bpmn check doc="Four eyes" camunda:assignee=kermit
```

## Shared flags

Every write command takes them today; the reads (`show`, `find`, `diagram`, `conventions`, `validate`) and `render` take `--json`.

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--json` | prints the result as JSON | programs and graders read data | skill 2 and evals 2, all on reads (`kinds`, `metrics`) · docs 13 | keep |
| `-o` | writes to another file, `-` to stdout | try on a copy; pipe a result | skill 8 · docs 12 | keep |
| `--dry-run` | runs everything, writes nothing | try a risky batch first | skill 6 · docs 1 | keep |
| `--force` | writes despite a lossy import, new errors or content a retype deletes | the one way past these refusals | skill 3 · docs 6 · diq 3 | keep |
| `--pretty` | indents the JSON | none: no use | 0 | goes: `--json`; `jq` indents |
| `--summary` | prints a short report | the short form is all a reader needs | skill 10 · docs 7 | goes: the default text is the short report |
| `--render` | draws an image after the write | saves one call | skill 4 · docs 5 | goes: `bpmn render <ids>`; one job per command |
| `--show` | prints the model after the write | none: no use | 0 | goes: `bpmn show` |
| `--layout` | picks `auto`, `incremental` or `full` | an override nobody needs | skill 13 · docs 9 · diq 1 | goes: one rule: a plane with shapes is drawn incrementally, an empty one in full |
| `--relayout` | redraws in full | same as `--layout full` | skill 3 · docs 2 | goes: `bpmn layout`, or a last `layout` operation |
| `--no-layout` | leaves the drawing as it is | the workaround that keeps vertical lanes, which a write turns horizontal today | skill 2 · docs 7 | goes, without a replacement: a write that places, moves or routes something on a vertical plane answers `E_LAYOUT_INCREMENTAL`; `set`, `retype`, `ext` and the drawing commands pass, `bpmn layout` redraws horizontally; an open decision for the owner |
| `--strict` | exit 5 on warnings | a gate wants it on `validate` | skill 10 · docs 9 · evals 6 | goes: `bpmn validate --strict` |
| `--lint-config` | picks the `.bpmnlintrc` | project lint belongs to `validate` | docs 2 | goes: `bpmn validate --lint-config` |
| `--no-lint-config` | reads no `.bpmnlintrc` | as above | skill 1 · docs 7 | goes: `bpmn validate --no-lint-config` |
| `--backup` | copies the input to `<file>.bak` | Git does it better | skill 1 · docs 1 | goes: Git, or `-o` |

## Read, check and start

### `new`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--name` | the process name | the skill names every new process | skill 7 · docs 14 | goes: `[name]`, as on `add` |
| `--id` | the process id | an id before the first element exists | skill 4 | keep |
| `--target` | `camunda8`, `camunda7` or `none`: namespaces and platform | the Camunda checks know the platform from the start | skill 5 · docs 11 | keep |
| `--no-executable` | sets `isExecutable=false` | none: no use | 0 | goes: `--target none` |

### `show`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--in` | only one pool, process, lane or sub-process | a big model in a small context; the word of `add --in` | as `--scope` | new, from `--scope`, which takes no lane today |
| `--around` | only the neighbourhood of an id | a big model in a small context | skill 4 · b2c 1 · diq 1 | keep |
| `--depth` | flow steps for `--around`, 2 by default | size of that neighbourhood; the skill always asks for 1 | skill 4 · diq 1 | keep, 1 by default |
| `--scope` | only one process, sub-process or pool | design-iq passes it to `showXml` | diq 1 | goes: `--in` |
| `--layout` | the drawing as rows and columns, its problems | reads layout without a picture | skill 6 · docs 1 | goes: `bpmn diagram` |
| `--conventions` | the id patterns new ids follow | agents pick ids that fit the project | skill 3 · docs 4 | goes: `bpmn conventions` |
| `--context` | an element in its context | `show <id>` always shows it | skill 2 · b2c 2 · diq 1 | goes: `show <id>` |
| `--inner` | enters sub-processes from outside | none: no use | 0 | goes: `--in` of the sub-process |
| `--lint-config`, `--no-lint-config` | pick or skip the `.bpmnlintrc` for `--conventions` | reading the naming runs no plugin code | 0 | goes: `conventions` reads the nearest `.bpmnlintrc` |

### `find`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--kind` | one kind, as `add` writes it, or a family: `task`, `event`, `gateway` | every service task in one call, to write its workers | skill 1 | keep, takes families |
| `--in` | only inside one pool, process, lane or sub-process | the ids of one lane, to colour or place them | 0 | new |

`diagram` and `conventions` take `--json` only.

### `validate`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--strict` | exit 5 on warnings | a grader and CI gates want it | skill 5 · docs 3 · evals 2 | keep |
| `--lint-config` | picks the `.bpmnlintrc` | a config outside the tree | 0 | keep |
| `--no-lint-config` | reads no `.bpmnlintrc` | safe in a repository the user does not trust | 0 | keep |
| `--platform` | forces the Camunda checks of c7, c8 or none | none: the file says its platform | 0 | goes: the file's platform |

## Image and help

### `render`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `-o` | the image file; `.png` or `.svg` by extension | the only output | skill 7 · docs 10 | keep |
| `--around`, `--depth` | crop to the neighbourhood of an id | a readable image of a big model | skill 2 · docs 2 | keep |
| `--path` | crop to the shortest path between two ids | show one path | skill 1 | keep |
| `--problems` | numbers the layout problems in the image | see what to fix | skill 3 · docs 3 | keep |
| `--format` | png or svg | the `-o` extension says it | docs 1 | goes: `-o x.svg` |
| `--plane` | draws a collapsed sub-process | an id crops and picks its plane | 0 | goes: `render <id>` |
| `--scope` | crops to a pool, lane or sub-process | an id does that too | skill 1 | goes: `render <id>` |
| `--inner`, `--via`, `--highlight`, `--tiles`, `--max-size`, `--scale` | rarer crops, halos, tiles, size | at most 2 mentions each | skill 1 | goes: a `marks` option comes if a render user asks ([triggers](README.md#triggers)) |

### `guide`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--short` | the 5 KB core | the whole guide stays under 20 KB, so `guide` replaces `--short` | skill 1 · docs 2 · evals 2 | goes: `guide`, `guide <topics…>` |

### `kinds`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--section` | one part of the tables | the tables become guide topics | skill 8 · docs 3 | goes: `guide <topic>` |

## Edit

### `add`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--after` | appends after a node, or splices into its outgoing flow | the main way to place a node | skill 30 · docs 53 · diq 9 | keep |
| `--before` | prepends before a node | places in front of a join | skill 2 | keep |
| `--flow` | splices into one flow by id | the skill teaches it | skill 2 · docs 1 | keep |
| `--in` | puts the node into a container, unconnected | the first node of a pool or sub-process | skill 11 · docs 2 · diq 3 | keep |
| `--on` | the host of a boundary event | the only way to attach one | skill 6 · docs 5 · diq 5 | keep |
| `--to` | also connects the node to this target | a branch that joins again, in one operation | 0 | keep |
| `--lane` | the lane of the node | no guessed lane (`W_LANE_INHERITED`) | skill 17 | keep |
| `--id` | an explicit id | later operations refer to it | skill 53 · docs 1 | keep |
| `--if-absent` | succeeds without change if the id exists | a batch can run twice | skill 1 | keep |
| `--flow-name`, `--flow-id`, `--condition`, `--default` | label, id, condition, default marker of the flow into the node | a gateway branch in one operation | skill 2 · docs 2 | keep |
| `--language` | expression language of that condition | script conditions in Camunda 7 | 0 | keep |
| `--process` | wraps an existing process in the new pool | the only way to do that | 0 | keep |
| `--black-box` | a pool without a process | external partners | skill 1 · docs 5 · diq 2 | keep |
| `--members` | members of a lane, elements of a group | a group needs them | 0 | keep |
| `--timer` | the timer | the same as `timer=` | skill 4 · docs 4 · diq 4 | `key=value`: `timer=<iso>` |
| `--timer-kind` | cycle, duration or date | `timer=` tells them apart | 0 | goes: `timer=<iso>` |
| `--message`, `--error`, `--error-code`, `--signal`, `--escalation`, `--escalation-code`, `--when`, `--link` | the event definition | the same as `message=` and so on | skill 7 · docs 3 | `key=value`: `message=<name>`, `errorCode=<code>` … |
| `--non-interrupting` | a boundary event that does not cancel | the same as `nonInterrupting=true` | skill 3 · docs 3 | `key=value`: `nonInterrupting=true` |
| `--doc`, `--text` | documentation, annotation text | the same as `doc=`, `text=` | diq 2 | `key=value`: `doc=<text>`, `text=<text>` |
| `--collapsed` | draws a sub-process collapsed | the same as `expanded=false` | 0 | `key=value`: `expanded=false` |

### `connect`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--id` | the id of the connection | later operations refer to it | skill 13 · docs 2 · diq 2, with `--name` | keep |
| `--name` | the label of the connection | what the flow holds | as above | `key=value`: `name=<text>` |
| `--condition`, `--language`, `--default` | condition and default marker of a sequence flow | what the flow holds | docs 1 | `key=value`: `condition=<expr>`, `language=<lang>`, `default=true` |
| `--message` | the message of a message flow | what the flow holds | docs 5 | `key=value`: `message=<name>` |
| `--if-absent` | succeeds if the same connection exists | a batch can run twice | 0 | keep |

### `set`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--unset` | removes a key | the same as `key=` | 0 | goes: `key=`, which set already reads |

### `remove`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--no-bridge` | removes without connecting predecessor and successor | the remedy that `E_INVALID_BRIDGE` names | 0 | goes: `--bridge none` |
| `--bridge-all` | connects every predecessor of a join | the remedy for a join | 0 | goes: `--bridge all` |
| `--bridge none\|all` | how the gap closes: not at all, or from every predecessor of a join; without it a single gap is bridged, as today | one choice, one flag; the remedy the refusals name | 0 | new, from the two above |
| `--with-branch` | also removes the path only this node leads to | removes a branch in one operation | 0 | keep |
| `--if-exists` | skips unknown ids | a batch can run twice | skill 1 | keep |

### `retype`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--timer` … `--non-interrupting` (10) | the new event definition | the same keys as `add` | skill 1 · docs 1 | `key=value`: `retype <file> <id> <kind> [key=value…]` |
| `--timer-kind` | cycle, duration or date | `timer=` tells them apart | 0 | goes: `timer=<iso>` |

### `move`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--after`, `--before`, `--flow`, `--in`, `--on` | the new place, as on `add` | one placement grammar | docs 1 | keep |
| `--lane` | the new lane; empty removes it | design-iq moves nodes between lanes | skill 3 · diq 4 | keep |

### `ext add`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--body` | text content of the element | scripts and expressions | skill 2 · docs 3 | `key=value`: `body=<text>` |
| `--xml` | a raw snippet with nested elements | what attributes cannot express | diq 1 | keep |
| `--replace` | replaces instead of merging | the remedy `E_DUPLICATE_EXTENSION` names | 0 | keep |

## Draw

### `layout`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--expand`, `--collapse` | redraws sub-processes expanded or collapsed | the same as `set <id> expanded=` | diq 1 | `key=value`: `set <file> <id> expanded=false` |
| `--tidy` | tidies instead of redrawing | its help says "= bpmn tidy" | diq 1 | goes: `bpmn tidy` |

### `tidy`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--path`, `--via`, `--kind`, `--branch` | pick ids by path, branch or kind | none: no use; `tidy` takes ids | 0 | goes: `tidy <ids…>` |

### `place`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--row-of`, `--below`, `--above` | puts nodes into a row | straightens a path | skill 4 · docs 3 | keep |
| `--column-of`, `--after`, `--before` | puts nodes into a column | vertical lanes need columns | 0 | keep |
| `--side` | moves a boundary event to a side of its host | the only way to do that | skill 1 | keep |
| `--path`, `--branch` | pick ids by path or branch | the skill places a branch below | skill 3 | keep |
| `--via`, `--kind` | pick a path through flows, or by kind | none: no use | 0 | goes: `--branch`; `find --kind` lists ids |

### `align`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--axis`, `--to`, `--path`, `--via`, `--kind`, `--branch` | lines shapes up | the command goes | skill 2 | goes: one `place` per id |

### `color`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--color` | one of the bpmn-js colours, or `default` | the colour | skill 6 · diq 1 | keep |
| `--path`, `--branch` | pick ids by path or branch | colours the happy path | skill 5 | keep |
| `--via`, `--kind` | pick a path through flows, or by kind | none: no use | 0 | goes: `--branch`; `find --kind` lists ids |

### `label`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--side` | the side the label goes to | the only option | skill 2 | keep |

### `route`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--exit`, `--entry` | the sides a flow leaves and enters by | the only options | skill 2 | keep |

### `space`

| flag | does | worth | uses | 1.0 |
| --- | --- | --- | --- | --- |
| `--after`, `--below`, `--by` | where and how much room to make | the only options | skill 5 | keep |

## Not flags

- `order`, `apply`, `ext remove` and `compact` have no own flags; `ext list`, `align`, `kinds` and
  `metrics` go with their command.
- Batch-only operation fields (`as`, `flowAs`, `outAs`, `refAs`) name an element for a later operation of the same
  `apply`; `CommandSyntax` makes no flag of them. `order`'s `lanes` and `pools`, which its `<ids…>` cover, and `ext`'s
  `index` and `slot`, which its `<selector>` covers, are batch-only too.
- `move`'s operation fields `flowName`, `flowId`, `condition`, `language` and `default` have no flag today and
  0 uses; they leave the operation, so no flag appears. `set <flowId>` after the move does the same.

## Per command

| command | flag slots today | 1.0 |
| --- | ---: | ---: |
| `new` | 19 | 4 |
| `show` | 11 | 4 |
| `find` | 3 | 3 |
| `diagram`, today `metrics` | 2 | 1 |
| `conventions`, today `show --conventions` | 0 | 1 |
| `validate` | 6 | 4 |
| `render` | 16 | 6 |
| `guide` | 1 | 0 |
| `add` | 46 | 21 |
| `connect` | 22 | 6 |
| `set` | 16 | 4 |
| `remove` | 19 | 7 |
| `retype` | 26 | 4 |
| `move` | 21 | 10 |
| `order` | 15 | 4 |
| `apply` | 15 | 4 |
| `ext add` | 18 | 6 |
| `ext remove` | 15 | 4 |
| `layout` | 15 | 4 |
| `tidy` | 19 | 4 |
| `compact` | 15 | 4 |
| `place` | 26 | 13 |
| `color` | 20 | 7 |
| `label` | 16 | 5 |
| `route` | 17 | 6 |
| `space` | 18 | 7 |
| `ext list`, `align`, `kinds` | 26 | 0: the commands go |
