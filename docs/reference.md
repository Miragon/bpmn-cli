# Syntax and output

How new ids are made, the element kinds and triggers, where a node goes, flags and keys, and what a
command prints and exits with.

::: tip From the CLI
`bpmn guide kinds`, `bpmn guide triggers`, `bpmn guide set-keys`, `bpmn guide nested-keys`,
`bpmn guide zeebe-elements`, `bpmn guide ids` and `bpmn guide exit-codes` print every table here in
full. They are generated from the code.
:::

## Ids

Elements are addressed by id, never by name (names may repeat). A new id says what it names and
follows `@miragon/rules/element-id-naming`: the prefixes and case the project's `.bpmnlintrc`
declares, else the rule's defaults below. The ids the file already has do not change that.
Explicit ids (`--id`, `"id"` in an operation) are taken as given.

| element | id | example |
| --- | --- | --- |
| named | prefix + name | `userTask_checkInvoice` |
| unnamed | prefix + kind and place | `gateway_afterCheckInvoice`, `event_timerOnCheckInvoice` |
| flow | its two ends | `flow_checkInvoiceToBookInvoice` |
| join of a split | split id + `Join` | `gateway_invoiceOkJoin` |
| named process | its name | `orderToCash` (unnamed: `Process_1`) |

Hashes and running numbers are never copied. An unknown id (`E_NOT_FOUND`) comes with the ids that
were probably meant.

A flow whose id names its ends in this form is renamed when an edit changes them (`renamed:` in the
result); an older flow id (`Flow_AToB`) stays as it is.

Names become ASCII words (`Prüfung buchen` gives `task_pruefungBuchen`), at most 40 characters
of them: a longer name loses its last words, and a single longer word is cut at 40. An id has at
most 64 characters, a collision suffix included. An id within that is not cut again. A longer one
loses whole words: of the cuts that fit, the one with the most words is taken, then the longest.
A word is cut inside only when no whole word is left to give up.
Also, a number a cut would leave at the end of the id goes too where it would read
like a collision suffix. A taken id gets `2`, `3` (`_2` under snake_case, `-2` under kebab-case)
and a `W_ID_SUFFIXED` warning.

`bpmn conventions <file>` lists what applies. Existing ids never change for the rule.
How to get ids that match: [bpmnlint](bpmnlint.md#id-conventions).

## Kinds

`bpmn add` and `bpmn retype` take the canonical name (`userTask`), an alias (`user`) or the moddle
type (`bpmn:UserTask`). Events take a trigger suffix (`startEvent:message`, `boundary:timer`).

| family | kinds (aliases) | id prefix |
| --- | --- | --- |
| tasks | `task`, `userTask` (`user`), `serviceTask` (`service`), `scriptTask` (`script`), `sendTask` (`send`), `receiveTask` (`receive`), `manualTask` (`manual`), `businessRuleTask` (`rule`) | the kind: `task_`, `userTask_`, ... |
| sub-processes | `subProcess` (`sub`), `eventSubProcess` (`eventSub`; needs a start event inside: create it as `eventSubProcess:<trigger>`, or add both in one `bpmn apply`), `adHocSubProcess` (`adhoc`), `transaction` | `subProcess_` |
| call activity | `callActivity` (`call`) | `callActivity_` |
| gateways | `exclusiveGateway` (`xor`), `parallelGateway` (`and`), `inclusiveGateway` (`or`), `complexGateway` (`complex`), `eventBasedGateway` (`eventBased`) | `gateway_` |
| events | `startEvent` (`start`), `endEvent` (`end`), `intermediateCatchEvent` (`catch`), `intermediateThrowEvent` (`throw`), `boundaryEvent` (`boundary`, `--on <hostId>`) | `startEvent_`, `endEvent_`, else `event_` |
| pools and lanes | `participant` (`pool`; the first wraps the process, `--black-box` for one without), `lane` | `participant_`, `lane_` |
| data | `dataObject` (`data`), `dataStore` (`store`) | `dataObject_`, `dataStore_` |
| artifacts | `textAnnotation` (`note`), `group` (`--members <ids...>`) | `textAnnotation_`, `group_` |

Choreographies are refused (`E_USAGE`). No Camunda 7 / 8 engine runs a
`complexGateway`: the Camunda checks report it (`W_C7_DEPLOY_COMPLEX_GATEWAY`,
`W_C8_DEPLOY_UNSUPPORTED`); use `exclusiveGateway` or `inclusiveGateway` there.

## Triggers

The trigger is the kind's suffix, its details are keys: `bpmn add order.bpmn boundary:timer
"Late" --on task_archive timer=P2D`. Messages, errors and signals are found by name and
created when missing.

| trigger | keys |
| --- | --- |
| `message` | `message=<name>` |
| `timer` | `timer=<iso>`: `R/PT1H` is a cycle, `PT5M` a duration, a date a date |
| `error` | `error=<name>`, `errorCode=<code>` |
| `signal` | `signal=<name>` |
| `escalation` | `escalation=<name>`, `escalationCode=<code>` |
| `conditional` | `when=<expr>` |
| `link` | `link=<name>` |
| `none`, `compensate`, `terminate`, `cancel` | none |

`nonInterrupting=true` makes a boundary event or an event sub-process start non-interrupting.
`retype` keeps the current trigger unless you write `<kind>:none`. Which trigger fits which event:
`bpmn guide triggers`.

## Placement grammar

`add` and `move` place a flow node with one of these. Without one the node goes into the only
process, unconnected.

| flag | rule |
| --- | --- |
| `--after <X>` | append after X, or splice into its single outgoing flow: `X -> node -> old successor` |
| `--before <Y>` | the mirror image |
| `--after <X> --before <Y>` | splice into the flow `X -> Y` |
| `--flow <F>` | splice into flow F |
| `--in <S>` | into process, sub-process or pool S, unconnected |
| `--on <A>` | boundary events: attach to activity A |
| `--to <T>` | also connect `node -> T` |

Sequence flows never cross pools (`E_CROSS_SCOPE`): use a message flow. Branch order:
`bpmn order` sets it, `set <flowId> default=true` picks the branch that runs straight. The same
table: `bpmn guide placement`.

## Flag or key=value {#flag-or-key-value}

Each input of a command has one form.

| form | says | for example |
| --- | --- | --- |
| `--flag` | where the element goes | `--after <id>`, `--before`, `--flow`, `--in <scopeId>`, `--on <activityId>`, `--lane <laneId>`, `--to` |
| `--flag` | which id it gets, and what is made with it: the flow into it, a pool's process, a lane's members | `--id <id>`, `--flow-name`, `--flow-id`, `--condition`, `--language`, `--default`, `--process`, `--members` |
| `--flag` | how the command runs | `-o`, `--dry-run`, `--force`, `--json`, `--if-absent`, `--replace` |
| `key=value` | what the element holds | `timer=P2D`, `doc="Four eyes"`, `camunda:assignee=kermit`, on a flow `name=yes condition="=ok"` |

- `key=value` takes the keys of `bpmn set`, the same on `add`, `retype`, `connect` and `set`; in a
  batch they go under `"set"`. What `bpmn add --help` lists is a flag; every other input is a key.
- A key the element does not take answers `E_UNKNOWN_KEY` with the keys it does take, so
  `add userTask ... timer=P2D` is refused, not ignored. An unknown flag answers `E_USAGE`.
- On `ext add` the keys are the extension element's attributes, and `body=` its text.
- The draw commands keep their flags (`--color`, `--side`, `--by`): they change how a shape is drawn,
  which no key holds.

## Set keys

`bpmn set <file> <id> key=value ...`. `key=` removes a property.

| applies to | keys |
| --- | --- |
| any element | `id` (every reference follows), `name`, `doc`, any BPMN attribute, vendor attributes (`camunda:assignee`) |
| sequence flows | `condition`, `language`, `default`, `source`, `target` |
| events | `trigger`, `timer`, `message`, `error`, `signal`, `when`, `nonInterrupting`, ... |
| activities | `loop` (`standard` / `parallel` / `sequential`), `cardinality`, `completion` |
| flow nodes | `lane` (lane id; empty removes the membership), `default` (id of the default outgoing flow; empty clears it) |
| sub-processes | `expanded` (`false` collapses in place), `triggeredByEvent` |
| business rule tasks | `calledDecision`, written as `camunda:decisionRef` or `zeebe:calledDecision` |
| message flows, send and receive tasks | `message` |
| text annotations | `text` |
| nested elements | `definition.<key>`, `loop.<key>`, `condition.<key>` |

Camunda 8 settings are extension elements, not set keys ([Camunda](camunda.md)). Every key:
`bpmn guide set-keys nested-keys`.

## Output, errors and exit codes

| exit | meaning |
| --- | --- |
| 0 | ok (warnings allowed) |
| 1 | usage error: unknown command, flag, operation or key (`E_USAGE`) |
| 2 | model or validation error (`E_NOT_FOUND`, `E_VALIDATION`, ...); `validate`: also an error of project lint |
| 3 | layout error (`E_LAYOUT_*`) |
| 4 | file, parse or render error (`E_FILE_NOT_FOUND`, `E_PARSE`, `E_IMPORT_LOSSY`) |
| 5 | `validate --strict` and the file has warnings |
| 70 | internal error (`BPMN_DEBUG=1` prints the stack) |

A write prints what it did in at most 1 KB, then the layout score, the state and the file line. Findings
are those at the elements it touched; the state counts the whole file, and `bpmn validate` lists it.

```console
$ bpmn add order.bpmn end "Done" --after userTask_checkInvoice
created endEvent: endEvent_done
created sequenceFlow: flow_checkInvoiceToDone
note: appended after userTask_checkInvoice
layout quality: score 0 -> 0
state: 0 errors, 0 warnings (bpmn validate lists them and runs the project's lint)
written: order.bpmn
```

`--json` prints the same as one line, never cut (shortened):

```json
{
  "ok": true,
  "file": "order.bpmn",
  "written": true,
  "unchanged": false,
  "created": [
    { "id": "endEvent_done", "kind": "endEvent", "name": "Done", "detail": "after userTask_checkInvoice" },
    { "id": "flow_checkInvoiceToDone", "kind": "sequenceFlow", "detail": "userTask_checkInvoice -> endEvent_done" }
  ],
  "changed": [],
  "removed": [],
  "renamed": [],
  "aliases": {},
  "findings": [],
  "preexisting": [],
  "state": { "errors": 0, "warnings": 0 },
  "score": { "before": { "score": 0 }, "after": { "score": 0 } }
}
```

Errors go to stderr, and every refusal names a fix:

```console
$ bpmn add order.bpmn userTask Ship --after userTask_check
error E_NOT_FOUND: No element with id "userTask_check" (did you mean: userTask_checkInvoice?)
  element: userTask_check
  candidates: userTask_checkInvoice
  op: #0
  hint: Run `bpmn show <file>` or `bpmn find <file> <text>` to list ids.
```

`bpmn guide errors` lists the common codes with their fix. `-` as the file reads the model from stdin.

## Quoting

::: warning Expressions in single quotes
Write `--condition '${amount > 100}'`. In double quotes the shell expands `${...}` to nothing.
:::

Names with spaces need quotes (`"Check invoice"`), and so does a whole pair (`name="Check it"`).
In a batch file nothing is expanded.
