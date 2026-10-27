# Glossary

The domain terms of bpmn-cli, as the code names them. A class is named after one of these terms;
a new concept gets its line here first.

| term | meaning |
| --- | --- |
| **Doc** | One loaded BPMN document: the moddle tree, its id index and the lookups over it (`domain/document/Doc.ts`). |
| **Edit command** | One change a caller asks for, named after what it does: a model command (`AddElement`, `ConnectElements`, `SetProperties`, `RemoveElements`, `ChangeElementType`, `MoveElements`, `ReorderElements`, `EditExtensionElements`, `SplitIntoBranches`) or a diagram command (`PlaceShapes`, `AlignShapes`, `ColorElements`, `PlaceLabel`, `RerouteFlow`, `InsertSpace`, `TidyShapes`, `CompactDiagram`); the ops JSON of `apply` spells them as ops (`"op": "add"`) (`domain/commands/types.ts`). |
| **Use case** | The contract of one command line verb or API function: an interface with its `Command` and `Result` in `application/port/in/` (`EditDocumentUseCase`, `CreateDocumentUseCase`, `RelayoutDiagramUseCase`, `ValidateDocumentUseCase`, `ReadDocumentUseCase`, `ShowModelUseCase`, `ShowConventionsUseCase`, `FindElementsUseCase`, `RenderDiagramUseCase`, `RenderSvgUseCase`, `RunCommandsUseCase`, `AnalyzeLayoutUseCase`), implemented by the service of the same name in `application/service/` (`EditDocumentService`, ...). Every public function of the library that works on a document goes through one, even where the service only forwards to the domain. |
| **Service** | A class named `...Service`: in the domain, work the commands share or run (`ElementCreationService`, `SequenceFlowService`, ...); in `application/service/`, the implementation of one use case. |
| **Port** / **adapter** | The way in (`application/port/in/`, the use cases) and out (`application/port/out/`: `LoadDocumentPort`, `SaveDocumentPort`, `LoadProjectSettingsPort`, `WriteImagePort`) / what drives the application (`adapters/in/cli/`) or provides an outbound port (`adapters/out/files/` on disk, `adapters/out/memory/` for the in-memory API); only the entries wire them together. |
| **Batch** | The commands of one `apply` call (or of one changing command), run on the document in memory in their order: a diagram command runs after the layout of the model commands before it. Guard, commands, validation, layout, validators, result, all or nothing (`domain/batch/EditBatchService.ts`); the use case then saves the result through `SaveDocumentPort`. |
| **Edit context** | The state of one edit: the call's settings (id conventions, platform, kept flow ids) and what the running batch recorded (`domain/document/EditContext.ts`). The editing services receive it next to the document; `new EditContext(doc)` starts a fresh one. |
| **Model command service** | Hands each model command of a batch to its domain service in an edit context; a batch runs in segments, the drawing brought up to date between them (`domain/batch/ModelCommandService.ts`). |
| **Diagram command service** | Hands each diagram command to its domain service on a document's drawing (`domain/diagram/DiagramCommandService.ts`). |
| **Drawn diagram** | The drawing the diagram commands change: its planes, one drawing per plane, the refusals for what is not drawn (`domain/diagram/DrawnDiagram.ts`). |
| **Batch drawing** | What a batch does to the drawing, the one way the batch reaches it: the layout mode, the layouts between its commands, the diagram commands, the stickies (`domain/diagram/BatchDrawing.ts`). |
| **Layout request** | A sub-process an op asked to lay out expanded or collapsed, kept with the document until a layout reads it (`domain/document/LayoutRequests.ts`). |
| **Relayout diagram** | `bpmn layout` of a document: a full redraw (expanding / collapsing sub-processes) or a tidy (`application/service/RelayoutDiagramService.ts`). |
| **Validate document** | `bpmn validate` of a document: validation, the validators and a layout dry run (`application/service/ValidateDocumentService.ts`). |
| **Reorder elements** | An `order` command on a document: the outgoing flows of a node, the lanes of a pool or lane, or the pools of a collaboration (`domain/editing/ElementOrderService.ts`). |
| **Reorder target** | What an `order` command reorders; lanes and pools are bands the drawing follows (`domain/commands/ReorderTarget.ts`). |
| **Id suggestions** | The ids of a document a mistyped id may have meant: the batch rename, another spelling, a typo, a matching name (`domain/document/IdSuggestions.ts`). |
| **Alias** | A `$name` an op gives to what it creates, so later ops of the batch can name it. |
| **Op aliases** | Where one op defines aliases and where it may name one, read from its edit command definition, and the op with its aliases resolved (`domain/commands/OpAliases.ts`). |
| **Alias table** | The aliases of a running batch: each bound to its element, so it follows renames and retypes (`domain/commands/AliasTable.ts`). |
| **Field spec** | Type, description and rules of one key of an op in the ops JSON; one table per op in its edit command definition, the shared ones (placement, flow and trigger options, split nodes and branches, selectors) in `domain/commands/utils/op-fields.ts`. |
| **Edit command definition** | Everything the ops JSON knows of one edit command: its name, description, field specs, the keys that hold element ids, its checks across keys and its schema rules; one class per command (`domain/commands/definitions/`, e.g. `SplitIntoBranchesDefinition.ts`), listed by `EditCommandDefinitions`. |
| **Command field check** | The checks across the keys of one parsed command (placement, flow options, kind and trigger, selectors) the edit command definitions call (`domain/commands/CommandFieldCheck.ts`). |
| **Command parser** | Checks the ops JSON of `apply` against the field specs and checks of each edit command definition and the batch aliases and returns typed ops (`domain/commands/CommandParser.ts`). |
| **Ops schema** | The JSON Schema of the ops JSON, built from the field specs and schema rules of the edit command definitions (`domain/commands/OpsSchemaBuilder.ts`). |
| **Change set** | What one op created, changed and removed, and the warnings it raised (`domain/document/ChangeSet.ts`). |
| **Pool service** | Creates a participant (pool): wraps the one process, binds one, creates a new or a black-box one (`domain/editing/participants/PoolService.ts`). |
| **Lane service** | Creates lanes (nested ones inherit the parent's members) and assigns flow nodes to a lane (`domain/editing/participants/LaneService.ts`). |
| **Artifact service** | Creates data objects, data stores, text annotations and groups, and names a group (`domain/editing/ArtifactService.ts`). |
| **Association service** | Creates and removes associations and data associations (`domain/editing/AssociationService.ts`). |
| **Kind** | The CLI's name for a BPMN element type, with an optional trigger (`userTask`, `boundaryEvent:timer`). |
| **Trigger** | The event definition of an event (message, timer, error, signal, ...). |
| **Decision link** | Which DMN decision a business rule task calls, in the spelling of its engine (`camunda:decisionRef`, `zeebe:calledDecision`, the unprefixed `calledDecision`): read by `DecisionLinkReader` (`domain/document/`), written by `DecisionLinkWriter` (`domain/editing/`). |
| **Flow bridge** | Reconnecting the predecessors of a removed or moved node to its successors: a single node, a join, a moved group (`domain/editing/flows/FlowBridgeService.ts`). |
| **Moved flows** | The flows a `move` takes out at the old place and puts back at the new one, and what becomes of their names, conditions and default markers (`domain/editing/flows/MovedFlows.ts`). |
| **Splice** | Inserting a node into an existing sequence flow (`SequenceFlowService.splice`). |
| **Model commands** | `add`, `connect`, `set`, `remove`, `retype`, `move`, `order`, `ext` and `split` run in `ElementCreationService`, `ConnectionService`, `PropertyService`, `ElementRemovalService`, `ElementTypeChangeService`, `ElementMoveService`, `ElementOrderService`, `ExtensionElementService` and `BranchSplitService` (`domain/editing/`). |
| **Flow rules** | What a sequence flow may connect and carry: the roles of its ends, one scope for both, a condition its source takes (`domain/document/FlowRules.ts`). |
| **Sequence flow service** | Creating, removing, redirecting and splicing a document's sequence flows, their default marker and condition (`domain/editing/flows/SequenceFlowService.ts`). |
| **Flow options** | The name, id, condition, language and default marker of the flow an op creates or splices a node into (`domain/editing/flows/FlowOptions.ts`). |
| **Node placement service** | Where a node goes (--after / --before / --flow / --in / --on) and the append, prepend, splice or attachment that puts it there (`domain/editing/NodePlacementService.ts`). |
| **Lane inheritance** | The lane a node placed in a process without --lane gets (`domain/editing/participants/LaneInheritance.ts`). |
| **Event-gateway rule** | Which targets an event-based gateway may lead to: the Camunda 7 engines' rule or BPMN 2.0's, by the file (`domain/editing/events/EventGatewayRule.ts`). |
| **Flow id follower** | A flow whose id names its ends takes the id of its new ends when they change (`domain/editing/flows/FlowIdFollower.ts`). |
| **Stale flow report** | W_FLOW_ID_STALE for the flows that kept an id naming their old ends (`domain/editing/flows/StaleFlowReport.ts`). |
| **Event trigger** | An event's trigger as the model has it: as options, as details, as a short text (`domain/editing/events/EventTrigger.ts`). |
| **Trigger change** | A change of an element's trigger or kind: merged options, a dropped non-interrupting flag, the message-flow check, the id state (`domain/editing/events/TriggerChange.ts`). |
| **Event definition service** | The event definitions of one event, updated in place or replaced when its trigger changes (`domain/editing/events/EventDefinitionService.ts`). |
| **Root element service** | The root Message, Error, Signal and Escalation elements events, tasks and message flows reference (`domain/editing/events/RootElementService.ts`). |
| **Property coercer** | The keys `set` takes and the values it writes: settable BPMN attributes, typed values, vendor attributes (`domain/editing/PropertyCoercer.ts`). |
| **Set key catalog** | Every documented `set` key in one definition: its description, where it applies, how `show <id>` reads it back and how `set` writes it (`domain/editing/SetKeyCatalog.ts`). |
| **Nested slots** | The `definition.` / `loop.` / `condition.` keys of the nested elements without an id of their own (`domain/editing/NestedSlots.ts`). |
| **Element properties** | The settable view of an element's properties that `show <id>` prints: the set key catalog's reads around the generic and vendor attributes (`domain/editing/ElementProperties.ts`). |
| **Id allocator** | The ids one edit gives out (new, explicit, with a collision suffix) and what it recorded about them (`domain/document/IdAllocator.ts`). |
| **Id rename service** | Renaming an id with every reference, and the ids a retype or a trigger change leaves a stale prefix (`domain/editing/IdRenameService.ts`). |
| **Plane** | The drawing of one BPMN diagram: its shapes, edges and labels (`domain/diagram/di/types.ts`; read by `domain/diagram/di/DiagramReader.ts`, written by `domain/diagram/di/PlaneWriter.ts`). |
| **Plane query** | Read-only queries on a plane: its leaf shapes, the content of a sub-process, boundary events, the spacing it is drawn with (`domain/diagram/di/PlaneQuery.ts`). |
| **Semantics** | The index of the semantic model a drawing is read against: elements by id, lanes, pools, scopes, sequence flows (`domain/diagram/di/Semantics.ts`). |
| **DI pruner** | Deletes DI whose element is gone, and the edges of flows whose ends changed (`domain/diagram/di/DiPruner.ts`). |
| **Checkpoint** | A saved state of a plane or of chosen shapes and edges (bounds, labels, waypoints, ends), to try a change and undo it (`domain/diagram/di/DrawingCheckpoint.ts`). |
| **Groups** | The `bpmn:Group` boxes of a document: remembered before a full redraw and drawn again around their members (`domain/diagram/di/Groups.ts`). |
| **Sticky** | A design-iq sticky note (`bpmiq:sticky`) that follows the flow node nearest to it (`domain/diagram/di/Stickies.ts`). |
| **Drawn element ids** | Ids given to the elements a full redraw draws that have none, in the file's id style (`domain/diagram/di/DrawnElementIds.ts`). |
| **DI ids** | The ids of DI elements in the file's style: new ones (`domain/diagram/di/DiIds.ts`) and the old ones kept over a full redraw (`domain/diagram/di/DiIdMemo.ts`). |
| **Drawing** | One plane of a kept drawing being edited, with what the edit touched: space tool, routing, labels, separation and frames behind one seam (`domain/diagram/layout/incremental/Drawing.ts`). |
| **Frame** | A pool, lane or expanded sub-process: a shape that holds other shapes (`domain/diagram/di/Frames.ts` finds a shape's frames and their interior; `domain/diagram/layout/incremental/FrameEditor.ts` draws, removes, collapses and expands them). |
| **Space tool** | The modeler's tool that moves everything beyond a line to make or close room, growing the frames it crosses (`domain/diagram/layout/incremental/SpaceTool.ts`). |
| **Separation** | Local overlap removal: the shapes that conflict with new or moved ones give way (`domain/diagram/layout/incremental/Separation.ts`). |
| **Edge router** | Routes and repairs single connections of a kept drawing with the BPMN side conventions (`domain/diagram/layout/incremental/EdgeRouter.ts`). |
| **Orthogonal router** | Finds the cheapest orthogonal route of one connection between two boxes: A* over a visibility grid (`domain/diagram/layout/incremental/OrthogonalRouter.ts`, `domain/diagram/layout/incremental/RouteGrid.ts`, `domain/diagram/layout/incremental/SearchHeap.ts`). |
| **Label placer** | Puts external labels on the first free spot around their shape or flow (`domain/diagram/layout/incremental/LabelPlacer.ts`). |
| **Trial** | A change that is measured and kept only when it makes the result no worse, else undone: of a kept drawing (`domain/diagram/di/TrialGuard.ts`), or of an arrangement of the clean engine, kept only when the routes then draw better (`domain/diagram/layout/clean/ArrangementTrial.ts`). |
| **Drawing snapshot** | What the planes showed before a format op: bounds, waypoints, labels, connection states (`domain/diagram/layout/incremental/DrawingSnapshot.ts`). |
| **Layout analysis** | The measurement of a drawing's layout problems, one plane analysis per BPMNPlane (`domain/diagram/di/LayoutAnalysis.ts`, `domain/diagram/di/PlaneAnalysis.ts`; kinds and weights in `domain/diagram/utils/problems.ts`). |
| **Problem locator** | Finds where a layout problem shows on its plane, for the numbered badges of `render --problems` (`domain/diagram/di/ProblemLocator.ts`). |
| **Node placer** | Gives new and relocated elements a shape in a kept drawing, next to their neighbours, making room where needed (`domain/diagram/layout/incremental/NodePlacer.ts`). |
| **Diagram commands** | `place` and `space` run in `ShapePlacementService` and `SpaceInsertionService` (`domain/diagram/format/`), `align`, `color`, `label`, `route`, `tidy` and `compact` in the drawn diagram itself (`alignShapes`, `colorElements`, `placeLabel`, `rerouteFlow`, `removeOverlaps`, `compactDiagram`); the lane bands of `order` in the `LaneBandService` (`domain/diagram/format/LaneBandService.ts`). |
| **Room service** | Keeps the shapes a format op moved on request where they are and lets the others give way, refusing a move out of its frame (`domain/diagram/format/RoomService.ts`). |
| **Room hint** | The space-tool run an `E_NO_ROOM` refusal of `place` / `align` names, found by a dry run (`domain/diagram/format/RoomHint.ts`). |
| **Compaction service** | Closing the empty rows and columns of a drawing and shrinking its frames to their content (`domain/diagram/format/CompactionService.ts`). |
| **Layout mode** | How a write updates the drawing: `full` redraws, `incremental` keeps a hand-made drawing and places only what changed. |
| **Engine** | A layout engine: the clean engine redraws, the incremental engine keeps a drawing. |
| **Snapshot** | What every DI element showed before the ops of a write, with the semantic facts the incremental layout's diff needs (`domain/diagram/layout/incremental/Snapshot.ts`). |
| **Engine-owned** | A drawing that equals what the engine draws for the same model, so `auto` redraws it in full (`domain/diagram/layout/DiagramGeometry.ts`). |
| **Engine drawing** | What the clean engine draws for the document; the incremental layout copies blocks of it for new expanded sub-processes and pools (`domain/diagram/layout/EngineDrawing.ts`). |
| **Crossing repair** | The incremental layout's last step: crossings between new and kept lines are tried away by routing again or a branch's next row, each trial measured (`domain/diagram/layout/incremental/CrossingRepair.ts`). |
| **Full layout** | A redraw of the whole model by an engine that keeps the DI ids, the colours and the groups (`domain/diagram/layout/FullLayout.ts`). |
| **Temporary lane members** | Laneless flow nodes put into a lane for one bpmn-auto-layout run only (`domain/diagram/layout/TemporaryLaneMembers.ts`). |
| **Association edges** | The association DI bpmn-auto-layout leaves out, drawn after its run (`domain/diagram/layout/AssociationEdges.ts`). |
| **Profile** | The rules of one execution platform (Camunda 7, Camunda 8) that `validate` runs on demand. |
| **Engine profile** | One engine's profile run over a document: the walk, the findings and the rules of Camunda 7 (`C7Profile`) or Camunda 8 (`C8Profile`) on the `EngineProfile` base (`platform/profiles/`). |
| **Platform profiles** | The loaded engine profiles and their loads, runs, baselines and deltas (`domain/validation/profiles/PlatformProfiles.ts`). |
| **Rule kit** | What the on-demand rule chunks use of the core, handed to a profile's constructor instead of imported (`domain/validation/profiles/rule-kit.ts`). |
| **Timer value** | The text of a Camunda 8 timer or date: ISO 8601 duration, date-time, repeating interval or cron expression (`domain/validation/profiles/TimerValue.ts`). |
| **FEEL expression** | The text after the `=` of a Camunda 8 value, checked for JUEL habits and FEEL syntax (`FeelExpression`, parsed by `FeelParser`). |
| **Schema text** | The BPMN schema rules read from a file's text (child order, IDREFs, NCName ids, booleans) that the model cannot see (`SchemaText` over `BpmnSchema`). |
| **Platform detection** | Which engine a file targets, from an explicit choice, `modeler:executionPlatform` or the vendor namespaces (`domain/document/vendor/PlatformDetection.ts`). |
| **Document namespaces** | The xmlns declarations of a document and the URIs its prefixed names resolve to (`domain/document/vendor/DocumentNamespaces.ts`). |
| **Finding** | One problem a validation reports (structural, profile, bpmnlint, a host's validator). |
| **Structural validator** | The structural errors and lint warnings of one document, with the platform profile's findings on request (`domain/validation/StructuralValidator.ts`). |
| **Flow order** | The flow nodes of one scope in flow order from its start events, with the ones no start reaches (`domain/validation/FlowOrder.ts`). |
| **Validator set** | The validators of one call, named, run on one document (`domain/validation/ValidatorSet.ts`). |
| **Baseline** | The findings a document had before an edit, so a write reports only what the edit added (`domain/validation/FindingBaseline.ts`). |
| **Id style** | The way a file spells its ids (prefixes, case, flow form), learned from the file (`domain/document/ids/IdStyle.ts`). |
| **Learned style** | What the ids of one file show by majority: the prefix per kind, the body case, the flow forms (`domain/document/ids/LearnedStyle.ts`). |
| **Tally** | The votes of a file's ids for the keys of one learned rule (`domain/document/ids/Tally.ts`). |
| **Id fitter** | Builds a flow's id from its two ends within the 64 characters of an id, cutting at whole words (`domain/document/ids/IdFitter.ts`). |
| **Element labels** | How ids name an element: as a flow end, and as the anchor of an unnamed element (`domain/document/ids/ElementLabels.ts`). |
| **Id registry** | Every id a document uses (BPMN, DI and vendor ids), so that a new id never collides (`domain/document/ids/IdRegistry.ts`). |
| **Id conventions** | The id rules a project declares in the `element-id-naming` rule of its `.bpmnlintrc`, read by the id conventions reader (`domain/document/ids/IdConventionsReader.ts`). |
| **Declared conventions** | The id conventions as the id style applies them: the usable prefixes, the qualifier, the body case (`domain/document/ids/DeclaredConventions.ts`). |
| **Conventions table** | The conventions new ids follow in one file, a row per id pattern and source (`bpmn show --conventions`, `domain/document/ids/ConventionsTable.ts`). |
| **Vendor extension** | Engine-specific content (`camunda:`, `zeebe:`) on a BPMN element. |
| **Vendor descriptor** | The read-only lookup over an engine's moddle descriptor: its attributes, extension element types, placement and the types an element holds once (`VendorDescriptor`, `CAMUNDA`, `ZEEBE`). |
| **Extension editor** | Runs an `ext` op: resolves its host, then adds (`ExtensionInserter`) or removes (`ExtensionRemover`) vendor extension elements (`domain/editing/extensions/ExtensionElementService.ts`). |
| **Extension structure** | Where vendor extension elements go: containers, single-instance and keyed types, child order (`domain/editing/extensions/ExtensionStructure.ts`). |
| **Extension level** | The top of an element's extensionElements or the children of one vendor element, where `ext` inserts, selects and removes (`domain/editing/extensions/ExtensionLevel.ts`). |
| **Extension selector** | `prefix:type[attr=value]/...`: the path `ext` names vendor elements with (`domain/editing/extensions/SelectorParser.ts`). |
| **Nested host** | An event definition, loop characteristics or condition expression that holds extension elements and is named through its owner (`domain/editing/NestedHosts.ts`). |
| **Vendor elements** | How `ext` reads, names and creates generic vendor elements: canonical type, prefix, attributes, key and label (`domain/editing/VendorElements.ts`). |
| **Extension snippet** | The `--xml` of `ext add`, read synchronously into generic elements (`domain/editing/extensions/ExtensionSnippetReader.ts`). |
| **Zeebe subscription** | The correlation key of a message, written on the bpmn:Message an event or receive task waits for (`domain/editing/events/ZeebeSubscription.ts`). |
| **Camunda 8 defaults** | What the CLI writes for elements it creates in a Camunda 8 file, like Camunda Modeler (`domain/document/vendor/Camunda8Defaults.ts`). |
| **Command catalogue** | The commands of `bpmn` with their arguments, `--help` text and guide usage, and the options of every write (`adapters/in/report/CommandCatalogue.ts`). |
| **Shot** | The image or tiles one render wrote, with size, image tokens, plane and numbered problems: `adapters/out/files/FileImageWriter.ts` writes it, `adapters/in/cli/RenderReport.ts` prints it. |
| **View request** | What `show` (and `viewXml` / `showXml`) is asked to show: the model, one element, its context, a neighbourhood or the drawing, checked like the CLI's flags (`domain/views/ViewRequest.ts`). |
| **Conventions lookup** | The id conventions the `.bpmnlintrc` that applies to a file declares, and why it declares none (`LoadProjectSettingsPort.idConventions`, read by `ShowConventionsService`). |
| **Agent guide** | `bpmn guide`: the cheat sheet for agents, whole, short or by topic (`adapters/in/report/AgentGuide.ts`). |
| **Kinds reference** | `bpmn kinds`: the tables of kinds, triggers, keys, placement, ops and error codes, as text and JSON (`adapters/in/report/KindsReference.ts`). |
| **Scope** | A process or sub-process the clean engine lays out on its own, in a fixed sequence of steps (`domain/diagram/layout/clean/ScopePlacer.ts`). |
| **Grid** | The columns (layers) and rows (bands) of a scope's nodes and where they put them (`domain/diagram/layout/clean/ScopeGrid.ts`, the rows by `RowAssigner.ts`). |
| **Arrangement** | Where the clean engine has put a scope's nodes, boundary events, flows and artifacts at one moment; an `ArrangementCheckpoint` saves it and puts it back. |
| **Join column** | The column under a node that its flows from below rise in on, kept free by moving the node right (`JoinColumnTrial`). |
| **Chain lift** | A node and the nodes after it in its lane moved up onto the row of the flow into it (`ChainLiftTrial`). |
| **Top border** | The upper border of a host, where a boundary event whose flows go up sits when that draws better (`TopBorderTrial`). |
| **Router** | Draws the lines: `EdgeRouter` the sequence flows of a scope, `LinkRouter` its associations, `MessageFlowRouter` the message flows between pools. |
| **DI writer** | Emits the BPMN DI of one plane from the laid-out scopes (`domain/diagram/layout/clean/DiWriter.ts`). |
| **Pool stack** | The pools of a collaboration, top to bottom in the order whose message flows cut the fewest shapes (`domain/diagram/layout/clean/PoolStacker.ts`). |
| **Declutter** | Moving labels that sit on a shape, a label or a line to a free spot (`domain/diagram/layout/clean/LabelDeclutter.ts`). |
| **Note** | A text annotation; the collaboration's are placed by `domain/diagram/layout/clean/NotePlacer.ts`. |
| **Model view** | The read view of a document without coordinates: processes, nodes in flow order, lanes, data, collaboration, problems (`domain/views/ModelViewBuilder.ts`). |
| **Element facts** | What the read views say about one element on its own: trigger, props, vendor values, implementation (`domain/views/ElementFacts.ts`). |
| **Element links** | How an element is tied to the rest of its document: pool, message flows, annotations, data, effective lane (`domain/views/ElementLinks.ts`). |
| **Window** | The neighbourhood `show --around` shows: the flow nodes within `depth` flow steps of an element (`domain/views/AroundWindow.ts`). |
| **Element context** | Where an element is and what surrounds it, as `show <id> --context` prints it (`domain/views/ElementContextBuilder.ts`). |
| **Selector** | `--path`, `--kind` or `--branch`: the elements a format op works on (`domain/diagram/format/ElementSelector.ts`). |
| **Column** | The flow nodes of a diagram clustered by centre x, numbered `c0..` left to right (`domain/views/DiagramColumns.ts`). |
| **Flood** | Three or more warnings of one code (and validator) printed as one line (`adapters/in/report/WarningLines.ts`). |
| **Mutation report** | What a write reports: its changes, its warnings as a delta, the layout and the validation (`adapters/in/report/MutationReportBuilder.ts`; text `MutationText`, `--summary` `MutationSummaryBuilder` / `SummaryText`). |
| **Scene** | The drawable items of one plane a render paints, with their boxes and layers (`domain/views/render/Scene.ts`). |
| **Crop** | The part of a plane a render draws in full: around, path, scope or ids (`domain/views/render/Crop.ts`). |
| **Tile** | One image of a render split at the diagram's columns and rows (`domain/views/render/TileGrid.ts`). |
| **Config resolution** | A `.bpmnlintrc`'s effective rules and what it leaves out (`domain/validation/BpmnlintConfigResolution.ts`). |
| **Lint run** | One lint of one document with a new Linter, failing rules left out (`domain/validation/LintRun.ts`). |
| **Project bpmnlint** | The `.bpmnlintrc` that applies to a file, loaded once: validator, id conventions, settings (`adapters/out/files/ProjectBpmnlint.ts`). |
| **Resolver chain** | The tiers bundled, shipped, project that answer a `.bpmnlintrc`'s rules and configs (`adapters/out/files/ChainResolver.ts`). |
| **Repo trust** | Whether a git repository counts as the user's, as git checks it; only then does project code run (`adapters/out/files/RepoTrust.ts`). |
| **Text preservation** | Writing a changed model so the parts the change did not touch keep the original file's text (`domain/document/xml/TextPreservation.ts`). |
| **Preserving writer** | Writes the changed model with the unchanged elements and the style of the original text (`domain/document/xml/PreservingWriter.ts`). |
| **Element aligner** | Pairs the elements of two XML texts from the roots down: by id, then by name and position (`domain/document/xml/ElementAligner.ts`). |
