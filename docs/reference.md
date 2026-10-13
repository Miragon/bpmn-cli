# Reference

The CLI prints this reference itself, generated from the code and checked by its tests. This page
has the rules and the tables; each section names the command that prints the full list.

## Ids

Elements are addressed by id, never by name (names may repeat). A new id says what it names and
follows the file it is written into: prefix, case and flow form are learned from the ids the file
has (a rule needs two ids that follow it). A file without a convention gets the defaults below.
Where the project's `.bpmnlintrc` runs `@miragon/rules/element-id-naming`, its prefixes and case
decide instead (see below). Explicit ids (`--id`, `"id"` in ops JSON) are taken as given.

| element | id | examples |
| --- | --- | --- |
| named | prefix + the name | `Activity_CheckInvoice`, `Gateway_InvoiceOk` |
| unnamed | prefix + kind word and place (`After`, `Before`, `On`, `In`) | `Gateway_AfterArchive`, `Event_TimerOnArchive` |
| sequence / message flow | its two ends | `Flow_CheckInvoiceToBookInvoice` |
| join of a split | the split gateway's id + `_join` (camelCase: `Join`) | `Gateway_InvoiceOk_join` |
| data object / store | reference and backing element, each with its own prefix | `DataObjectReference_Invoice` + `DataObject_Invoice` |
| diagram (DI) | the form of the file's DI ids | `<id>_di`, `BPMNShape_<id>` |

- In a file with other conventions the same elements become `serviceTask_checkStock`,
  `Task_check_stock` or a bare `reviewOrder`. Hashes and running numbers are never copied.
- Names become ASCII words (`Prüfung buchen` gives `Activity_PruefungBuchen`), at most 40 characters
  of them: a longer name loses its last words, and a single longer word is cut at 40. An id has at
  most 64 characters, a collision suffix included. An id within that is not cut again. A longer one
  loses whole words: a flow's two ends give up their last words, and of the cuts that fit, the one
  with the most words is taken, then the longest. An end keeps its first word (its last where the
  ends begin alike), its last word with a letter before the Join or number it ends with, and that
  Join or number; a number a cut would leave at the end of the id goes too where it would read
  like a collision suffix (`_4`). A flow named by its ends' ids keeps each id's prefix, unless
  the prefixes leave fewer than 16 characters (then the whole ids share the room).
  A word is cut inside only when no whole word is left to give up, and then in the longer end,
  which keeps its Join or number (in both ends where the longer would keep fewer than 8
  characters). A file prefix too long to leave room gives way to the bpmn-cli prefix (for a flow,
  in every flow form: `Flow_` and the flow's ends). A taken id gets `_2`, `_3` and a
  `W_ID_SUFFIXED` warning.
- A flow whose id names its ends is renamed when an edit changes them, and the result says so
  (`renamed:`): the id the file's flow form gives it, and in a file of another form also
  `Flow_<Source>To<Target>`, which earlier versions gave flows there, whoever wrote it. An end
  counts by its name too, also where its id speaks (after `set Activity_Check id=Activity_Verify`,
  `Flow_CheckToOk` still names Verify, which is named Check), and in a batch by the id and name it
  had before a `set id=` or `set name=` earlier in the batch. A flow without id (valid BPMN) whose
  ends change gets an id from its new ends, or the `--flow-id` of the `add` that splices into it
  (`(id added: it had none)`). In a batch, use aliases instead of guessing ids:
  [Ops JSON](ops.md#ops-json-bpmn-apply).
  With `--keep-flow-ids` (or `BPMN_KEEP_FLOW_IDS=1`) a flow the file had keeps its id instead, and
  `W_FLOW_ID_STALE` names it with the id its new ends give, or the `--flow-id` a splice into it
  was given ([Limitations](contract.md#limitations)).
- An unknown id (`E_NOT_FOUND`) comes with the ids that were probably meant, best first.
- Every rule and form: `bpmn kinds --section ids`.

### Declared conventions

A `.bpmnlintrc` that runs `@miragon/rules/element-id-naming` (the `recommended-for-automation`
config turns it on) declares a prefix per BPMN type, the case of the rest and whether an event
names its trigger. bpmn-cli reads it as the rule does, and the ids it generates pass the rule.
`bpmn show <file> --conventions` lists what applies, also for a file that does not exist yet.

| element | id |
| --- | --- |
| a type the rule names | its prefix + the body in the rule's case: `serviceTask_checkInvoice`, `gateway_approved` |
| an event with a trigger | `eventDefinitionQualifier: "required"`: `timerStartEvent_monthly`; otherwise `startEvent_monthly` |
| unnamed, or a number first | the kind word without what the prefix says: `endEvent_terminateAfterPaid`, `startEvent_timer1stOfMonth`; the whole word where the body would else be empty or begin with a number: `scriptTask_scriptTask`, `scriptTask_scriptTask4AugenPrinzip` |
| sequence flow | the rule's prefix + its two ends: `flow_checkInvoiceToBookInvoice` |
| message flow | an exact `bpmn:MessageFlow` prefix, else like the file's own message flows (two that agree), else like sequence flows |
| a taken id, a join | glued under camelCase / PascalCase: `serviceTask_checkInvoice2`, `gateway_approvedJoin`; the join after an explicit split id the rule rejects: its prefix + the gateway, `gateway_checkJoin` |
| what the rule does not name | the file's style (without the ids that already follow the rule); in a file without it, the rule's case and prefix shape: `lane_sales` |
| process, definitions | bpmn-cli's (`Process_InvoiceHandling`, also the process of a new pool), unless the rule names `bpmn:Process` / `bpmn:Definitions` (`process_main` without a name) |

- Existing ids are never renamed because of the rule. A `retype` or a trigger change that leaves a
  prefix the rule rejects gives `W_ID_PREFIX_STALE` with the `bpmn set <file> <id> id=<newId>` that
  renames it; an element the same `apply` batch created takes the new prefix instead, and the flows
  the batch named after it follow.
- A result names the new ids under a prefix the rule declares that differ from what the file's own
  style would give (`conventions:`; JSON: `conventions.ids`).
- A value the rule names that cannot start an id, or an unknown `case` or qualifier, is
  `W_CONFIG_IGNORED`; that type follows the learned style. `--no-lint-config` leaves the
  conventions out. Details: [bpmnlint](bpmnlint.md#id-conventions).

## Kinds

`bpmn add` and `bpmn retype` take a kind token: the canonical name (`userTask`), an alias (`user`) or
the moddle type (`bpmn:UserTask`, `UserTask`). Case does not matter. Events take a trigger suffix
(`startEvent:message`, `boundary:timer`).

| family | kinds (aliases) | id prefix |
| --- | --- | --- |
| tasks | `task`, `userTask` (`user`), `serviceTask` (`service`), `scriptTask` (`script`), `sendTask` (`send`), `receiveTask` (`receive`), `manualTask` (`manual`), `businessRuleTask` (`rule`, `businessRule`, `decision`) | `Activity_` |
| sub-processes | `subProcess` (`sub`; expanded, `--collapsed` to collapse), `eventSubProcess` (`eventSub`; needs a start event inside: create it as `eventSubProcess:<trigger>`, or add both in one `bpmn apply`), `adHocSubProcess` (`adhoc`), `transaction` | `Activity_` |
| call activity | `callActivity` (`call`; `set calledElement=<processId>`) | `Activity_` |
| gateways | `exclusiveGateway` (`xor`, `exclusive`), `parallelGateway` (`and`, `parallel`), `inclusiveGateway` (`or`, `inclusive`), `eventBasedGateway` (`eventBased`, `event-based`, `eventGateway`) | `Gateway_` |
| events | `startEvent` (`start`), `endEvent` (`end`), `intermediateCatchEvent` (`catch`, `icatch`, `catchEvent`), `intermediateThrowEvent` (`throw`, `ithrow`, `throwEvent`), `boundaryEvent` (`boundary`; `--on <hostId>`, trigger required) | `Event_` |
| pools and lanes | `participant` (`pool`; the first wraps the existing process, further ones get a new process, `--black-box`: none), `lane` (`--in <processId>`) | `Participant_`, `Lane_` |
| data | `dataObject` (`data`, `dataObjectReference`), `dataStore` (`store`, `dataStoreReference`) | `DataObjectReference_`, `DataStoreReference_` |
| artifacts | `textAnnotation` (`note`, `annotation`, `text`; `connect` it to draw an association) | `TextAnnotation_` |

`complexGateway`, choreographies and groups are rejected (`E_UNSUPPORTED_KIND`). One line per kind,
with its description and the triggers an event kind allows: `bpmn kinds --section kinds`.

## Triggers

An event's trigger is the suffix of its kind; its details come from an option, as in `bpmn add
order.bpmn boundary:timer "Late" --on Activity_Archive --timer P2D`. Root elements (`bpmn:Message`,
`bpmn:Error`, `bpmn:Signal`, `bpmn:Escalation`) are found by name and created when missing. In ops
JSON the keys are the option names in lowerCamelCase (`timerKind`, `errorCode`).

| trigger | option | notes |
| --- | --- | --- |
| `none` | | plain event; the default for start / end / throw events |
| `message` | `--message <name>` | also on `sendTask` / `receiveTask` |
| `timer` | `--timer <iso>` `[--timer-kind cycle\|duration\|date]` | `R/PT1H` cycle, `P2D` duration, `2026-01-31T09:00:00Z` date (classified automatically) |
| `error` | `--error <name>` `[--error-code <code>]` | |
| `signal` | `--signal <name>` | |
| `escalation` | `--escalation <name>` `[--escalation-code <code>]` | |
| `conditional` | `--when <expr>` | condition expression |
| `link` | `--link <name>` | a throwing and a catching link event pair up by name |
| `compensate`, `terminate`, `cancel` | | no option; `terminate` on end events only, `cancel` on an end event inside a transaction or a boundary event on one |

`--non-interrupting` applies to boundary events and to start events of an event sub-process, not to
error / cancel / compensate boundary events. Change a trigger later with `set <id> trigger=timer
timer=PT1H` or `retype <id> boundaryEvent:message --message X`; `retype` keeps the current trigger
unless you write `<kind>:none`. Changing only the details keeps the event definition with its id and
vendor content; another trigger kind replaces it (`W_PROPERTY_DROPPED` reports what was lost). Which
trigger fits which event kind: `bpmn guide triggers`.

## Placement grammar

`add` and `move` place a flow node with exactly one of these (`--after` + `--before` counts as one).
Without a placement the node goes into the only process, unconnected (several processes:
`E_AMBIGUOUS_SCOPE`, use `--in`).

| option | ops key | rule |
| --- | --- | --- |
| `--after <X>` | `after` | X is a gateway or has no outgoing flow: append. X has one outgoing flow: splice in, `X -> node -> old successor`. Several: `E_HAS_SUCCESSOR`. |
| `--before <Y>` | `before` | The mirror image: prepend, or splice into the single incoming flow; several: `E_HAS_PREDECESSOR`. |
| `--after <X> --before <Y>` | `after` + `before` | Splice into the flow `X -> Y`. |
| `--flow <F>` | `flow` | Splice into sequence flow F, which keeps its name and condition and now ends at the node. |
| `--in <S>` | `in` | Put the node into process / sub-process / participant S, unconnected. |
| `--on <A>` | `on` | Boundary events only: attach to activity A. |
| `--to <T>` | `to` | Additionally connect `node -> T` (a branch that re-joins the main path). |

- `--flow-name`, `--flow-id`, `--condition`, `--language` and `--default` describe the flow into the
  new node, so they need `--after`, `--before` or `--flow`. On a splice the flow into the node is
  the existing one: `--flow-id` is ignored (`W_OPTION_IGNORED`, whose hint renames it; with
  `--keep-flow-ids`, where `W_FLOW_ID_STALE` reports that flow, that warning suggests the
  `--flow-id` instead, one command for one flow). A flow without id takes the `--flow-id`.
- `move` chains several ids: the first takes the placement, each next one goes after the one before.
  The node the chain starts after (`--after`, the source of `--flow`) must lie outside the chain,
  boundary events of its nodes included (`E_INVALID_PLACEMENT`). Nodes already where the placement
  puts them stay, and a note says so ([`move`](commands.md#move-and-order)).
- Data objects, data stores, text annotations, lanes and pools take `--in` only; wire them with
  `connect`. Sequence flows never cross scopes (`E_CROSS_SCOPE`): use a message flow between pools.
- Branch order in the diagram: the default flow (else the first outgoing flow that leads to an end
  event, else the first one) continues straight; the other branches are drawn alternately below and
  above it in declaration order (all below when a default flow exists). `bpmn order` changes the
  declaration order, `set <flowId> default=true` picks the continuation.
- The same table from the CLI: `bpmn guide placement`.

## Set keys

`bpmn set <file> <id> key=value ...` sets properties; the same pairs work on `add` and in the `set`
map of an `add` op. `key=` or `--unset key` removes a property. An unknown key fails with
`E_UNKNOWN_KEY` and lists the keys the element accepts.

| applies to | keys |
| --- | --- |
| any element | `id` (rename; every reference follows), `name`, `doc`, any attribute of the BPMN type by name (`isExecutable`, `calledElement`, `scriptFormat`, ...), vendor attributes with a prefix (`camunda:assignee`) |
| sequence flows | `condition`, `language`, `default` (`true`/`false`), `source`, `target` (redirect) |
| events | `trigger`, `timer`, `message`, `error`, `errorCode`, `signal`, `escalation`, `escalationCode`, `when`, `link`, `nonInterrupting` |
| activities | `loop` (`none`/`standard`/`parallel`/`sequential`), `cardinality`, `completion` |
| sub-processes | `expanded` (`true`/`false`), `triggeredByEvent` |
| flow nodes | `lane` (lane id; empty removes the membership), `default` (id of the default outgoing flow; empty clears it) |
| text annotations | `text` |
| send / receive tasks | `message` (name of the root `bpmn:Message`, created when missing) |
| business rule tasks | `calledDecision` (the decision link, in the file's spelling; see below) |
| nested elements | `definition.<key>` (event definition), `loop.<key>` (loop characteristics), `condition.<key>` (condition expression) |

A nested key addresses an element without an id of its own, as in `bpmn set order.bpmn
Activity_Archive 'loop.camunda:collection=${items}'`. An event with several event definitions needs
a selector: `'definition[1].<key>'` or `'definition[timer].<key>'`. A `camunda:` attribute on the
wrong element is refused with `E_WRONG_HOST`, and the hint names the right key. Camunda 8 settings
are extension elements, not set keys ([Camunda](camunda.md)). All keys per element family and nested
type: `bpmn kinds --section setKeys,nestedKeys`.

`calledDecision=<decision>` links a business rule task to a DMN decision. BPMN 2.0 has no attribute
for the link, so it is written in the file's spelling, and the other spellings on the task are
removed:

- Camunda 7: `camunda:decisionRef` (`operaton:decisionRef` in an Operaton-only file).
- Camunda 8: a `zeebe:calledDecision` extension element with the decision as `decisionId`; a
  `resultVariable` it has stays.
- No engine detected: bpmn-cli writes its own spelling, an unprefixed
  `calledDecision="<decision>"`. No engine reads the file, so there is no vendor namespace to write
  the link in. Such a file has no link in an engine spelling: one would make it a Camunda 7 / 8
  file. bpmn-moddle reports the attribute as unknown and the engines refuse it, so in a Camunda 7 /
  8 file `bpmn set <file> <id> calledDecision=<decision>` converts it to the engine's spelling.
- `platform: 'none'` in the library (the CLI has no such option for `set`): a task whose link has
  an engine spelling keeps it (a `zeebe:calledDecision` keeps its `resultVariable`). A task without
  a link (a `zeebe:calledDecision` without `decisionId` is none) takes the engine spelling of the
  file's other links when they all have the same one. Otherwise it is the unprefixed
  `calledDecision`.

The change line names the spelling written (`calledDecision=risk (camunda:decisionRef)`), and an
empty value removes the link in every spelling. `show` and `find` read every spelling, also a
hand-written unprefixed `calledElement`, which a write replaces.

## Output, errors and exit codes

A mutating command prints one line per created, changed or removed element, then notes, the warnings
the change added, `resolved:` for the findings it fixed, a count of the warnings the file already
had (`bpmn validate <file>` lists those), the layout block and the file line:

```
$ bpmn add order.bpmn end "Done" --after Activity_CheckInvoice
created endEvent Event_Done "Done" - after Activity_CheckInvoice
created sequenceFlow Flow_CheckInvoiceToDone - Activity_CheckInvoice -> Event_Done
note: appended after Activity_CheckInvoice
resolved: W_NO_END Process_OrderHandling, W_DEAD_END Activity_CheckInvoice
layout: ok - full (engine-owned diagram: redrawn)
layout quality: score 0 -> 0
written: order.bpmn
```

The file line reads `dry run: <file> not written` with `--dry-run` and `unchanged: <file>` when the
result equals the file. `--show` appends the model view. `--summary` prints ids only (`created
userTask: Activity_Archive`, `changed:`, `renamed: <old> -> <new>`, `removed:`) and one layout line.
`--json` prints one compact line on stdout (`--pretty` indents it; shortened here):

```json
{
  "ok": true, "file": "order.bpmn", "written": true, "unchanged": false,
  "created": [{ "id": "Activity_Archive", "kind": "userTask", "name": "Archive", "detail": "after Activity_CheckInvoice" }],
  "changed": [{ "id": "Flow_CheckInvoiceToArchive", "kind": "sequenceFlow", "detail": "..." }],
  "removed": [], "notes": ["inserted between Activity_CheckInvoice and Event_Done"],
  "warnings": { "added": [], "resolved": [], "preexistingCount": 0 },
  "renamed": { "Flow_CheckInvoiceToDone": "Flow_CheckInvoiceToArchive" },
  "layout": { "status": "ok", "mode": "full", "reason": "engine-owned diagram: redrawn", "warnings": [], "expanded": [],
              "metrics": { "before": { "counts": {}, "score": 0 }, "after": { "counts": {}, "score": 0 }, "added": [], "resolved": [] } },
  "validation": { "errors": [], "platform": { "...": "findings of the engine profile" } },
  "importWarnings": []
}
```

- Warnings are `{code, message, element, hint}`. `written` is `false` with `--dry-run` and when
  `unchanged` is `true`. `importWarnings` lists what the parser reported while reading the input.
- Present only when they apply: `aliases` (batch alias -> final id), `renamed` (old id -> new id),
  `view` (`--show`), `validation.validators` (the project's bpmnlint; in library use also a host's
  validators, see [Validators](validators.md)), `conventions` (`{ids, source?}`: the new ids that
  follow the `.bpmnlintrc`'s `element-id-naming` rather than the file's own id style; see
  [Declared conventions](#declared-conventions)). An incremental layout adds `placed`, `moved`,
  `rerouted`, `pruned`, `notes` and `format` to `layout`.
- A validator's findings carry `validator` and `severity`. The project's bpmnlint
  ([bpmnlint](bpmnlint.md)) is advisory (`blocks: false` in its `validation.validators` entry): an
  error it finds in the change is among `warnings.added` with `"severity": "error"` and reads
  `warning [bpmnlint error] <rule> <id>: ...` in text (`validate`: `[bpmnlint error] <rule> <id>:
  ...`); its line says how many findings the change added and resolved and how many the file
  already had.
- `--summary --json`: `{ok, file, written, unchanged, created: {<kind>: [ids]}, changed, renamed?,
  removed, aliases?, forced?, warnings: {added, resolvedCount, preexistingCount}, layout: {status,
  mode, score}, format?, conventions?}`; `preexistingCount` includes the project's bpmnlint findings
  the file already had.
- Errors go to stderr as `error E_CODE: message` with a hint and candidate ids; with `--json` as
  `{"ok": false, "error": {"code", "message", "element?", "candidates?", "hint?", "op?", "command?", "ops?", "errors?"}}`
  (`command` / `ops`: the checked space-tool run of an `E_NO_ROOM` that makes the room; `errors`:
  the errors an `E_VALIDATION` refusal names, in text the lines under the error, each with its code
  and hint. Nothing was written, so `bpmn validate <file>` does not show them).

| exit | meaning |
| --- | --- |
| 0 | ok (warnings allowed) |
| 1 | usage error: unknown command / option / kind, bad ops JSON, a `BPMN_KEEP_FLOW_IDS` that is no switch value (`E_USAGE`) |
| 2 | model or validation error (`E_NOT_FOUND`, `E_CROSS_SCOPE`, `E_VALIDATION`, ...); `validate`: also an error of the project's bpmnlint |
| 3 | layout error (`E_LAYOUT_*`) |
| 4 | I/O or parse error (`E_FILE_NOT_FOUND`, `E_PARSE`, `E_IMPORT_LOSSY`, `E_FILE_EXISTS`, `E_RENDER`, `E_LINT_CONFIG`) |
| 5 | `--strict` and the result has warnings, also ones the file already had (`validate`: also import warnings); a write leaves out the project's bpmnlint findings the file already had, which only its validator line counts |
| 70 | internal error (`E_INTERNAL`; `BPMN_DEBUG=1` prints the stack) |

The result format: `bpmn guide output`. Every code with its fix: `bpmn kinds --section errors`.

### stdin and stdout

`-` as the file reads the model from stdin: `show -`, `find - <text>`, `validate -`, `metrics -`,
`render -`, `ext list - <id>`. A mutating command on `-` writes the result to stdout unless
`-o <file>` names a file, and `-o -` sends the result of any mutating command (or the image of
`render`) to stdout and leaves the input file as it was. With the XML on stdout the report goes to
stderr and says `written: -`. stdin holds one input, so `apply - -` is `E_USAGE`: write `bpmn apply -
ops.json < model.bpmn > new.bpmn`. A model from stdin has no file name: its `.bpmnlintrc` is looked
up from the working directory, or from the file `-o` names.

### Environment

The CLI reads three variables; the library reads none (its options do the same).

| variable | effect |
| --- | --- |
| `BPMN_KEEP_FLOW_IDS` | `1`, `true`, `yes`, `on` (any case): every mutating command keeps flow ids, as with `--keep-flow-ids`. `0`, `false`, `no`, `off`, empty or unset: a flow whose id names its ends follows them. Any other value fails a mutating command with `E_USAGE`; `show`, `validate` and the other read commands ignore it. `--keep-flow-ids` / `--no-keep-flow-ids` win over it. |
| `BPMN_LAYOUT_DEBUG` | any value: the layout engines' diagnostic lines on stderr (library: `debug`) |
| `BPMN_DEBUG` | any value: the stack trace of an `E_INTERNAL` |

## Quoting

- Expressions and anything containing `$`: single quotes, e.g. `--condition '${amount > 100}'`. In
  double quotes the shell expands `${...}` to nothing: `--condition` then fails with
  `E_INVALID_VALUE`, and `set <flowId> condition="${ok}"` removes the condition.
- Names with spaces: quote them, `add userTask "Check invoice"`.
- `key=value` with spaces: quote the whole pair, `name="Check the invoice"`.
- In JSON nothing is expanded, so ops files are the safest place for expressions.
- The same list from the CLI: `bpmn guide quoting`.
