# Guarantees and limits

What bpmn-cli promises when it writes a file, and where it stops. Read it before you let an agent
edit models that people also edit by hand.

::: tip From the CLI
`bpmn guide contract` prints the short form.
:::

## The five guarantees {#the-contract}

1. **You edit the model, not the drawing.** Commands name elements by id. `bpmn show` prints the
   model without coordinates.
2. **The CLI keeps the picture.** Every write checks, draws and then writes atomically
   ([How a write draws](layout.md#how-a-write-draws)).
3. **Ids speak and follow the project's conventions.** A new id says what it names, with the
   prefixes and case of `element-id-naming` ([Ids](reference.md#ids)). Existing ids stay, except
   a flow id that names its ends.
4. **Nothing is half done.** A command or a whole `apply` batch succeeds completely or leaves the
   file untouched. Errors the file already had do not block; new ones do, unless `--force`. The
   project's [bpmnlint](bpmnlint.md) runs in `bpmn validate`, never in a write.
5. **Conventions instead of coordinates.** Sub-processes are expanded, branches follow one rule,
   exclusive gateways are named as a question. `bpmn validate` checks these.

## The drawing

| case | what happens |
| --- | --- |
| a plane with shapes | kept: bounds, waypoints, colours; new elements are placed locally |
| an empty plane, a file without a diagram | drawn in full |
| `bpmn layout`, a last `layout` operation | redrawn; colours stay, manual positions do not |
| a change that finds no place | refused with `E_LAYOUT_INCREMENTAL`; the hint names `layout` |
| DI ids | stay on a redraw |
| expanded / collapsed | kept; `set <id> expanded=false` changes it in place |
| lanes | drawn only inside a pool |
| a new shape | the bpmn-js size: task 100 by 80, gateway 50 by 50, event 36 by 36, whatever its name or boundary events |
| a shape a person drew | keeps its size; only `bpmn layout` sets each shape to the standard size |

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

## What a write checks

- A write checks the new document once, whole, and refuses an error it adds, wherever that sits. It reports
  the findings at the elements it touched; the rest of the file is counted in the state line, and
  `bpmn validate` lists it.
- The layout score informs, it does not refuse: a write that raises it succeeds, and the result says so.
- Project lint runs only in `bpmn validate`, where a project gate runs anyway.

## Limitations

- One root is laid out: the collaboration, or the single process.
- Not supported as new elements: choreographies. A file that has one stays editable.
- No Camunda 7 / 8 engine runs a `complexGateway`; the Camunda checks report it.
- A group (`add group "<Name>" --members <ids...>`) is tied to its members without
  coordinates: every member references the group's category value
  (`categoryValueRef`, BPMN 2.0), and the layout draws the box around them. A group drawn
  in a modeler has only its box; `show` lists the elements that box holds.
- The incremental layout edits horizontal pools and lanes only. A write never turns a drawing: a change
  that needs a new place in a vertical pool answers `E_LAYOUT_INCREMENTAL`, and only `bpmn layout`, which
  draws horizontally, redraws it.
- Many boundary events on one task are an antipattern: they take the free spots on the border, then
  overlap, and the layout score counts it; `place --side` answers `E_NO_ROOM`.
- Lossy imports are refused (`E_IMPORT_LOSSY`); `--force` drops what bpmn-moddle cannot read.
- Broken links in hand-edited files are not repaired; `bpmn validate` reports them.
- The Camunda 8 checks read FEEL syntax, not meaning. The engine finds the rest.
- A flow id that names its ends is renamed when an edit changes its ends (a splice, a
  `move`, `set source=`). Code that names flow ids (generated code, tests) follows the
  `renamed:` report.

::: warning Merges can produce duplicate ids
Two branches that each add an element of the same name get the same id. The next read refuses the
merged file (`E_IMPORT_LOSSY`): rename one of them while resolving the merge.
:::

## Next steps

- [Layout](layout.md): how a write draws, and the draw commands.
- [Syntax and output](reference.md): how ids are made.
- [bpmnlint](bpmnlint.md): the project's rules in `bpmn validate`.
