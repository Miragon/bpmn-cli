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
| **Scope** | A process or sub-process the clean engine lays out on its own, in a fixed sequence of steps (`layout/clean/ScopePlacer.ts`). |
| **Grid** | The columns (layers) and rows (bands) of a scope's nodes and where they put them (`layout/clean/ScopeGrid.ts`, the rows by `RowAssigner.ts`). |
| **Arrangement** | Where the clean engine has put a scope's nodes, boundary events, flows and artifacts at one moment; an `ArrangementCheckpoint` saves it and puts it back. |
| **Trial** | A move of an arrangement the clean engine keeps only when the routes then draw better, else undoes (`layout/clean/ArrangementTrial.ts`). |
| **Join column** | The column under a node that its flows from below rise in on, kept free by moving the node right (`JoinColumnTrial`). |
| **Chain lift** | A node and the nodes after it in its lane moved up onto the row of the flow into it (`ChainLiftTrial`). |
| **Top border** | The upper border of a host, where a boundary event whose flows go up sits when that draws better (`TopBorderTrial`). |
| **Router** | Draws the lines: `EdgeRouter` the sequence flows of a scope, `LinkRouter` its associations, `MessageFlowRouter` the message flows between pools. |
| **DI writer** | Emits the BPMN DI of one plane from the laid-out scopes (`layout/clean/DiWriter.ts`). |
| **Pool stack** | The pools of a collaboration, top to bottom in the order whose message flows cut the fewest shapes (`layout/clean/PoolStacker.ts`). |
| **Declutter** | Moving labels that sit on a shape, a label or a line to a free spot (`layout/clean/LabelDeclutter.ts`). |
| **Note** | A text annotation; the collaboration's are placed by `layout/clean/NotePlacer.ts`. |
