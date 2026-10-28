# Syntax and output

How new ids are made, the element kinds and triggers, where a node goes, the keys `set` takes, and
what a command prints and exits with.

::: tip From the CLI
`bpmn kinds` prints every table here in full, `bpmn guide <topic>` the rules. Both are generated
from the code.
:::

## Ids

Elements are addressed by id, never by name (names may repeat). A new id says what it names and
follows `@miragon/rules/element-id-naming`: the prefixes and case the project's `.bpmnlintrc`
declares, else the rule's defaults below. The ids the file already has do not change that.
Explicit ids (`--id`, `"id"` in ops JSON) are taken as given.

| element | id | example |
| --- | --- | --- |
| named | prefix + name | `userTask_checkInvoice` |
| unnamed | prefix + kind and place | `gateway_afterArchive`, `event_timerOnArchive` |
| flow | its two ends | `flow_checkInvoiceToBookInvoice` |
| join of a split | split id + `Join` | `gateway_invoiceOkJoin` |
| named process | its name | `orderToCash` (unnamed: `Process_1`) |

Hashes and running numbers are never copied. An unknown id (`E_NOT_FOUND`) comes with the ids that
were probably meant.

A flow whose id names its ends in this form is renamed when an edit changes them (`renamed:` in the
result); an older flow id (`Flow_AToB`) stays as it is.

Names become ASCII words (`Prüfung buchen` gives `userTask_pruefungBuchen`), at most 40 characters
of them: a longer name loses its last words, and a single longer word is cut at 40. An id has at
most 64 characters, a collision suffix included. An id within that is not cut again. A longer one
loses whole words: of the cuts that fit, the one with the most words is taken, then the longest.
A word is cut inside only when no whole word is left to give up.
Also, a number a cut would leave at the end of the id goes too where it would read
like a collision suffix. A taken id gets `2`, `3` (`_2` under snake_case, `-2` under kebab-case)
and a `W_ID_SUFFIXED` warning.

`bpmn show <file> --conventions` lists what applies. Existing ids never change for the rule.
How to get ids that match: [bpmnlint](bpmnlint.md#id-conventions).

## Kinds

`bpmn add` and `bpmn retype` take the canonical name (`userTask`), an alias (`user`) or the moddle
type (`bpmn:UserTask`). Events take a trigger suffix (`startEvent:message`, `boundary:timer`).

| family | kinds (aliases) | id prefix |
| --- | --- | --- |
| tasks | `task`, `userTask` (`user`), `serviceTask` (`service`), `scriptTask`, `sendTask`, `receiveTask`, `manualTask`, `businessRuleTask` (`rule`) | the kind: `task_`, `userTask_`, ... |
| sub-processes | `subProcess` (`sub`), `eventSubProcess` (`eventSub`; needs a start event inside: create it as `eventSubProcess:<trigger>`, or add both in one `bpmn apply`), `adHocSubProcess`, `transaction` | `subProcess_` |
| call activity | `callActivity` (`call`) | `callActivity_` |
| gateways | `exclusiveGateway` (`xor`), `parallelGateway` (`and`), `inclusiveGateway` (`or`), `complexGateway` (`complex`), `eventBasedGateway` | `gateway_` |
| events | `startEvent` (`start`), `endEvent` (`end`), `intermediateCatchEvent` (`catch`), `intermediateThrowEvent` (`throw`), `boundaryEvent` (`boundary`, `--on <hostId>`) | `startEvent_`, `endEvent_`, else `event_` |
| pools and lanes | `participant` (`pool`; the first wraps the process, `--black-box` for one without), `lane` | `participant_`, `lane_` |
| data | `dataObject` (`data`), `dataStore` (`store`) | `dataObject_`, `dataStore_` |
| artifacts | `textAnnotation` (`note`), `group` (`--members <id,...>`) | `textAnnotation_`, `group_` |

Choreographies are rejected (`E_UNSUPPORTED_KIND`). No Camunda 7 / 8 engine runs a
`complexGateway`: the Camunda profiles report it (`W_C7_DEPLOY_COMPLEX_GATEWAY`,
`W_C8_DEPLOY_UNSUPPORTED`); use `exclusiveGateway` or `inclusiveGateway` there.

## Triggers

The trigger is the kind's suffix, its details an option: `bpmn add order.bpmn boundary:timer
"Late" --on task_archive --timer P2D`. Messages, errors and signals are found by name and
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
$ bpmn add order.bpmn end "Done" --after userTask_checkInvoice
created endEvent endEvent_done "Done" - after userTask_checkInvoice
created sequenceFlow flow_checkInvoiceToDone - userTask_checkInvoice -> endEvent_done
note: appended after userTask_checkInvoice
resolved: W_NO_END orderHandling, W_DEAD_END userTask_checkInvoice
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn
```

`--json` prints the same as one line (shortened):

```json
{
  "ok": true,
  "file": "order.bpmn",
  "written": true,
  "unchanged": false,
  "created": [{ "id": "endEvent_done", "kind": "endEvent", "name": "Done" }],
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
| `BPMN_LAYOUT_DEBUG` | layout diagnostics on stderr |
| `BPMN_DEBUG` | the stack trace of an internal error |

## Quoting

::: warning Expressions in single quotes
Write `--condition '${amount > 100}'`. In double quotes the shell expands `${...}` to nothing.
:::

Names with spaces need quotes (`"Check invoice"`), and so does a whole pair (`name="Check it"`).
In ops JSON nothing is expanded.
