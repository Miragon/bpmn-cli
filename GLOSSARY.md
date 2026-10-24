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
| **Reordering** | An `order` op on a document: the outgoing flows of a node, the lanes of a pool or lane, or the pools of a collaboration (`ops/Reordering.ts`). |
| **Alias** | A `$name` an op gives to what it creates, so later ops of the batch can name it. |
| **Change set** | What one op created, changed and removed, and the warnings it raised (`model/ChangeSet.ts`). |
| **Pool editor** | Creates a participant (pool): wraps the one process, binds one, creates a new or a black-box one (`ops/PoolEditor.ts`). |
| **Lane editor** | Creates lanes (nested ones inherit the parent's members) and assigns flow nodes to a lane (`ops/LaneEditor.ts`). |
| **Artifact editor** | Creates data objects, data stores, text annotations and groups, and names a group (`ops/ArtifactEditor.ts`). |
| **Association editor** | Creates and removes associations and data associations (`ops/AssociationEditor.ts`). |
| **Kind** | The CLI's name for a BPMN element type, with an optional trigger (`userTask`, `boundaryEvent:timer`). |
| **Trigger** | The event definition of an event (message, timer, error, signal, ...). |
| **Decision link** | Which DMN decision a business rule task calls, in the spelling of its engine (`camunda:decisionRef`, `zeebe:calledDecision`, the unprefixed `calledDecision`): read by `DecisionLinkReader`, written by `DecisionLinkWriter` (`ops/`). |
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
| **Vendor descriptor** | The read-only lookup over an engine's moddle descriptor: its attributes, extension element types, placement and the types an element holds once (`VendorDescriptor`, `CAMUNDA`, `ZEEBE`). |
| **Camunda 8 defaults** | What the CLI writes for elements it creates in a Camunda 8 file, like Camunda Modeler (`platform/Camunda8Defaults.ts`). |
| **Command catalogue** | The commands of `bpmn` with their arguments, `--help` text and guide usage, and the options of every write (`report/CommandCatalogue.ts`). |
| **Shot** | The image or tiles one render wrote, with size, image tokens, plane and numbered problems: `node/ImageWriter.ts` writes it, `report/RenderReport.ts` prints it. |
| **View request** | What `show` (and `viewXml` / `showXml`) is asked to show: the model, one element, its context, a neighbourhood or the drawing, checked like the CLI's flags (`query/ViewRequest.ts`). |
| **Conventions lookup** | The id conventions the `.bpmnlintrc` that applies to a file declares, and why it declares none (`node/ConventionsLookup.ts`). |
| **Agent guide** | `bpmn guide`: the cheat sheet for agents, whole, short or by topic (`report/AgentGuide.ts`). |
| **Kinds reference** | `bpmn kinds`: the tables of kinds, triggers, keys, placement, ops and error codes, as text and JSON (`report/KindsReference.ts`). |
