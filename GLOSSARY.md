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
| **Engine profile** | One engine's profile run over a document: the walk, the findings and the rules of Camunda 7 (`C7Profile`) or Camunda 8 (`C8Profile`) on the `EngineProfile` base (`platform/profiles/`). |
| **Platform profiles** | The loaded engine profiles and their loads, runs, baselines and deltas (`platform/profiles/PlatformProfiles.ts`). |
| **Rule kit** | What the on-demand rule chunks use of the core, handed to a profile's constructor instead of imported (`platform/profiles/rule-kit.ts`). |
| **Timer value** | The text of a Camunda 8 timer or date: ISO 8601 duration, date-time, repeating interval or cron expression (`platform/profiles/TimerValue.ts`). |
| **FEEL expression** | The text after the `=` of a Camunda 8 value, checked for JUEL habits and FEEL syntax (`FeelExpression`, parsed by `FeelParser`). |
| **Schema text** | The BPMN schema rules read from a file's text (child order, IDREFs, NCName ids, booleans) that the model cannot see (`SchemaText` over `BpmnSchema`). |
| **Platform detection** | Which engine a file targets, from an explicit choice, `modeler:executionPlatform` or the vendor namespaces (`platform/PlatformDetection.ts`). |
| **Document namespaces** | The xmlns declarations of a document and the URIs its prefixed names resolve to (`platform/DocumentNamespaces.ts`). |
| **Finding** | One problem a validation reports (structural, profile, bpmnlint, a host's validator). |
| **Baseline** | The findings a document had before an edit, so a write reports only what the edit added. |
| **Id style** | The way a file spells its ids (prefixes, case, flow form), learned from the file. |
| **Id conventions** | The id rules a project declares in the `element-id-naming` rule of its `.bpmnlintrc`. |
| **Vendor extension** | Engine-specific content (`camunda:`, `zeebe:`) on a BPMN element. |
| **Vendor descriptor** | The read-only lookup over an engine's moddle descriptor: its attributes, extension element types, placement and the types an element holds once (`VendorDescriptor`, `CAMUNDA`, `ZEEBE`). |
| **Camunda 8 defaults** | What the CLI writes for elements it creates in a Camunda 8 file, like Camunda Modeler (`platform/Camunda8Defaults.ts`). |
