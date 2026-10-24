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
| **Drawing** | One plane of a kept drawing being edited, with what the edit touched: space tool, routing, labels, separation and frames behind one seam (`diagram/Drawing.ts`). |
| **Frame** | A pool, lane or expanded sub-process: a shape that holds other shapes (`diagram/FrameEditor.ts` draws, removes, collapses and expands them). |
| **Space tool** | The modeler's tool that moves everything beyond a line to make or close room, growing the frames it crosses (`diagram/SpaceTool.ts`). |
| **Separation** | Local overlap removal: the shapes that conflict with new or moved ones give way (`diagram/Separation.ts`). |
| **Edge router** | Routes and repairs single connections of a kept drawing with the BPMN side conventions (`diagram/EdgeRouter.ts`). |
| **Label placer** | Puts external labels on the first free spot around their shape or flow (`diagram/LabelPlacer.ts`). |
| **Trial** | A change of the drawing that is measured and kept only when it makes the layout no worse (`diagram/TrialGuard.ts`). |
| **Drawing snapshot** | What the planes showed before a format op: bounds, waypoints, labels, connection states (`diagram/DrawingSnapshot.ts`). |
| **Layout analysis** | The measurement of a drawing's layout problems, one plane analysis per BPMNPlane (`diagram/LayoutAnalysis.ts`, `diagram/PlaneAnalysis.ts`; kinds and weights in `diagram/utils/problems.ts`). |
| **Problem locator** | Finds where a layout problem shows on its plane, for the numbered badges of `render --problems` (`diagram/ProblemLocator.ts`). |
| **Node placer** | Gives new and relocated elements a shape in a kept drawing, next to their neighbours, making room where needed (`diagram/NodePlacer.ts`). |
| **Layout mode** | How a write updates the drawing: `full` redraws, `incremental` keeps a hand-made drawing and places only what changed. |
| **Engine** | A layout engine: the clean engine redraws, the incremental engine keeps a drawing. |
| **Profile** | The rules of one execution platform (Camunda 7, Camunda 8) that `validate` runs on demand. |
| **Finding** | One problem a validation reports (structural, profile, bpmnlint, a host's validator). |
| **Baseline** | The findings a document had before an edit, so a write reports only what the edit added. |
| **Id style** | The way a file spells its ids (prefixes, case, flow form), learned from the file. |
| **Id conventions** | The id rules a project declares in the `element-id-naming` rule of its `.bpmnlintrc`. |
| **Vendor extension** | Engine-specific content (`camunda:`, `zeebe:`) on a BPMN element. |
