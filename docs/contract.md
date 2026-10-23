# Guarantees and limits

What bpmn-cli promises when it writes a file, and where it stops. Read it before you let an agent
edit models that people also edit by hand.

::: tip From the CLI
`bpmn guide contract` prints the short form.
:::

## The five guarantees {#the-contract}

1. **You edit the model, not the drawing.** Commands name elements by id. `bpmn show` prints the
   model without coordinates.
2. **The CLI keeps the picture.** Every write ends with *validate -> layout -> atomic write*
   ([Layout modes](layout.md#layout-modes)).
3. **Ids speak and follow the file.** A new id says what it names, in the file's id style
   ([Ids](reference.md#ids)). Existing ids stay, except a flow id that names its ends.
4. **Nothing is half done.** A command or a whole `apply` batch succeeds completely or leaves the
   file untouched. Errors the file already had do not block (`W_PREEXISTING_ERROR`); new ones do,
   unless `--force`. The project's [bpmnlint](bpmnlint.md) reports but never blocks a write.
5. **Conventions instead of coordinates.** Sub-processes are expanded, branches follow one rule,
   exclusive gateways are named as a question. `bpmn validate` checks these.

## The DI contract

| case | what happens |
| --- | --- |
| a drawing made by hand or with the format commands | kept: bounds, waypoints, colours; new elements are placed locally |
| a new file, no diagram, the engine's own unchanged drawing | drawn by the engine |
| `--relayout`, `bpmn layout` | redrawn; colours stay, manual positions do not |
| DI ids | stay on a redraw |
| expanded / collapsed | kept from the existing DI |
| `--no-layout` | old DI stays; new elements get a shape on the next write |
| lanes | drawn only inside a pool |

Branches: at a split the default flow runs straight (else the first flow to an end event). The
other branches are drawn alternately below and above it in declaration order. `bpmn order`
changes that order.

## What a write changes

A write rewrites only the elements the change touched, so a git diff shows only the change.

- Everything else keeps its text, byte for byte: namespaces, quoting, comments, indentation.
- A changed element keeps its style: attribute order, CDATA, labels on one line.
- A new element follows the file: its indentation and line breaks.
- No-op: a result equal to the file is not written (`unchanged: <file>`).
- Comments inside an element the change removes or rewrites go with it, with a note.
- Encoding: a file is read in the encoding it declares; every write is UTF-8.
- Fallback: where the text cannot be kept exactly, bpmn-moddle writes the whole file, with a
  note.

## Limitations

- One root is laid out: the collaboration, or the single process.
- Not supported as new elements: choreographies, groups. A file that has one stays editable.
- No Camunda 7 / 8 engine runs a `complexGateway`; the Camunda profiles report it.
- Vertical pools and lanes are redrawn in full instead of placed incrementally.
- Lossy imports are refused (`E_IMPORT_LOSSY`); `--force` drops what bpmn-moddle cannot read.
- Broken links in hand-edited files are not repaired; `bpmn validate` reports them.
- The Camunda 8 profile checks FEEL syntax, not meaning. The engine finds the rest.
- A flow id that names its ends is renamed when an edit changes its ends (a splice, a
  `move`, `set source=`). Where flow ids are API (generated code, tests), `--keep-flow-ids` keeps
  them, and `W_FLOW_ID_STALE` names each flow whose id no longer fits, with the `bpmn set` that
  renames it. `BPMN_KEEP_FLOW_IDS=1` makes that the default of a shell
  ([Environment](reference.md#environment)). Library: `keepFlowIds: true`.

::: warning Merges can produce duplicate ids
Two branches that each add an element of the same name get the same id. The next read refuses the
merged file (`E_IMPORT_LOSSY`): rename one of them while resolving the merge.
:::

## Next steps

- [Layout](layout.md): modes, engines and the format commands.
- [Ids, kinds and keys](reference.md): how ids are made.
- [bpmnlint](bpmnlint.md): project rules on every write.
