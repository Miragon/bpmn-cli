# Commands and flags

Which commands and flags exist today and after the refactoring, and why does each item go or stay? The CLI is a
projection of the library: a command is a call or an operation, its flags the call's options or the operation's keys.

## Today

28 commands with 443 flag slots, 46 on `add` alone, and 198 KB of help in TypeScript strings.

```text
bpmn <command> <file> … [flags]

read and check  show <file> [id]   find <file> <text>   ext list <file> <id>   metrics <file>
                validate <file>
edit            new <file>   add <file> <kind> [name] [key=value…]   connect <file> <sourceId> <targetId>
                set <file> <id> [key=value…]   remove|rm <file> <ids…>   retype|replace <file> <id> <kind>
                move <file> <ids…>   order <file> <id> <ids…>   apply <file> [operations]
                ext add <file> <id> <type> [attrs…]   ext remove <file> <id> <selector>
draw            layout <file>   tidy <file> [ids…]   compact <file> [ids…]   place <file> [ids…]
                align <file> [ids…]   color|colour <file> [ids…]   label <file> <id>
                route <file> <flowId>   space <file>
image           render <file> [ids…]
help            kinds   guide [topic]
```

| commands | shared flags | own flags |
| --- | --- | --- |
| 10 model writes: `add connect set remove retype move order ext add ext remove apply` | 15: `--json --pretty --summary -o --dry-run --render --layout --relayout --no-layout --lint-config --no-lint-config --force --backup --show --strict` | add 31, retype 11, connect 7, move 6, remove 4, ext add 3, set 1 |
| 8 drawing writes: `tidy compact place align color label route space` | the same 15 | place 11, align 6, color 5, tidy 4, space 3, route 2, label 1 |
| `layout` | 12 of the 15 | `--expand --collapse --tidy` |
| `new` | the 15 | `--name --id --no-executable --target` |
| `show` | `--json --pretty` | `--scope --around --depth --inner --context --layout --conventions --lint-config --no-lint-config` |
| `find`, `ext list`, `metrics` | `--json --pretty` | find `--kind` |
| `validate` | `--json --pretty` | `--strict --platform --lint-config --no-lint-config` |
| `render` | `--json --pretty` | 14: `-o --format --plane --around --depth --inner --path --via --scope --highlight --problems --tiles --max-size --scale` |
| `kinds`, `guide` | kinds `--json --pretty` | kinds `--section`; guide `--short` |

## Target

26 commands with 143 flag slots and 17 operations. Each command, with what it does and why it stays or goes, is
[below](#commands); each flag is on the [flags page](flags.md), which also shows when an input is a flag
and when a `key=value`.

```text
bpmn <command> <file> … [flags]

read and check  show <file> [id]   find <file> [text]   diagram <file>   conventions <file>
                validate <file>
edit            new <file> [name]   add <file> <kind> [name] [key=value…]
                connect <file> <sourceId> <targetId> [key=value…]   set <file> <id> [key=value…]
                remove <file> <ids…>   retype <file> <id> <kind> [key=value…]   move <file> <ids…>
                order <file> <id> <ids…>   apply <file> [operations]
                ext add <file> <id> [type] [key=value…]   ext remove <file> <id> <selector>
draw            layout <file>   tidy <file> [ids…]   compact <file> [ids…]   place <file> [ids…]
                color <file> [ids…]   label <file> <id>   route <file> <flowId>   space <file>
image           render <file> [ids…]
help            guide [topics…]
```

| commands | shared flags | own flags |
| --- | --- | --- |
| 10 model writes: `add connect set remove retype move order ext add ext remove apply` | 4: `-o --dry-run --force --json` | operation keys: add 17, move 6, remove 3, connect 2, ext add 2; what the element holds is a `key=value` |
| 8 drawing writes: `layout tidy compact place color label route space` | the same | operation keys: place 9, color 3, space 3, route 2, label 1 |
| `new` | `--force --json` | `--id --target`; the name is `[name]` |
| `show` | `--json` | `--in --around --depth` |
| `find` | `--json` | `--kind --in` |
| `diagram`, `conventions` | `--json` | none |
| `validate` | `--json` | `--strict --lint-config --no-lint-config` |
| `render` | `--json` | `-o --around --depth --path --problems` |
| `guide` | none | none |

How a command is defined:

- Each operation is defined once, as an `OperationDefinition` in the module `operations`: its fields with type, help and rules.
  `OPS_SCHEMA`, the JSON Schema of all operations, is written from these definitions.
- The 17 edit commands have no class of their own: one class, `EditCommand`, serves them all, and
  `CommandSyntax` gives it each command's positionals, flags and help, read from `OPS_SCHEMA`. Each operation
  but `split` is one command, and `ext` is two (`ext add`, `ext remove`); `split` takes nested
  branches, so only `apply` takes it. A flag is its field in kebab case; batch-only fields such as `as`, marked
  `x-batch-only` in `OPS_SCHEMA` ([not flags](flags.md#not-flags)), make none. Four inputs need code of their own in `CommandSyntax`:
  `add`'s `[name]`, `ext add`'s `body=`, `ext remove`'s `<selector>` and `place --side`. The code is on
  [layers by example](layers.md#cli-words-in-text-out).
- `key=value` fills the operation's `set`, read by the one property catalogue, on `add`, `retype`, `connect`
  and `set` alike; on `ext add` it fills the extension element's attributes
  ([flag or key](flags.md#flag-or-keyvalue)).
- The nine commands that are not an operation keep a class each: `NewCommand`, `ShowCommand`, `FindCommand`,
  `DiagramCommand`, `ConventionsCommand`, `ValidateCommand`, `ApplyCommand`, `RenderCommand`,
  `GuideCommand`. A parity test pins every flag to a field; a new operation flag touches its definition and tests, not ≈ 12 places.
- A read command's flag maps to a field of its options, such as `--depth` to `ShowOptions.depth`. Its
  default and the check of its value live only in the module that answers; the result carries the value
  it used, so cli prints the depth it got, not a default of its own (today `RenderReport.ts:61` imports
  `AROUND_DEFAULT_DEPTH`).
- The text result is at most 1 KB. Every write, model or drawing, ends with the layout score before and
  after, as today, and the state: `layout quality: score 4 -> 9; added: crossings flow_7 x flow_9` and
  `state: 0 errors, 4 warnings (bpmn validate lists them and runs the project's lint)` ([layout score](modules.md#layout-score)).
- A retired command, alias, flag or operation key answers `E_USAGE`, as any unknown input does:
  commander names the unknown command or option, `OperationParser` the unknown key and the keys the
  operation takes. No table keeps retired inputs or their replacements; the skill and the commits'
  `BREAKING CHANGE:` footers say what to use instead.
- `guide` without a topic prints the core, today's `--short`. Its topics are today's 17, from `contract`
  to `commands`, and the tables `kinds --section` prints today: `kinds`, `set-keys`, `nested-keys`,
  `zeebe-elements`, `ids`, `colors`, `exit-codes`. `guide ops` lists every operation with its fields,
  in place of `kinds --section ops --json`; programs read `OPS_SCHEMA`.
- `guide`'s tables of kinds, triggers, set keys, nested keys, Zeebe elements and codes are written from
  the catalogues into `src/cli/help/` by `npm run build`; a test fails when the committed Markdown differs.

## Commands

An operation is a command at no cost: `EditCommand` runs it from the operation's definition. A command goes only when
another one does the same. Uses count `bpmn <command>` calls and operations of that name in batches, from the
sources of the [flags page](flags.md).

Two ways to work stay: one command per change, or `apply` with a list of operations that builds a whole model
in one transaction; names such as `$check` link its operations, and `split` exists only there.

### Read, check and start

Each read answers one question, and its flags only narrow the answer, never change its shape: `show`
describes, `find` lists ids, `diagram` judges the drawing. They use the words of the edit commands
(`--in` as on `add` and `move`), every line names the kind and the id, and a cut says what it left out
and how to zoom in ([reads](#how-the-reads-answer)).

| command | does | worth | uses | after |
| --- | --- | --- | --- | --- |
| `show` | the model, a part of it, or one element with everything needed to change it | the one read for agents and design-iq | skill 22 · docs 14 · diq 4 · ask 1 · b2c 7 | keep; `show <id>` takes over `--context` and `ext list` |
| `find` | one line per element that matches a text, a kind or a container, id first | ids fast in a big model, ids to pipe into `color` or `place` | skill 3 · docs 1 · diq 3 · b2c 1 | keep; the text becomes optional, `--in` joins |
| `ext list` | the extensions of an element | `show <id>` prints them numbered, as `ext remove` takes them | skill 4 · docs 1 | goes: `show <id>` |
| `diagram` | the drawing: the layout score on line 1, the counts per kind, every problem with its ids, then the rows and columns | one read for how the model is drawn and how well | as `show --layout`: skill 6 · docs 1 | new, takes over `metrics` and `show --layout` |
| `metrics` | the layout score, the counts per kind and every problem | `diagram` prints the same, first | skill 4 · evals 4 · docs 2 | goes: `diagram` |
| `conventions` | the id patterns new ids follow here, from the nearest `.bpmnlintrc` | agents pick ids that fit the project; a question about the project, not the model | as `show --conventions`: skill 3 · docs 4 | new, takes over `show --conventions` |
| `validate` | structure checks, Camunda checks and project lint | the gate of graders and CI | skill 16 · evals 2 · docs 19 · diq 2 | keep, with its layout dry run; the problems at the end of today's `show` move here |
| `new` | a new file | on `add`, a missing file would need a target, a process name and an id | skill 7 · evals 1 · docs 20 · diq 1 | keep |

### Edit

| command | does | worth | uses | after |
| --- | --- | --- | --- | --- |
| `add` | creates an element and wires it in | the main write | skill 55 · docs 93 · diq 21 | keep |
| `connect` | a sequence or message flow | the flows a placement does not make | skill 9 · docs 8 · diq 4 | keep |
| `set` | changes what an element holds | every key of the one catalogue | skill 11 · docs 18 · diq 7 | keep |
| `remove` | deletes and bridges the gap | the only delete | skill 3 · diq 5 | keep, alias `rm` goes |
| `retype` | changes the kind in place, keeps id and flows | a remedy in hints | skill 3 · docs 2 · diq 2 | keep, alias `replace` goes |
| `move` | moves nodes to a new place or lane | design-iq moves nodes between lanes; a remedy in hints | skill 3 · docs 1 · diq 4 | keep |
| `order` | the order of outgoing flows or of lanes | a remedy in hints | skill 5 · docs 6 | keep |
| `apply` | many operations in one transaction | builds a whole model in one write | skill 16 · docs 23 · diq 3 | keep |
| `ext add` | adds an extension element | what a `key=value` cannot hold, such as `zeebe:taskDefinition` | skill 20 · docs 27 · diq 1 | keep |
| `ext remove` | removes an extension element | the way back from `ext add` | skill 2 · docs 1 | keep |

### Draw

| command | does | worth | uses | after |
| --- | --- | --- | --- | --- |
| `layout` | redraws in full | the escape when the incremental layout cannot place a change | skill 2 · docs 3 · diq 3 | keep |
| `tidy` | removes overlaps and small gaps, keeps the drawing | design-iq calls it | skill 1 · diq 1 | keep |
| `compact` | closes empty rows and columns, shrinks pools and lanes | the skill uses it | skill 2 | keep |
| `place` | moves shapes into a row or a column | straightens a path | skill 5 · docs 3 | keep |
| `align` | lines shapes up | `place` gives the same result | skill 1 | goes: one `place` per id |
| `color` | colours shapes | marks the happy path | skill 6 · diq 1 | keep, alias `colour` goes |
| `label` | puts a label on a side | a remedy in hints | skill 2 | keep |
| `route` | routes a flow again, by its sides | a remedy in hints | skill 2 | keep |
| `space` | makes room right of or below an element | inserting into a full drawing | skill 6 · docs 1 | keep |

### Image and help

| command | does | worth | uses | after |
| --- | --- | --- | --- | --- |
| `render` | an image without a browser | agents look at what they built | skill 8 · evals 3 · docs 16 | keep |
| `kinds` | the tables of element kinds | help; programs call `kindsJson()` | skill 8 · docs 9 · diq 2 | goes: `guide <topic>` |
| `guide` | the help | learn the CLI | skill 9 · evals 3 · docs 17 | keep, takes topics |

## How the reads answer

```text
bpmn show <file> [id] [--in <id>] [--around <id> [--depth <n>]]
bpmn show claims.bpmn Activity_CheckPolicy

serviceTask Activity_CheckPolicy "Check policy"
in: Process_Claims > Activity_Assess · lane Lane_Office
from: Event_AssessStart (Flow_ToCheck)   to: Activity_RateDamage (Flow_ToRate)
caught by: Event_FraudSuspected (error FRAUD) -> Activity_Investigate
attrs: camunda:type=external camunda:topic=check-policy
ext 0: camunda:inputOutput  in policyId=${policyId}  out covered=${covered}
```

```text
bpmn find <file> [text] [--kind <kind>] [--in <id>]
bpmn find claims.bpmn --kind task --in Lane_Clerks

Activity_Pay           serviceTask  "Pay claim"      Lane_Clerks
Activity_SendDecision  sendTask     "Send decision"  Lane_Clerks
```

```text
bpmn diagram <file>
bpmn diagram claims.bpmn

score 76: crossings 1, frameIntrusion 7, labelOnLine 1
  crossings       Flow_NotCovered x DataOutputAssociation_Rating
  frameIntrusion  Lane_Clerks: Event_ClaimReceived, Activity_Assess, +5
participant Participant_Insurer  c0..c11
  lane Lane_Office   row 1: c0 Event_ClaimReceived, c5 Activity_Assess
  lane Lane_Clerks   row 1: c8 Gateway_Covered, c9 Activity_Pay, c10 Activity_SendDecision
```

- `show` without an id prints the outline: pools, every node with kind, id, name, lane, attributes and
  outgoing flows. `--in` cuts it to a pool, process, lane or sub-process; `--around` to the
  neighbourhood of one element, `--depth` flow steps both ways, 1 by default, as the skill always asks.
- `show <id>` is the read before `set`, `move` or `ext remove`: where the element sits, its flows, what
  catches it, its message flows, data, attributes and numbered extensions.
- The text of a read is bounded: an outline past ≈ 150 lines collapses each further scope to one line
  that names `show --in <id>`, and every cut says what it left out (`4 of 16 nodes`). `--json` is
  never cut.
- `find` without text lists every element that the other filters let through. The text matches id,
  name or vendor value, case-insensitive. `--kind` takes a kind as `add` writes it or a family (`task`,
  `event`, `gateway`). Event definitions are no hits; associations only with `--kind association`. No
  hit prints nothing and exits 0; columns are separated by tabs when piped, so `cut -f1` gives the ids.
- `diagram` judges the whole drawing; graders read `.score` from `--json`. A file without a drawing
  prints `no diagram: bpmn layout <file> draws one` instead of one `missing` line per element, and its
  `.score` is `null`, its counts 0.
- `show` ends, like a write, with the state line: `state: 0 errors, 1 warning (bpmn validate lists
  them and runs the project's lint)`. `find` prints only its hits, so its output pipes.

## Behaviour that goes

| item | today | then use | why it goes |
| --- | --- | --- | --- |
| redraw of a diagram the CLI drew itself (ownership check) | every write with model operations on a drawn plane runs a full layout of the old file | the drawing stays; a build from scratch over several writes ends with `bpmn layout`, which the skill teaches | 87 ms per write on a Camunda 8 model of 500 nodes; it moved half a diagram for one step (ask-miragon `change.ts`) |
| full redraw when the incremental layout fails | on a failure | `E_LAYOUT_INCREMENTAL`, today's code for `--layout incremental`, with a hint to a last `layout` operation instead of `--layout full` | it replaces the user's drawing for one failed step; only a warning says so |
| drawing between operations: a model operation after a drawing operation in one batch | `apply` | `E_USAGE` with a hint: model operations first, or two batches | one layout per batch, one code path |
| vertical lanes turned horizontal | a write redraws vertical lanes as horizontal ones; `--no-layout` is the workaround | a write that places, moves or routes something on a vertical plane answers `E_LAYOUT_INCREMENTAL`; `set`, `retype`, `ext` and the drawing commands pass; `bpmn layout` redraws horizontally; `--no-layout` has no replacement. An open decision for the owner | a write must not turn the drawing |
| project lint on writes | every write runs the `.bpmnlintrc` before and after the change | `bpmn validate`, where a project gate runs anyway | it loads Node and plugin code into every write |
| warnings anywhere in the file | a write checks the whole file before and after and reports what it added | warnings at the touched elements; the rest is counted in the `state` line. An error the write adds anywhere still refuses, and is reported | the new file is checked once, whole; the old one only when the new one has errors |
| a new shape sized like its neighbours | the median of its kind on the plane, 0.6 to 1.6 times the default | the bpmn-js size ([shape sizes](modules.md#shape-sizes)) | bpmnlint's `standard-size` reports any other size; Camunda Modeler and bpmn-js create these sizes |
| a task widened for its boundary events | the full layout widens a task with three or more, to 148 by 80 for three | 100 by 80 whatever the count; the events take the free spots on the border, bottom first, then top | the same rule; the widened task is the only report over the corpus after `bpmn layout`; many boundary events are an antipattern, which gets no workaround |
| a task widened for its name | a new or changed long name widens a task, up to 200 wide, and pushes its row | 100 by 80 whatever the name | the same rule; no walk step and no scenario scores higher without it |
| a boundary event over the host's corner | `place --side` puts it over the corner when the border is full, "where hand drawings put a third event" (`ShapePlacement.ts:150`) | `E_NO_ROOM`, which it already returns when the corner is taken too | no workaround for an antipattern |

