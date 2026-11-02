# Commands

Every command at a glance, the rules they share, and what they print. `bpmn <command> --help` prints
every option of one command; `bpmn guide <topic>` prints the full tables (kinds, triggers, keys,
operations, exit codes), generated from the code.

## Overview

| group | command | what it does |
| --- | --- | --- |
| Read | `show <file> [<id>]` | the model as text, or everything about one element; `--in`, `--around --depth` narrow it |
| | `find <file> [<text>]` | one tab-separated line per match over ids, names and values; `--kind`, `--in` filter |
| | `diagram <file>` | the layout score, its problems with ids, the rows and columns |
| | `conventions <file>` | the id pattern of each kind ([bpmnlint](./bpmnlint.md#id-conventions)) |
| | `render <file> -o <png\|svg>` | draw it; `<ids>`, `--around`, `--path` crop, `--problems` numbers the problems |
| | `validate <file>` | structure, engine rules, the project's bpmnlint and a layout dry run |
| Change | `new <file> [<name>]` | a file with one empty process; `--target camunda7\|camunda8\|none` |
| | `add <file> <kind> [<name>]` | create an element and wire it in |
| | `connect <file> <source> <target>` | sequence flow, message flow, association or data association, by the ends |
| | `set <file> <id> <key=value...>` | change properties; `id=<new>` renames, `key=` removes |
| | `remove <file> <ids...>` | remove elements and bridge the gap |
| | `retype <file> <id> <kind>` | change the kind, keep id, flows and boundary events |
| | `move <file> <ids...>` | detach nodes and place them again, like `add` |
| | `order <file> <id> <ids...>` | order a node's outgoing flows, a pool's lanes or the pools |
| | `ext add\|remove <file> <id> <type>` | vendor extension elements (`camunda:`, `zeebe:`) |
| | `apply <file> <ops.json>` | a batch of operations as one transaction |
| Draw | `layout`, `place`, `color`, `label`, `route`, `space`, `tidy`, `compact` | change the drawing only ([Layout](./layout.md)) |
| Help | `guide [<topics...>]` | the help, by topic |

`-` as the file reads the model from stdin; a write then prints the XML to stdout.

## Flags and keys

A **flag** says where an element goes and how the command runs. A **`key=value`** says what the
element holds, the same on `add`, `set`, `retype` and `connect`, and under `"set"` in a batch.

```sh
bpmn add order.bpmn boundary:timer "2 days" --on userTask_checkInvoice timer=P2D nonInterrupting=true
bpmn set order.bpmn userTask_checkInvoice name="Check the invoice" camunda:assignee=kermit
bpmn connect order.bpmn gateway_invoiceOk serviceTask_bookInvoice name=yes condition="= ok"
```

A key the element does not take is refused (`E_UNKNOWN_KEY`) with the keys it does take; an unknown
flag answers `E_USAGE`. Every write takes:

| option | effect |
| --- | --- |
| `--json` | the result as one JSON line on stdout, errors as JSON on stderr; never cut |
| `-o <file>` | write elsewhere; `-o -` writes the XML to stdout |
| `--dry-run` | run everything, write nothing |
| `--force` | write despite new errors, a lossy import or content a retype deletes; on `new`, overwrite |

## Placement

`add` and `move` place a node with one of these. Without one it goes into the only process,
unconnected.

| flag | rule |
| --- | --- |
| `--after <X>` | after X, spliced into its single outgoing flow if it has one |
| `--before <Y>` | the mirror image |
| `--after <X> --before <Y>` | into the flow X -> Y |
| `--flow <F>` | into flow F |
| `--in <S>` | into a process, sub-process or pool, unconnected (lanes, data and annotations take only this) |
| `--on <A>` | a boundary event on activity A |
| `--lane <L>` | into lane L; on `move`, an empty value takes it out |
| `--to <T>` | also connect the new node to T |

`--flow-name`, `--condition` and `--default` describe the flow into the new node. A group takes
`--members <ids...>` instead. The first `participant` wraps the existing process; `--black-box`
makes an empty pool. Sequence flows never cross pools (`E_CROSS_SCOPE`): use a message flow.

## Kinds and triggers

A kind is its name (`userTask`), an alias (`user`) or the moddle type (`bpmn:UserTask`). Events take
a trigger suffix, whose details are keys. Messages, errors and signals are found by name and created
when missing. Full lists: `bpmn guide kinds triggers`.

| family | kinds (aliases) |
| --- | --- |
| tasks | `task`, `userTask` (`user`), `serviceTask` (`service`), `scriptTask` (`script`), `sendTask` (`send`), `receiveTask` (`receive`), `manualTask` (`manual`), `businessRuleTask` (`rule`) |
| sub-processes | `subProcess` (`sub`), `eventSubProcess:<trigger>` (`eventSub`), `adHocSubProcess` (`adhoc`), `transaction`, `callActivity` (`call`) |
| gateways | `exclusiveGateway` (`xor`), `parallelGateway` (`and`), `inclusiveGateway` (`or`), `eventBasedGateway` (`eventBased`), `complexGateway` (`complex`; no Camunda engine runs it) |
| events | `startEvent` (`start`), `endEvent` (`end`), `intermediateCatchEvent` (`catch`), `intermediateThrowEvent` (`throw`), `boundaryEvent` (`boundary`) |
| others | `participant` (`pool`), `lane`, `dataObject` (`data`), `dataStore` (`store`), `textAnnotation` (`note`), `group` |

| trigger | keys |
| --- | --- |
| `message` | `message=<name>` |
| `timer` | `timer=<iso>`: `PT5M` a duration, `R/PT1H` a cycle, a date a date |
| `error` | `error=<name>`, `errorCode=<code>` |
| `signal` | `signal=<name>` |
| `escalation` | `escalation=<name>`, `escalationCode=<code>` |
| `conditional` | `when=<expr>` |
| `link` | `link=<name>` |
| `none`, `compensate`, `terminate`, `cancel` | none |

`nonInterrupting=true` makes a boundary event or an event sub-process start non-interrupting.
`retype` keeps the trigger unless the new kind names one (`startEvent:none` drops it).

## Common keys

| on | keys |
| --- | --- |
| any element | `id`, `name`, `doc`, any BPMN attribute, vendor attributes (`camunda:assignee`) |
| sequence flows | `condition`, `language`, `default`, `source`, `target` |
| flow nodes | `lane`, `default` (the id of the default outgoing flow) |
| activities | `loop` (`standard`, `parallel`, `sequential`), `cardinality`, `completion` |
| sub-processes | `expanded` (`false` collapses in place), `triggeredByEvent` |
| business rule tasks | `calledDecision` |
| nested parts | `definition.<key>`, `loop.<key>`, `condition.<key>` |

In a Camunda 8 file most settings are extension elements ([Camunda 7 and 8](./camunda.md)). Every
key: `bpmn guide set-keys nested-keys`.

## Removing and moving

`remove` takes what depends on the element along and connects predecessor to successor.
`--bridge none` leaves the gap, `--with-branch` removes the path only this node leads to, and
`--if-exists` skips unknown ids. At a parallel or inclusive join it cannot guess: `E_AMBIGUOUS_BRIDGE`
asks for `--bridge all` or `--bridge none`. `move` bridges the same way and then places the nodes
with the flags of `add`.

## Extension elements

```console
$ bpmn ext add order.bpmn serviceTask_bookInvoice camunda:inputParameter name=amount 'body=${order.total}'
$ bpmn show order.bpmn serviceTask_bookInvoice
...
ext 0: camunda:inputOutput  in amount=${order.total}
$ bpmn ext remove order.bpmn serviceTask_bookInvoice 'camunda:inputParameter[name=amount]'
```

Each `key=value` is an attribute, `body=` the text. Containers such as `camunda:inputOutput` are made
and removed for you. `--xml` takes a raw snippet, `--replace` replaces instead of merging. Quote
selectors: zsh expands `[` and `]`.

## Output and exit codes

A write prints what it created, changed, renamed and removed, its findings at the touched elements,
the layout score, the state of the whole file and the file line. Errors go to stderr, each with a
hint:

```console
$ bpmn add order.bpmn userTask Ship --after userTask_check
error E_NOT_FOUND: No element with id "userTask_check" (did you mean: userTask_checkInvoice?)
  element: userTask_check
  candidates: userTask_checkInvoice
  op: #0
  hint: Run `bpmn show <file>` or `bpmn find <file> <text>` to list ids.
```

| exit | meaning |
| --- | --- |
| 0 | ok, warnings allowed |
| 1 | usage: unknown command, flag, operation or key |
| 2 | model or validation error; on `validate`, also a bpmnlint error |
| 3 | layout error (`E_LAYOUT_*`) |
| 4 | file, parse or render error |
| 5 | `validate --strict` found warnings |
| 70 | internal error (`BPMN_DEBUG=1` prints the stack) |

`bpmn guide errors` lists the common codes with their fix.

## Quoting

Write expressions in single quotes (`--condition '${amount > 100}'`): in double quotes the shell
expands `${...}` to nothing. Quote names with spaces and whole pairs (`name="Check it"`). In a batch
file nothing is expanded.
