# Glossary

The domain terms of bpmn-cli, as the code names them. A class is named after one of these terms;
a new concept gets its line here first.

| term | meaning |
| --- | --- |
| **Doc** | One loaded BPMN document: the moddle tree, its id index and the lookups over it (`model/document.ts`). |
| **Op** | One semantic edit (`add`, `connect`, `set`, `remove`, `retype`, `move`, `order`, `ext`, `split`) or format operation (`place`, `align`, `color`, `label`, `route`, `space`, `tidy`, `compact`), as the ops JSON of `apply` spells it. |
| **Batch** | The ops of one `apply` call, run in one transaction with one layout pass. |
| **Alias** | A `$name` an op gives to what it creates, so later ops of the batch can name it. |
| **Change set** | What one op created, changed and removed, and the warnings it raised (`model/change-set.ts`). |
| **Kind** | The CLI's name for a BPMN element type, with an optional trigger (`userTask`, `boundaryEvent:timer`). |
| **Trigger** | The event definition of an event (message, timer, error, signal, ...). |
| **Bridge** | Reconnecting the predecessors of a removed or moved node to its successors. |
| **Splice** | Inserting a node into an existing sequence flow. |
| **Plane** | The drawing of one BPMN diagram: its shapes, edges and labels (`diagram/plane.ts`). |
| **Checkpoint** | A saved state of a plane, to try a change and undo it (`diagram/PlaneCheckpoint.ts`). |
| **Layout mode** | How a write updates the drawing: `full` redraws, `incremental` keeps a hand-made drawing and places only what changed. |
| **Engine** | A layout engine: the clean engine redraws, the incremental engine keeps a drawing. |
| **Profile** | The rules of one execution platform (Camunda 7, Camunda 8) that `validate` runs on demand. |
| **Finding** | One problem a validation reports (structural, profile, bpmnlint, a host's validator). |
| **Baseline** | The findings a document had before an edit, so a write reports only what the edit added. |
| **Id style** | The way a file spells its ids (prefixes, case, flow form), learned from the file. |
| **Id conventions** | The id rules a project declares in the `element-id-naming` rule of its `.bpmnlintrc`. |
| **Vendor extension** | Engine-specific content (`camunda:`, `zeebe:`) on a BPMN element. |
| **Model view** | The read view of a document without coordinates: processes, nodes in flow order, lanes, data, collaboration, problems (`query/ModelViewBuilder.ts`). |
| **Element facts** | What the read views say about one element on its own: trigger, props, vendor values, implementation (`query/ElementFacts.ts`). |
| **Element links** | How an element is tied to the rest of its document: pool, message flows, annotations, data, effective lane (`query/ElementLinks.ts`). |
| **Window** | The neighbourhood `show --around` shows: the flow nodes within `depth` flow steps of an element (`query/AroundWindow.ts`). |
| **Element context** | Where an element is and what surrounds it, as `show <id> --context` prints it (`query/ElementContextBuilder.ts`). |
| **Selector** | `--path`, `--kind` or `--branch`: the elements a format op works on (`query/ElementSelector.ts`). |
| **Column** | The flow nodes of a diagram clustered by centre x, numbered `c0..` left to right (`query/DiagramColumns.ts`). |
| **Flood** | Three or more warnings of one code (and validator) printed as one line (`report/WarningLines.ts`). |
| **Mutation report** | What a write reports: its changes, its warnings as a delta, the layout and the validation (`report/MutationReportBuilder.ts`; text `MutationText`, `--summary` `MutationSummaryBuilder` / `SummaryText`). |
| **Scene** | The drawable items of one plane a render paints, with their boxes and layers (`render/Scene.ts`). |
| **Crop** | The part of a plane a render draws in full: around, path, scope or ids (`render/Crop.ts`). |
| **Tile** | One image of a render split at the diagram's columns and rows (`render/TileGrid.ts`). |
| **Config resolution** | A `.bpmnlintrc`'s effective rules and what it leaves out (`validate/BpmnlintConfigResolution.ts`). |
| **Lint run** | One lint of one document with a new Linter, failing rules left out (`validate/LintRun.ts`). |
| **Project bpmnlint** | The `.bpmnlintrc` that applies to a file, loaded once: validator, id conventions, settings (`node/ProjectBpmnlint.ts`). |
| **Resolver chain** | The tiers bundled, shipped, project that answer a `.bpmnlintrc`'s rules and configs (`node/ChainResolver.ts`). |
| **Repo trust** | Whether a git repository counts as the user's, as git checks it; only then does project code run (`node/RepoTrust.ts`). |
| **Model file** / **Doc file** | A BPMN file on disk / a document and the file its result is written to (`node/ModelFile.ts`, `node/DocFile.ts`). |
| **Text preservation** | Writing a changed model so the parts the change did not touch keep the original file's text (`xml/TextPreservation.ts`). |
| **Preserving writer** | Writes the changed model with the unchanged elements and the style of the original text (`xml/PreservingWriter.ts`). |
| **Element aligner** | Pairs the elements of two XML texts from the roots down: by id, then by name and position (`xml/ElementAligner.ts`). |
