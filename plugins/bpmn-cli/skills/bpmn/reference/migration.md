# From the 0.x CLI to 1.0

A retired word answers `E_USAGE`, or `E_UNKNOWN_KEY` when it is a `key=value`.
Use the right column.

| 0.x | 1.0 |
| --- | --- |
| `bpmn metrics <file>`, `show --layout` | `bpmn diagram <file>` |
| `show --conventions` | `bpmn conventions <file>` |
| `show <id> --context`, `bpmn ext list <file> <id>` | `bpmn show <file> <id>` |
| `show --scope <id>` | `bpmn show <file> --in <id>` |
| `bpmn kinds --section <x>`, `guide --short` | `bpmn guide <topics...>`, `bpmn guide` |
| `bpmn align <ids...> --axis row --to <ref>` | `bpmn place <id> --row-of <ref>`, one per id (`--column-of` for columns) |
| `rm`, `replace`, `colour` | `remove`, `retype`, `color` |
| `--summary` | the default text is the short report |
| `--render <file>` | `bpmn render <file> <ids...> -o <image>` |
| `--layout full`, `--relayout` | `bpmn layout <file>`, or a last `layout` op |
| `--layout incremental`, `--layout auto` | gone: a plane with shapes keeps its drawing |
| `--no-layout` | gone, without a replacement for vertical lanes: a write that places, moves or routes something on a vertical plane answers `E_LAYOUT_INCREMENTAL`; `bpmn layout` redraws it horizontally |
| `--strict` on a write | `bpmn validate <file> --strict` |
| `--lint-config`, `--no-lint-config` on a write | the same flags on `bpmn validate` |
| `--backup` | Git, or `-o <file>` |
| `--pretty`, `--show` | `--json`, `bpmn show` |
| `new --name <text>` | `bpmn new <file> [name]` |
| `new --no-executable` | `--target none` |
| `--timer <iso>`, `--timer-kind` | `timer=<iso>` tells cycle, duration and date apart |
| `--message`, `--signal`, `--link <name>` | `message=<name>`, `signal=<name>`, `link=<name>` |
| `--error <name> --error-code <code>` | `error=<name> errorCode=<code>` |
| `--escalation <name> --escalation-code <code>` | `escalation=<name> escalationCode=<code>` |
| `--when <expr>`, `--doc <text>`, `--text <text>` | `when=<expr>`, `doc=<text>`, `text=<text>` |
| `--non-interrupting`, `--collapsed` | `nonInterrupting=true`, `expanded=false` |
| `connect --name`, `--condition`, `--language`, `--default`, `--message` | `name=`, `condition=`, `language=`, `default=true`, `message=` |
| `ext add --body <text>` | `body=<text>` |
| `set --unset <key>` | `<key>=` |
| `remove --no-bridge`, `--bridge-all` | `--bridge none`, `--bridge all` |
| `layout --collapse <id>`, `--expand <id>` | `bpmn set <file> <id> expanded=false`, `expanded=true` |
| `layout --tidy` | `bpmn tidy <file>` |
| `--kind`, `--via` on `place`, `color`, `tidy` | ids from `bpmn find <file> --kind <kind>`; `--branch` |
| `render --scope <id>`, `--plane <id>` | `bpmn render <file> <id>` |
| `render --format svg` | `-o <name>.svg` |
| `render --highlight`, `--tiles`, `--max-size`, `--scale`, `--inner`, `--via` | gone: crop with ids, `--around` or `--path` |
| op keys `timer`, `message`, `error`, `doc`, `text` and the like on `add`, `retype`, `connect` | under `"set"`: `{ "op": "add", ..., "set": { "timer": "P2D" } }` |
| `{ "op": "connect", ..., "name": "yes" }` | `{ "op": "connect", ..., "set": { "name": "yes" } }` |
| `{ "op": "set", "values": {...}, "unset": [...] }` | `{ "op": "set", "set": {...} }`, an empty value removes |
| `{ "op": "remove", "bridge": false }`, `"bridgeAll": true` | `"bridge": "none"`, `"bridge": "all"` |

What changed without a word of its own:

- A write no longer redraws a diagram the CLI drew: a model built from scratch
  over several writes ends with `bpmn layout <file>`.
- A write no longer runs the project's `.bpmnlintrc`: its findings come only from
  `bpmn validate`. A write reports findings at the elements it touched and counts
  the rest in its `state:` line; an error it adds anywhere still refuses.
- `show` no longer lists problems: `bpmn validate` and `bpmn diagram` do.
- A failed incremental layout no longer falls back to a redraw: it answers
  `E_LAYOUT_INCREMENTAL`.
- A format op no longer runs between model ops: model ops first, or two batches.
