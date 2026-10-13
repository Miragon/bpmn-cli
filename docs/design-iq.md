# design-iq: the design profile and validators

Miragon's design-iq validates every save of a model with its own validator
(`@miragon/design-iq-validator`) and refuses a model with an error. bpmn-cli has a built-in copy
of those rules, the **design profile**, and a **validator hook** for a host that runs its own
validator inside the write.

## The design profile

The profile checks the result of every write, exactly as it would be written. `--profile auto`
(the default) turns it on for the models of a design-iq content repository: a `designiq.yml` in the
file's directory or above names (`models: <folder>`, legacy `processes:`) a folder that contains
the file. The legacy name `bpmiq.yml` is read too. `--profile design` applies it to any file,
`--profile none` switches it off. Outside a content repository it is off by default, because it
refuses every intermediate state of a model built step by step.

The contract file is found like design-iq finds it, with two differences (the last two points):

- In a directory `designiq.yml` wins over `bpmiq.yml`. Only a regular file counts: a directory
  with one of the names is skipped.
- The name is chosen by existence only. A `designiq.yml` that cannot be read, names no models
  folder or names one that does not contain the file makes no content repository: the
  `bpmiq.yml` beside it is not read, and nothing above is looked at.
- design-iq reads the contract at the repository root only. bpmn-cli takes the nearest one above
  the file, so it works on any path.
- design-iq parses the file as YAML. bpmn-cli reads only the top-level `models:` and
  `processes:` lines with a plain or quoted value. Other YAML forms are not understood, so a file
  in such a form holds no model here: a flow mapping (`{models: m}`), a quoted key, a value on the
  next lines or in a block scalar (`>-`, `|`), a tag or an anchor. A value that is no text in YAML
  (`models: 123`, `models: [a]`) or a key written twice still names a folder here.

The result names the file it read: `validator design (designiq.yml in <dir>: ...)`, or
`bpmiq.yml in <dir>` in a repository with the legacy name.

| code | rule |
| --- | --- |
| `E_DESIGN_START_EVENTS` | a process with flow nodes has exactly one start event, an embedded sub-process at most one |
| `E_DESIGN_UNREACHABLE` | every flow node except start events, boundary events and event sub-processes has an incoming sequence flow |
| `E_DESIGN_DEAD_END` | every flow node except end events and event sub-processes has an outgoing sequence flow (boundary events too) |
| `E_DESIGN_NOT_IN_LANE` | in a process with lanes every node except boundary events is in a top-level lane |
| `E_DESIGN_NO_DI` | every node, flow, artifact, lane, participant and message flow has a shape or edge |
| `E_DESIGN_NAMESPACE` | every namespace prefix the file uses is declared (checked on the raw text, like design-iq) |
| `E_DESIGN_NO_PROCESS`, `E_DESIGN_XML` | the file has a process; it is well-formed (no attribute written twice on one element) |
| `W_DESIGN_COMPLEXITY` | warning: more than 9 activities in the file |
| `W_DESIGN_CALL_LINK`, `W_DESIGN_DECISION_LINK` | warnings: a call activity / business rule task links no process / decision, or one that is no `.bpmn` / `.dmn` of the repository's models folder |

The flow rules are degree checks, not a reachability analysis: compensation handlers, link events
and the content of an ad-hoc sub-process are valid BPMN but fail them. A `--no-layout` write leaves
new elements without shapes and fails `E_DESIGN_NO_DI`. An error the change introduces refuses the
write (`E_VALIDATION`); one the file already had is only a `W_PREEXISTING_ERROR` warning. So an
edit that passes through an invalid state goes into one `apply` batch:

```
$ bpmn add claims/models/claim.bpmn boundary:timer "2 days" --on Activity_Review --timer P2D
error E_VALIDATION: The change would introduce 1 error(s) reported by validator design; nothing was written
  [design] E_DESIGN_DEAD_END Event_2Days: boundaryEvent:timer Event_2Days "2 days" has no outgoing sequence flow  (Continue the flow (`bpmn add <file> <kind> "<Name>" --after Event_2Days`) or end it (`bpmn add <file> endEvent "<Name>" --after Event_2Days`).)
  hint: Fix the listed problems (each names its validator in brackets), make the edit in one transaction (`bpmn apply <file> ops.json`) so that it ends in a valid model, or pass --force to write anyway. The design profile mirrors the design-iq save gate; `--profile none` switches it off.
$ echo '[{"op":"add","kind":"boundary:timer","name":"2 days","on":"Activity_Review","timer":"P2D"},{"op":"add","kind":"end","name":"Escalated","after":"Event_2Days"}]' | bpmn apply claims/models/claim.bpmn -
...
validator design (designiq.yml in /work/claims: a design-iq content repository): 0 error(s), 0 warning(s) in the result
```

`bpmn validate <file> --profile design` lists what is left in a file. The full reference is
`bpmn guide design`; ops are described in [ops.md](ops.md).

## The validator hook (library)

The `validators` option of `applyToXml`, `newXml`, `layoutXml` and `validateXml` (see
[library.md](library.md)) takes functions `(xml, ctx) => findings`, sync or async, or
`{ name, validate }` objects. A mutation runs each one on the document before the ops and on the
candidate XML after them, with `ctx = { file, phase: 'before' | 'after' | 'check', platform, ops,
doc() }`. A finding is `{ severity: 'error' | 'warning', code, message, element?, hint?, key? }`;
design-iq's `{ severity: 'ERROR' | 'WARN', ruleId, message }` is accepted as it is. Findings are
matched before and after by code and element (`key` overrides that), so only errors the change
introduces block the write. A validator that throws fails it with `E_VALIDATOR_FAILED`. The
reports are in `result.validation.validators`.

```js
import { checkModel } from '@miragon/design-iq-validator';
import { applyToXml } from '@miragon/bpmn-cli';

const edit = await applyToXml(xml, ops, {
  file: 'processes/order.bpmn',
  profile: 'none',
  validators: [{ name: 'design-iq', validate: (candidate) => checkModel(candidate, { path: 'processes/order.bpmn' }) ?? [] }],
});
await applyToXml(xml, ops, { contentRepo: { processIds: ['order', 'billing'], decisionIds: ['risk-rating'] } });
```

In memory there is no `designiq.yml` to look up: `auto` runs the built-in profile only when the
caller passes `contentRepo` as in the second call (the file stems of the repository's `.bpmn` and
`.dmn` models). A `contentRepo` with a `root` is named `designiq.yml in <root>` in results; a host
that read the legacy file passes `config: 'bpmiq.yml'` too. The file helpers of
`@miragon/bpmn-cli/node` and the CLI find it on disk.
