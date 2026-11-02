# Guarantees and limits

What bpmn-cli promises when it writes a file, and where it stops. Read it before you let an agent edit
models that people also edit by hand. `bpmn guide contract` prints the short form.

## Guarantees

1. **You edit the model, not the drawing.** Commands name elements by id; `bpmn show` prints the model
   without coordinates.
2. **The drawing is kept.** New elements are fitted in; only `bpmn layout` redraws ([Layout](./layout.md)).
3. **Ids say what they name** and follow the project's `element-id-naming` settings. Existing ids stay,
   except a flow id that names its ends when those ends change; the result reports it as `renamed:`.
4. **Nothing is half done.** A command or a whole batch succeeds or leaves the file untouched. Errors
   the file already had do not block; a new error does, unless `--force`.
5. **A git diff shows only the change.** Everything a change does not touch keeps its text byte for
   byte: namespaces, quoting, comments, indentation. A result equal to the file is not written
   (`unchanged:`). Every write is UTF-8.

## What a write checks

A write checks the whole new document and refuses an error it adds, wherever it sits. It reports the
findings at the elements it touched and counts the rest in its `state:` line; `bpmn validate` lists
everything. The layout score informs and never refuses. The project's bpmnlint runs only in
`bpmn validate`.

## Limits

- Only horizontal pools and lanes are edited in place. In a vertical drawing a change that needs room
  answers `E_LAYOUT_INCREMENTAL`; `bpmn layout` redraws it horizontally.
- Lanes are drawn only inside a pool.
- Choreographies cannot be created; a file that has one stays editable.
- No Camunda engine runs a `complexGateway`; the Camunda checks report it.
- Many boundary events on one task overlap; `place --side` answers `E_NO_ROOM`.
- A file with content bpmn-moddle cannot read is refused (`E_IMPORT_LOSSY`); `--force` drops that
  content.
- Broken references in hand-edited files are reported by `bpmn validate`, not repaired.
- The Camunda 8 checks read FEEL syntax, not its meaning.

::: warning Merges can produce duplicate ids
Two branches that each add an element of the same name get the same id. The next read refuses the
merged file (`E_IMPORT_LOSSY`): rename one of them while resolving the merge.
:::
