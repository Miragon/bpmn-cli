# Ids, kinds and keys

How new ids are made, the element kinds and triggers, where a node goes, the keys `set` takes, and
what a command prints and exits with.

::: tip From the CLI
`bpmn kinds` prints every table here in full, `bpmn guide <topic>` the rules. Both are generated
from the code.
:::

## Ids

Elements are addressed by id, never by name (names may repeat). A new id says what it names and
follows the file's id style: prefix, case and flow form. A file without a style gets the defaults
below. Explicit ids (`--id`, `"id"` in ops JSON) are taken as given.

| element | id | example |
| --- | --- | --- |
| named | prefix + name | `Activity_CheckInvoice` |
| unnamed | prefix + kind and place | `Gateway_AfterArchive`, `Event_TimerOnArchive` |
| flow | its two ends | `Flow_CheckInvoiceToBookInvoice` |
| join of a split | split id + `_join` | `Gateway_InvoiceOk_join` |

In a file with other conventions the same task becomes `serviceTask_checkStock` or
`Task_check_stock`. Hashes and running numbers are never copied. An unknown id (`E_NOT_FOUND`)
comes with the ids that were probably meant.

A flow whose id names its ends is renamed when an edit changes them (`renamed:` in the result).
`--keep-flow-ids` keeps the id and reports `W_FLOW_ID_STALE` with the `bpmn set` that renames it.

Names become ASCII words (`Prüfung buchen` gives `Activity_PruefungBuchen`), at most 40 characters
of them: a longer name loses its last words, and a single longer word is cut at 40. An id has at
most 64 characters, a collision suffix included. An id within that is not cut again. A longer one
loses whole words: of the cuts that fit, the one with the most words is taken, then the longest.
A word is cut inside only when no whole word is left to give up.
Also, a number a cut would leave at the end of the id goes too where it would read
like a collision suffix. A taken id gets `_2`, `_3` and a `W_ID_SUFFIXED` warning.

Where the project's `.bpmnlintrc` runs `@miragon/rules/element-id-naming`, its prefixes and case
decide instead (`serviceTask_checkInvoice`). `bpmn show <file> --conventions` lists what applies.
Existing ids never change for the rule. Details: [bpmnlint](bpmnlint.md#id-conventions).

## Kinds

`bpmn add` and `bpmn retype` take the canonical name (`userTask`), an alias (`user`) or the moddle
type (`bpmn:UserTask`). Events take a trigger suffix (`startEvent:message`, `boundary:timer`).

| family | kinds (aliases) | id prefix |
| --- | --- | --- |
| tasks | `task`, `userTask` (`user`), `serviceTask` (`service`), `scriptTask`, `sendTask`, `receiveTask`, `manualTask`, `businessRuleTask` (`rule`) | `Activity_` |
| sub-processes | `subProcess` (`sub`), `eventSubProcess` (`eventSub`; needs a start event inside: create it as `eventSubProcess:<trigger>`, or add both in one `bpmn apply`), `adHocSubProcess`, `transaction` | `Activity_` |
| call activity | `callActivity` (`call`) | `Activity_` |
| gateways | `exclusiveGateway` (`xor`), `parallelGateway` (`and`), `inclusiveGateway` (`or`), `eventBasedGateway` | `Gateway_` |
| events | `startEvent` (`start`), `endEvent` (`end`), `intermediateCatchEvent` (`catch`), `intermediateThrowEvent` (`throw`), `boundaryEvent` (`boundary`, `--on <hostId>`) | `Event_` |
| pools and lanes | `participant` (`pool`; the first wraps the process, `--black-box` for one without), `lane` | `Participant_`, `Lane_` |
| data | `dataObject` (`data`), `dataStore` (`store`) | `DataObjectReference_`, `DataStoreReference_` |
| artifacts | `textAnnotation` (`note`) | `TextAnnotation_` |

`complexGateway`, choreographies and groups are rejected (`E_UNSUPPORTED_KIND`).

## Triggers

The trigger is the kind's suffix, its details an option: `bpmn add order.bpmn boundary:timer
"Late" --on Activity_Archive --timer P2D`. Messages, errors and signals are found by name and
created when missing.

| trigger | option |
| --- | --- |
| `message` | `--message <name>` |
| `timer` | `--timer <iso>` (`R/PT1H`, `P2D`, a date) |
| `error` | `--error <name>` `[--error-code <code>]` |
| `signal` | `--signal <name>` |
| `escalation` | `--escalation <name>` |
| `conditional` | `--when <expr>` |
| `link` | `--link <name>` |
| `none`, `compensate`, `terminate`, `cancel` | none |

`retype` keeps the current trigger unless you write `<kind>:none`. Which trigger fits which event:
`bpmn guide triggers`.

## Placement grammar

`add` and `move` place a flow node with one of these. Without one the node goes into the only
process, unconnected.

| option | rule |
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

## Set keys

`bpmn set <file> <id> key=value ...`. `key=` or `--unset key` removes a property. An unknown key
fails with `E_UNKNOWN_KEY` and lists the keys the element accepts.

| applies to | keys |
| --- | --- |
| any element | `id` (every reference follows), `name`, `doc`, any BPMN attribute, vendor attributes (`camunda:assignee`) |
| sequence flows | `condition`, `language`, `default`, `source`, `target` |
| events | `trigger`, `timer`, `message`, `error`, `signal`, `when`, ... |
| activities | `loop` (`standard` / `parallel` / `sequential`), `cardinality`, `completion` |
| flow nodes | `lane` (lane id; empty removes the membership), `default` (id of the default outgoing flow; empty clears it) |
| business rule tasks | `calledDecision`, written as `camunda:decisionRef` or `zeebe:calledDecision` |
| nested elements | `definition.<key>`, `loop.<key>`, `condition.<key>` |

Camunda 8 settings are extension elements, not set keys ([Camunda](camunda.md)). Every key:
`bpmn kinds --section setKeys,nestedKeys`.

## Output, errors and exit codes

| exit | meaning |
| --- | --- |
| 0 | ok (warnings allowed) |
| 1 | usage error (`E_USAGE`) |
| 2 | model or validation error (`E_NOT_FOUND`, `E_VALIDATION`, ...) |
| 3 | layout error |
| 4 | I/O or parse error |
| 5 | `--strict` and the result has warnings |
| 70 | internal error (`BPMN_DEBUG=1` prints the stack) |

A mutating command prints what it created, changed and removed, then warnings, the layout and the
file line:

```console
$ bpmn add order.bpmn end "Done" --after Activity_CheckInvoice
created endEvent Event_Done "Done" - after Activity_CheckInvoice
created sequenceFlow Flow_CheckInvoiceToDone - Activity_CheckInvoice -> Event_Done
note: appended after Activity_CheckInvoice
resolved: W_NO_END Process_OrderHandling, W_DEAD_END Activity_CheckInvoice
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn
```

`--json` prints the same as one line (shortened):

```json
{
  "ok": true, "file": "order.bpmn", "written": true, "unchanged": false,
  "created": [{ "id": "Event_Done", "kind": "endEvent", "name": "Done" }],
  "warnings": { "added": [], "resolved": [], "preexistingCount": 0 },
  "layout": { "status": "ok", "mode": "full" },
  "importWarnings": []
}
```

Errors go to stderr as `error E_CODE: message` with a hint and candidate ids. Every code with its
fix: `bpmn kinds --section errors`. `-` as the file reads the model from stdin.

### Environment

| variable | effect |
| --- | --- |
| `BPMN_KEEP_FLOW_IDS` | `1`, `true`, `yes`, `on`: every mutating command keeps flow ids, as with `--keep-flow-ids` |
| `BPMN_LAYOUT_DEBUG` | layout diagnostics on stderr |
| `BPMN_DEBUG` | the stack trace of an internal error |

Where `BPMN_KEEP_FLOW_IDS=1` changed a result, the result says so, since the reader may not see
the variable: `note: flow ids kept: BPMN_KEEP_FLOW_IDS=1 (--no-keep-flow-ids renames flows after
their new ends for one command)`.

## Quoting

::: warning Expressions in single quotes
Write `--condition '${amount > 100}'`. In double quotes the shell expands `${...}` to nothing.
:::

Names with spaces need quotes (`"Check invoice"`), and so does a whole pair (`name="Check it"`).
In ops JSON nothing is expanded.
