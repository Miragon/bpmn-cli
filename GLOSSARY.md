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
| **Op aliases** | Where one op defines aliases and where it may name one, and the op with its aliases resolved (`ops/OpAliases.ts`). |
| **Alias table** | The aliases of a running batch: each bound to its element, so it follows renames and retypes (`ops/AliasTable.ts`). |
| **Field spec** | Type, description and rules of one key of an op in the ops JSON; one table per op (`ops/utils/op-fields.ts`). |
| **Ops parser** | Checks the ops JSON of `apply` against the field specs and the batch aliases and returns typed ops (`ops/OpsParser.ts`). |
| **Ops schema** | The JSON Schema of the ops JSON, built from the field specs (`ops/OpsSchemaBuilder.ts`). |
| **Change set** | What one op created, changed and removed, and the warnings it raised (`model/ChangeSet.ts`). |
| **Pool editor** | Creates a participant (pool): wraps the one process, binds one, creates a new or a black-box one (`ops/PoolEditor.ts`). |
| **Lane editor** | Creates lanes (nested ones inherit the parent's members) and assigns flow nodes to a lane (`ops/LaneEditor.ts`). |
| **Artifact editor** | Creates data objects, data stores, text annotations and groups, and names a group (`ops/ArtifactEditor.ts`). |
| **Association editor** | Creates and removes associations and data associations (`ops/AssociationEditor.ts`). |
| **Kind** | The CLI's name for a BPMN element type, with an optional trigger (`userTask`, `boundaryEvent:timer`). |
| **Trigger** | The event definition of an event (message, timer, error, signal, ...). |
| **Decision link** | Which DMN decision a business rule task calls, in the spelling of its engine (`camunda:decisionRef`, `zeebe:calledDecision`, the unprefixed `calledDecision`): read by `DecisionLinkReader`, written by `DecisionLinkWriter` (`ops/`). |
| **Bridge** | Reconnecting the predecessors of a removed or moved node to its successors: a single node, a join, a moved group (`ops/Bridge.ts`). |
| **Splice** | Inserting a node into an existing sequence flow (`SequenceFlows.splice`). |
| **Op classes** | `add`, `connect`, `set`, `remove`, `retype`, `move` and `split` run as `ElementAdder`, `ElementConnector`, `PropertySetter`, `ElementRemover`, `ElementRetyper`, `NodeMover` and `FlowSplitter` (`ops/`). |
| **Flow rules** | What a sequence flow may connect and carry: the roles of its ends, one scope for both, a condition its source takes (`model/FlowRules.ts`). |
| **Sequence flows** | Creating, removing, redirecting and splicing a document's sequence flows, their default marker and condition (`ops/SequenceFlows.ts`). |
| **Flow options** | The name, id, condition, language and default marker of the flow an op creates or splices a node into (`ops/FlowOptions.ts`). |
| **Node placement** | Where a node goes (--after / --before / --flow / --in / --on) and the append, prepend, splice or attachment that puts it there (`ops/NodePlacement.ts`). |
| **Lane inheritance** | The lane a node placed in a process without --lane gets (`ops/LaneInheritance.ts`). |
| **Event-gateway rule** | Which targets an event-based gateway may lead to: the Camunda 7 engines' rule or BPMN 2.0's, by the file (`ops/EventGatewayRule.ts`). |
| **Flow id follower** | A flow whose id names its ends takes the id of its new ends when they change (`ops/FlowIdFollower.ts`). |
| **Stale flow report** | W_FLOW_ID_STALE for the flows that kept an id naming their old ends (`ops/StaleFlowReport.ts`). |
| **Event trigger** | An event's trigger as the model has it: as options, as details, as a short text (`ops/EventTrigger.ts`). |
| **Trigger change** | A change of an element's trigger or kind: merged options, a dropped non-interrupting flag, the message-flow check, the id state (`ops/TriggerChange.ts`). |
| **Event definitions** | The event definitions of one event, updated in place or replaced when its trigger changes (`ops/EventDefinitions.ts`). |
| **Root elements** | The root Message, Error, Signal and Escalation elements events, tasks and message flows reference (`ops/RootElements.ts`). |
| **Property coercer** | The keys `set` takes and the values it writes: documented keys, settable BPMN attributes, typed values, vendor attributes (`ops/PropertyCoercer.ts`). |
| **Nested slots** | The `definition.` / `loop.` / `condition.` keys of the nested elements without an id of their own (`ops/NestedSlots.ts`). |
| **Element properties** | The settable view of an element's properties that `show <id>` prints (`ops/ElementProperties.ts`). |
| **Id allocator** | The ids one edit gives out (new, explicit, with a collision suffix) and what it recorded about them (`model/IdAllocator.ts`). |
| **Id renamer** | Renaming an id with every reference, and the ids a retype or a trigger change leaves a stale prefix (`ops/IdRenamer.ts`). |
| **Plane** | The drawing of one BPMN diagram: its shapes, edges and labels (`diagram/types.ts`; read by `diagram/DiagramReader.ts`, written by `diagram/PlaneWriter.ts`). |
| **Semantics** | The index of the semantic model a drawing is read against: elements by id, lanes, pools, scopes (`diagram/Semantics.ts`). |
| **Checkpoint** | A saved state of a plane, to try a change and undo it (`diagram/PlaneCheckpoint.ts`). |
| **Groups** | The `bpmn:Group` boxes of a document: remembered before a full redraw and drawn again around their members (`diagram/Groups.ts`). |
| **Sticky** | A design-iq sticky note (`bpmiq:sticky`) that follows the flow node nearest to it (`diagram/Stickies.ts`). |
| **Drawn element ids** | Ids given to the elements a full redraw draws that have none, in the file's id style (`diagram/DrawnElementIds.ts`). |
| **DI ids** | The ids of DI elements in the file's style: new ones (`diagram/DiIds.ts`) and the old ones kept over a full redraw (`diagram/DiIdMemo.ts`). |
| **Drawing** | One plane of a kept drawing being edited, with what the edit touched: space tool, routing, labels, separation and frames behind one seam (`diagram/Drawing.ts`). |
| **Frame** | A pool, lane or expanded sub-process: a shape that holds other shapes (`diagram/FrameEditor.ts` draws, removes, collapses and expands them). |
| **Space tool** | The modeler's tool that moves everything beyond a line to make or close room, growing the frames it crosses (`diagram/SpaceTool.ts`). |
| **Separation** | Local overlap removal: the shapes that conflict with new or moved ones give way (`diagram/Separation.ts`). |
| **Edge router** | Routes and repairs single connections of a kept drawing with the BPMN side conventions (`diagram/EdgeRouter.ts`). |
| **Orthogonal router** | Finds the cheapest orthogonal route of one connection between two boxes: A* over a visibility grid (`diagram/OrthogonalRouter.ts`, `diagram/RouteGrid.ts`, `diagram/SearchHeap.ts`). |
| **Label placer** | Puts external labels on the first free spot around their shape or flow (`diagram/LabelPlacer.ts`). |
| **Trial** | A change that is measured and kept only when it makes the result no worse, else undone: of a kept drawing (`diagram/TrialGuard.ts`), or of an arrangement of the clean engine, kept only when the routes then draw better (`layout/clean/ArrangementTrial.ts`). |
| **Drawing snapshot** | What the planes showed before a format op: bounds, waypoints, labels, connection states (`diagram/DrawingSnapshot.ts`). |
| **Layout analysis** | The measurement of a drawing's layout problems, one plane analysis per BPMNPlane (`diagram/LayoutAnalysis.ts`, `diagram/PlaneAnalysis.ts`; kinds and weights in `diagram/utils/problems.ts`). |
| **Problem locator** | Finds where a layout problem shows on its plane, for the numbered badges of `render --problems` (`diagram/ProblemLocator.ts`). |
| **Node placer** | Gives new and relocated elements a shape in a kept drawing, next to their neighbours, making room where needed (`diagram/NodePlacer.ts`). |
| **Format ops** | One run of a batch's format operations on a document's drawing (`format/FormatOps.ts`), one action class per op (`format/*Action.ts`). |
| **Room maker** | Keeps the shapes a format op moved on request where they are and lets the others give way, refusing a move out of its frame (`format/RoomMaker.ts`). |
| **Room hint** | The space-tool run an `E_NO_ROOM` refusal of `place` / `align` names, found by a dry run (`format/RoomHint.ts`). |
| **Compaction** | Closing the empty rows and columns of a drawing and shrinking its frames to their content (`format/Compaction.ts`). |
| **Layout mode** | How a write updates the drawing: `full` redraws, `incremental` keeps a hand-made drawing and places only what changed. |
| **Engine** | A layout engine: the clean engine redraws, the incremental engine keeps a drawing. |
| **Snapshot** | What every DI element showed before the ops of a write, with the semantic facts the incremental layout's diff needs (`layout/Snapshot.ts`). |
| **Engine-owned** | A drawing that equals what the engine draws for the same model, so `auto` redraws it in full (`layout/DiagramGeometry.ts`). |
| **Engine drawing** | What the clean engine draws for the document; the incremental layout copies blocks of it for new expanded sub-processes and pools (`layout/EngineDrawing.ts`). |
| **Crossing repair** | The incremental layout's last step: crossings between new and kept lines are tried away by routing again or a branch's next row, each trial measured (`layout/CrossingRepair.ts`). |
| **Full layout** | A redraw of the whole model by an engine that keeps the DI ids, the colours and the groups (`layout/FullLayout.ts`). |
| **Temporary lane members** | Laneless flow nodes put into a lane for one bpmn-auto-layout run only (`layout/TemporaryLaneMembers.ts`). |
| **Association edges** | The association DI bpmn-auto-layout leaves out, drawn after its run (`layout/AssociationEdges.ts`). |
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
| **Structural validator** | The structural errors and lint warnings of one document, with the platform profile's findings on request (`validate/StructuralValidator.ts`). |
| **Flow order** | The flow nodes of one scope in flow order from its start events, with the ones no start reaches (`validate/FlowOrder.ts`). |
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
| **Extension editor** | Runs an `ext` op: resolves its host, then adds (`ExtensionInserter`) or removes (`ExtensionRemover`) vendor extension elements (`ops/ExtensionEditor.ts`). |
| **Extension structure** | Where vendor extension elements go: containers, single-instance and keyed types, child order (`ops/ExtensionStructure.ts`). |
| **Extension level** | The top of an element's extensionElements or the children of one vendor element, where `ext` inserts, selects and removes (`ops/ExtensionLevel.ts`). |
| **Extension selector** | `prefix:type[attr=value]/...`: the path `ext` names vendor elements with (`ops/SelectorParser.ts`). |
| **Nested host** | An event definition, loop characteristics or condition expression that holds extension elements and is named through its owner (`ops/NestedHosts.ts`). |
| **Vendor elements** | How `ext` reads, names and creates generic vendor elements: canonical type, prefix, attributes, key and label (`ops/VendorElements.ts`). |
| **Extension snippet** | The `--xml` of `ext add`, read synchronously into generic elements (`ops/ExtSnippetReader.ts`). |
| **Zeebe subscription** | The correlation key of a message, written on the bpmn:Message an event or receive task waits for (`ops/ZeebeSubscription.ts`). |
| **Camunda 8 defaults** | What the CLI writes for elements it creates in a Camunda 8 file, like Camunda Modeler (`platform/Camunda8Defaults.ts`). |
| **Command catalogue** | The commands of `bpmn` with their arguments, `--help` text and guide usage, and the options of every write (`report/CommandCatalogue.ts`). |
| **Shot** | The image or tiles one render wrote, with size, image tokens, plane and numbered problems: `node/ImageWriter.ts` writes it, `report/RenderReport.ts` prints it. |
| **View request** | What `show` (and `viewXml` / `showXml`) is asked to show: the model, one element, its context, a neighbourhood or the drawing, checked like the CLI's flags (`query/ViewRequest.ts`). |
| **Conventions lookup** | The id conventions the `.bpmnlintrc` that applies to a file declares, and why it declares none (`node/ConventionsLookup.ts`). |
| **Agent guide** | `bpmn guide`: the cheat sheet for agents, whole, short or by topic (`report/AgentGuide.ts`). |
| **Kinds reference** | `bpmn kinds`: the tables of kinds, triggers, keys, placement, ops and error codes, as text and JSON (`report/KindsReference.ts`). |
| **Scope** | A process or sub-process the clean engine lays out on its own, in a fixed sequence of steps (`layout/clean/ScopePlacer.ts`). |
| **Grid** | The columns (layers) and rows (bands) of a scope's nodes and where they put them (`layout/clean/ScopeGrid.ts`, the rows by `RowAssigner.ts`). |
| **Arrangement** | Where the clean engine has put a scope's nodes, boundary events, flows and artifacts at one moment; an `ArrangementCheckpoint` saves it and puts it back. |
| **Join column** | The column under a node that its flows from below rise in on, kept free by moving the node right (`JoinColumnTrial`). |
| **Chain lift** | A node and the nodes after it in its lane moved up onto the row of the flow into it (`ChainLiftTrial`). |
| **Top border** | The upper border of a host, where a boundary event whose flows go up sits when that draws better (`TopBorderTrial`). |
| **Router** | Draws the lines: `EdgeRouter` the sequence flows of a scope, `LinkRouter` its associations, `MessageFlowRouter` the message flows between pools. |
| **DI writer** | Emits the BPMN DI of one plane from the laid-out scopes (`layout/clean/DiWriter.ts`). |
| **Pool stack** | The pools of a collaboration, top to bottom in the order whose message flows cut the fewest shapes (`layout/clean/PoolStacker.ts`). |
| **Declutter** | Moving labels that sit on a shape, a label or a line to a free spot (`layout/clean/LabelDeclutter.ts`). |
| **Note** | A text annotation; the collaboration's are placed by `layout/clean/NotePlacer.ts`. |
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
