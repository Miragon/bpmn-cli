# Glossary

The domain terms of bpmn-cli, as the code names them. A class is named after one of these terms;
a new concept gets its line here first.

| term | meaning |
| --- | --- |
| **Doc** | One loaded BPMN document: the moddle tree, its id index and the lookups over it (`model/Doc.ts`). |
| **Op** | One semantic edit (`add`, `connect`, `set`, `remove`, `retype`, `move`, `order`, `ext`, `split`) or format operation (`place`, `align`, `color`, `label`, `route`, `space`, `tidy`, `compact`), as the ops JSON of `apply` spells it. |
| **Batch** | The ops of one `apply` call, run in one transaction with one layout pass. |
| **Edit transaction** | One write of a document: guard, ops, validation, diagram update, validators, result; nothing half done (`pipeline/EditTransaction.ts`). |
| **Edit context** | The state of one edit: the call's settings (id conventions, platform, kept flow ids) and what the running batch recorded (`model/EditContext.ts`). |
| **Op runner** | Runs one op on its own or a batch in an edit context (`ops/OpRunner.ts`). |
| **Diagram update** | What a write does to the drawing: the layout mode, the format ops, the stickies, the text it keeps (`pipeline/DiagramUpdate.ts`). |
| **Layout request** | A sub-process an op asked to lay out expanded or collapsed, kept with the document until a layout reads it (`model/LayoutRequests.ts`). |
| **Relayout** | `bpmn layout` of a document: a full redraw (expanding / collapsing sub-processes) or a tidy (`pipeline/Relayout.ts`). |
| **Check** | `bpmn validate` of a document: validation, the validators and a layout dry run (`pipeline/DocCheck.ts`). |
| **Alias** | A `$name` an op gives to what it creates, so later ops of the batch can name it. |
| **Change set** | What one op created, changed and removed, and the warnings it raised (`model/ChangeSet.ts`). |
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
| **Validator set** | The validators of one call, named, run on one document (`validate/ValidatorSet.ts`). |
| **Baseline** | The findings a document had before an edit, so a write reports only what the edit added (`validate/FindingBaseline.ts`). |
| **Id style** | The way a file spells its ids (prefixes, case, flow form), learned from the file (`ids/IdStyle.ts`). |
| **Learned style** | What the ids of one file show by majority: the prefix per kind, the body case, the flow forms (`ids/LearnedStyle.ts`). |
| **Tally** | The votes of a file's ids for the keys of one learned rule (`ids/Tally.ts`). |
| **Id fitter** | Builds a flow's id from its two ends within the 64 characters of an id, cutting at whole words (`ids/IdFitter.ts`). |
| **Element labels** | How ids name an element: as a flow end, and as the anchor of an unnamed element (`ids/ElementLabels.ts`). |
| **Id registry** | Every id a document uses (BPMN, DI and vendor ids), so that a new id never collides (`ids/IdRegistry.ts`). |
| **Id conventions** | The id rules a project declares in the `element-id-naming` rule of its `.bpmnlintrc`, read by the id conventions reader (`ids/IdConventionsReader.ts`). |
| **Declared conventions** | The id conventions as the id style applies them: the usable prefixes, the qualifier, the body case (`ids/DeclaredConventions.ts`). |
| **Conventions table** | The conventions new ids follow in one file, a row per id pattern and source (`bpmn show --conventions`, `ids/ConventionsTable.ts`). |
| **Vendor extension** | Engine-specific content (`camunda:`, `zeebe:`) on a BPMN element. |
