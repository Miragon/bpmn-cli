# Model port map

| old symbol on main | new call in `src/model`, through `../model/index.js` |
| --- | --- |
| **`document/utils/moddle.ts`** | |
| `El` | `BpmnElement`; `El[]` becomes `readonly BpmnElement[]` |
| `BPMN_NS` | `DeclaredNamespaces.BPMN` |
| `Model`, `doc.model` | gone: `document.tree` holds `moddle` and `definitions`; `ParsedModel` for `new ModdleParser().parse(xml)` |
| `createModdle()` | `ModdleParser.moddle()` |
| `idOf(x)` | `x.id`; `x?.id` when `x` may be undefined |
| `peek<T>(x, p)` | `x?.peek<T>(p)`; a list comes back a `readonly` copy |
| `list(x, p)` | `x?.list(p) ?? []`; no collection is created |
| `shownId(x)` | `ElementText.shownId(x)` |
| `is(x, t)` | `x.is(t)`; `x?.is(t)` when `x` may be undefined; a non-element is a type error now |
| `enclosingProcess(x)` | `document.scopes.processOf(x)` |
| `groupName(g)`, `nameOf(x)` | `x.name` |
| `typeLabel(x)` | `Kinds.typeLabel(x)` |
| `many(x, p)` | `x.get<BpmnElement[]>(p)` where the empty collection must exist, else `x.list(p)`; both copies |
| `addTo(x, p, ...c)` | `x.add(p, ...c)` |
| `insertInto(x, p, i, ...c)` | `x.insert(p, i, ...c)` |
| `removeFrom(x, p, c)` | `x.remove(p, c)` |
| `many(x, p).push(c)` | `x.add(p, c)`; a push does not compile |
| `many(x, p).splice(...)`, `.sort(...)`, `list.length = 0` | `x.remove`, `x.insert`, or `x.set(p, reordered)` with the whole new list |
| `isBpmnElement(x)` | `x.isBpmn` |
| `WalkOptions` | `WalkOptions` |
| `walk(root, opts)` | `document.tree.walk(root, opts)`, or `new ElementWalk(root).depthFirst(opts)` without a tree |
| `isDiElement(x)` | `x.isDi` |
| `indexById(defs, { semanticOnly: true })` | `document.tree.all()` |
| `indexById(defs)` | no method: walk `{ bpmnOnly: true }` and read `peek('id')`; `document.ids.registry` holds those ids from the read on |
| `processes(defs)` | `document.tree.processes()` |
| `collaboration(defs)` | `document.tree.collaboration()` |
| `layoutRoot(defs)` | `document.diagram.layoutRoot()` |
| `parseXml(xml, moddle)` | `new ModdleParser().parse(xml, moddle)`; raw objects: `BpmnElement.of(raw)` to wrap |
| `serialize(model)` | `new DocumentWriter().plain(document)` |
| `createDefinitions(...)` | `new NewDocument(options).create()` |
| `x.$type` | `x.type` |
| `x.$parent` | `x.parent`; assign with `x.parent = y` |
| `x.$attrs` | `x.attrs`; a vendor (generic) element has none, its attributes are `peek` and `set` |
| `x.$descriptor` | `x.descriptor` |
| `x.$instanceOf(t)` | `x.is(t)` |
| `x.$children`, `x.$body`, `(x as any)[p]` | `x.list('$children')`, `x.peek('$body')`, `x.peek(p)`; write with `x.set(p, v)` |
| `x.get(p)`, `x.set(p, v)` | the same; values cross as `BpmnElement`, on the way in too |
| the moddle object itself | `x.raw`, for `DiagramRenderer.fromDefinitions` and nothing else |
| **`Doc`** | |
| `Doc.fromXml(xml, file)` | `new DocumentReader().read(xml, file)` for reads, `.readForWrite(xml, file)` for writes |
| `Doc.create(opts, file)` | `new NewDocument(opts).create(file)` |
| `NewDocOptions` | `NewDocumentOptions` |
| `DocSource` | `DocumentSource`, with `asRead` from `readForWrite` |
| `Doc.assertTarget`, `Doc.assertProcessId` | `NewDocument.assertTarget`, `NewDocument.assertProcessId` |
| `doc.toXml()` | `new DocumentWriter().plain(document)`; the file text: `await new DocumentWriter().write(document, changes)` |
| `doc.moddle`, `doc.definitions` | `document.tree.moddle`, `document.tree.definitions` |
| `doc.importWarnings`, `doc.lossyImportWarnings`, `doc.assertLossless(o)`, `doc.file`, `doc.source`, `doc.followFlowEnds` | the same on `document` |
| `doc.platform()`, `doc.initProcess(p, platform)` | the same on `document` |
| `doc.conventions`, `doc.idStyle` | the same on `document`; set `document.conventions` from the call's options, so there is one style per write |
| `doc.prefixFor(u)` | `document.namespaces.prefixFor(u)` |
| `doc.declareNamespace(p, u)` | `document.namespaces.declare(p, u)` |
| `doc.namespaceUri(p)` | `document.namespaces.uriOf(p)` |
| `doc.invalidate()` | `document.tree.invalidate()` |
| `doc.byId()` | `document.tree.all()` |
| `doc.get(id)` | `document.tree.byId(id)` |
| `doc.has(id)` | `document.tree.has(id)` |
| `doc.require(id, expect, what, batch)` | `document.tree.require(id, expect, what, batch)` |
| `doc.suggest(q, max, batch)` | `new IdSuggestions(document.tree.all(), batch).for(q, max)` |
| `doc.ids` | `document.ids.registry` |
| `doc.claimId(id)`, `edit.allocator.*` | `document.ids.*`; `.claim(id)` refuses as `claimId` did |
| `allocator.forgetGenerated` | gone: `claim` does it |
| `doc.create(type, attrs)` | `document.tree.create(type, attrs)`: claims the id, invalidates |
| `doc.moddle.create(type, attrs)` | `document.tree.build(type, attrs)`: claims nothing |
| `doc.moddle.createAny(name, uri, props)` | `document.tree.buildAny(name, uri, props)` |
| `doc.processes()`, `doc.collaboration()`, `doc.rootElementsOfType(t)` | the same on `document.tree` |
| `doc.layoutRoot()` | `document.diagram.layoutRoot()` |
| `doc.scopeOf`, `doc.processOf`, `doc.defaultScope`, `doc.requireScope`, `doc.flowElements`, `doc.flowNodes`, `doc.boundaryEventsOf`, `doc.lanesOf` | the same on `document.scopes` |
| `doc.incoming`, `doc.outgoing`, `doc.sequenceFlows`, `doc.allSequenceFlows`, `doc.messageFlows`, `doc.participants`, `doc.participantOf` | the same on `document.flows` |
| `doc.layoutRequests` | `changes.expansions`, a `LayoutRequests` on the `ChangeSet` |
| **`document/utils/elements.ts`** | |
| `PropDescriptor`, `TypeDescriptor` | `PropertyDescriptor`, `TypeDescriptor` |
| `descriptorOf(x)` | `x.descriptor` |
| `ownValue(x, p)` | `x.peek(p)`; `Object.hasOwn(x.raw, p)` where the property has a moddle default |
| `idOf(x)` of `elements.ts` | `x.peek<string>('id') ?? ''` |
| `labelOf(x)` | `ElementText.labelOf(x)` |
| `isEl(v)` | `v instanceof BpmnElement` |
| `vendorAttributes(x)`, `vendorContent(x)` | `ElementText.vendorAttributes(x)`, `ElementText.vendorContent(x)` |
| **`document/utils/mirror.ts`** | |
| `completeMirrorLists(defs)` | `new MirrorLists(definitions).complete()` |
| `takeMirrorSnapshot(defs)` | `new MirrorLists(definitions).snapshot()` |
| `unkeptEntries(defs, snapshot)` | `new MirrorLists(definitions).unkept(snapshot)` |
| `serializeWithout(model, entries)` | `new MirrorLists(definitions).without(entries, () => writer.plain(document))` |
| `withoutEntries(xml, entries)` | gone: `DocumentWriter.write` serialises the same model without them |
| `MirrorSnapshot`, `MirrorEntry` | the same |
| **`document/utils/lanes.ts`** | |
| `allLanes(p)`, `laneSetOf(o)` | `document.scopes.allLanes(p)`, `document.scopes.laneSetOf(o)` |
| `laneOf(doc, n)` | `document.scopes.laneOf(n)` |
| **`document/utils/nested-slots.ts`** | |
| `NESTED_SLOTS`, `SLOT_TEXT`, `NESTED_TYPES` | `ElementSlots.NAMES`, `ElementSlots.TEXT`, `ElementSlots.TYPES` |
| `NestedSlot`, `SlotRef` | the same |
| `splitNestedKey(k)`, `parseSlotRef(t)` | `ElementSlots.splitKey(k)`, `ElementSlots.parseRef(t)` |
| `definitionsOf(x)`, `slotsOf(x)`, `nestedEntries(x)` | `ElementSlots.definitionsOf(x)`, `ElementSlots.slotsOf(x)`, `ElementSlots.entriesOf(x)`; `nestedElement` stays private |
| `resolveNested`, `ambiguousNested` | not in model: only edit calls them, its `NestedSlots` takes them from main |
| **`document/utils/encoding.ts`** | |
| `declaredEncoding(t)`, `isUtf8(e)`, `utf8Declaration(t)` | `XmlEncoding.declared(t)`, `XmlEncoding.isUtf8(e)`, `XmlEncoding.utf8Declaration(t)` |
| **`document/utils/errors.ts`, `bpmn-error.ts`, `BpmnError.ts`, `ModelError.ts`** | |
| `usageError(m, d)`, `modelError(c, m, d)`, `ioError(c, m, d)` | `BpmnError.usage(m, d)`, `BpmnError.model(c, m, d)`, `BpmnError.io(c, m, d)` |
| `isBpmnError(e)` | `e instanceof BpmnError` |
| `toBpmnError(e)` | `BpmnError.from(e)` |
| `EXIT_CODES` | `BpmnError.EXIT_CODES` |
| `Warning` | `Finding` |
| `ModelError` | the same |
| **`document/utils/finding.ts`, `Finding.ts`** | |
| `SEVERITIES` | `Findings.SEVERITIES` |
| `makeFinding(...)`, `withUnserialised(...)` | `Findings.make(...)`, `Findings.withUnserialised(...)` |
| `Finding`, `Severity`, `ValidatorSeverity`, `ProfileFinding`, `ValidatorIssue`, `ValidatorFinding` | the same, without `covers` and `leftOut`; new `Finding.fix`, a `Suggestion` |
| **`document/utils/fuzzy.ts`** | |
| `editDistance(a, b)`, `levenshtein(a, b)`, `typoTolerance(n)`, `closestKey(k, all)` | `EditDistance.transposing(a, b)`, `EditDistance.levenshtein(a, b)`, `EditDistance.typoTolerance(n)`, `EditDistance.closestKey(k, all)` |
| **`document/utils/id-words.ts`** | |
| `lcfirst`, `ucfirst`, `localName`, `caseLike`, `speakingStem`, `stemWords`, `beginAlike`, `kindWord` | the same names as statics of `IdWords` |
| `PREFIXED`, `CONTEXT_WORDS`, `ContextWord` | `IdWords.PREFIXED`, `IdWords.CONTEXT_WORDS`, `ContextWord` |
| **`document/utils/slug.ts`** | |
| `MAX_ID`, `isFiller`, `cutAt`, `cutName`, `readsApart`, `withLetter`, `idWords`, `keptTail`, `withSuffix`, `isSuffix` | the same names on `IdCut` |
| `MAX_SLUG`, `transliterate`, `nameWords`, `hasIdWords`, `slugify`, `camelSlug`, `snakeSlug`, `kebabSlug`, `isValidId`, `isUsablePrefix` | the same names on `IdSlug` |
| **`document/utils/requests.ts`** | |
| `IdRequest` | the same |
| `kindRequest`, `typeRequest`, `connectionRequest`, `CONNECTIONS` | the same names on `IdRequests` |
| **other `document/utils/`** | |
| `newProcessChange(doc, name)` | `{ id: document.tree.processes()[0]!.id, kind: 'process', name }`, in the caller |
| `renamedNote(old)` | `ChangeEntries.renamedNote(old)` |
| `textValue(v)` | `DecisionLinkReader.textValue(v)` |
| `firstLine(e)` | `BpmnError.firstLine(e)` |
| `readXmlText(t)`, `elementChildren`, `hasCharacterData`, `attrKey`, `idOf`, `decodeXml`, `rawOf` of `text-reader.ts` | `XmlTextReader.read(t)` and the statics `elementChildren`, `hasCharacterData`, `attrKey`, `idOf`, `decode`, `rawOf` |
| `XDocument`, `XElement`, `XAttr` | the same |
| **`document/Kinds.ts`** | |
| `KINDS`, `FLOW_NODE_FAMILIES` | `Kinds.ALL`, `Kinds.FLOW_NODE_FAMILIES` |
| `KindDef`, `Family` | `KindDefinition`, `Family` |
| `kindByName`, `kindOf`, `kindLabel`, `kindOrTypeLabel`, `gatewayKindList`, `isRejectedType(t)` | `Kinds.byName`, `Kinds.of`, `Kinds.label`, `Kinds.labelOrType`, `Kinds.gatewayList`, `Kinds.REJECTED_TYPES[t]` |
| `branchesByCondition`, `ignoresConditions`, `synchronises`, `namedAsQuestion`, `isEventSubProcess` | the same names on `Kinds` |
| `parseKind`, `parseKindToAdd`, `assertKindToken`, `suggestKinds`, `kindFilter` | `KindParser.parse`, `.parseToAdd`, `.assertToken`, `.suggest`, `.filter` |
| `TRIGGERS`, `EVENT_GATEWAY_TRIGGERS` | `Triggers.TABLE`, `Triggers.EVENT_GATEWAY_TRIGGERS` |
| `normalizeTrigger`, `triggerOf`, `triggerOfDefinition`, `isLinkThrow`, `isLinkCatch` | `Triggers.normalize`, `.of`, `.ofDefinition`, `.isLinkThrow`, `.isLinkCatch` |
| `Trigger`, `TriggerDef`, `RootReference` | `Trigger`, `TriggerDefinition`, `RootReference`; `Exclude<Trigger, 'none'>` is `DefinedTrigger` |
| **`document/ChangeSet.ts`** | |
| `ChangeSet.about`, `.entryOf`, `.flowEntryOf`, `.recordReplacement`, `.successorOf` | `ChangeEntries.about`, `.of`, `.ofFlow`, `.recordReplacement`, `.successorOf` |
| `Change`, `Rename` | the same |
| instance methods and fields of `ChangeSet` | the same, plus `expansions` |
| **other `document/`** | |
| `FlowRules(doc)` | `document.flowRules` |
| `IdAllocator(doc, styleOf)` | `document.ids`, with `registry` |
| `IdConventions.ts`: `DEFAULT_ID_CONVENTIONS`, `UNCHECKED_PREFIXES`, `QualifierMode` | `IdDefaults.CONVENTIONS`, `IdDefaults.UNCHECKED_PREFIXES`, `QualifierMode` |
| `IdStyle`, `IdFitter`, `IdRegistry`, `DeclaredConventions`, `ElementLabels` | the same classes; `Body`, `IdState` come with `IdDefaults` |
| `LayoutRequests` | `LayoutRequests`, without `collapse`; `expansion()` takes no options |
| `xml/TextPreservation`, `PreservedText`, `PreservingWriter`, `ElementAligner`, `XmlTextError` | the same; `StartTagWriter` and `ChildGaps` split out |
| `EditSession`, `BatchContext` | `EditSession` is edit's; `BatchContext` comes with `IdSuggestions` |
| `Camunda8Defaults` | edit's, it writes |
| `ExtensionLister` | views': only views read it |
| `ids/ConventionsTable`, `bpmnlint-rule-setting.ts` | views, cli |
| **`document/vendor/`** | |
| `CAMUNDA`, `ZEEBE`, `VendorDescriptor` | the same |
| `CAMUNDA_URI`, `OPERATON_URI`, `C7_URIS`, `C7_DEFAULT_TTL`, `C7_PLATFORM_VERSION` | `CamundaDescriptor.URI`, `.OPERATON_URI`, `.C7_URIS`, `.DEFAULT_TTL`, `.PLATFORM_VERSION` |
| `ZEEBE_URI`, `C8_PLATFORM_VERSION` | `ZeebeDescriptor.URI`, `.PLATFORM_VERSION` |
| `CAMUNDA_DESCRIPTOR`, `ZEEBE_DESCRIPTOR` | `CamundaSchema.DESCRIPTOR`, `ZeebeSchema.DESCRIPTOR` |
| `KNOWN_NAMESPACES` | `DeclaredNamespaces.KNOWN` |
| `DocumentNamespaces(doc)` | `new DocumentNamespaces(document.tree.definitions)` |
| `PlatformDetection.of(doc)` | `new PlatformDetection(document.tree.definitions)`; `resolve(choice)` goes with the option `platform` |
| `TARGETS`, `platformOfTarget` | `PlatformDetection.TARGETS`, `PlatformDetection.platformOfTarget` |
| **`diagram/utils/geom.ts`** | |
| `Box` literal `{ x, y, width, height }` | `new Box(x, y, width, height)`; `{ ...box, y }` becomes a copy and an assignment |
| `Point` literal `{ x, y }` | `new Point(x, y)` |
| `Segment` tuple `[a, b]` | `new Segment(a, b)`; it destructures and spreads as two points |
| `center(b)`, `right(b)`, `bottom(b)` | `b.center`, `b.right`, `b.bottom` |
| `cx(b)`, `cy(b)` | `b.center.x`, `b.center.y` |
| `copyBox(b)` | `b.copy()` |
| `copyPoints(ps)` | `new Polyline(ps).copy()` |
| `sameBox(a, b, t)`, `equalBoxes(a, b)` | `Box.same(a, b, t)`, `Box.same(a, b, 0)` |
| `samePoints(a, b, t)` | `new Polyline(a).same(new Polyline(b), t)` |
| `overlaps(a, b, m)` | `a.overlaps(b, m)` |
| `inside(a, b, p)` | `a.isInside(b, p)` |
| `containsPoint(b, p, t)` | `b.contains(p, t)` |
| `union(a, b)`, `unionAll(bs)` | `a.union(b)`, `Box.unionAll(bs)` |
| `translate(x, dx, dy)` | `x.translate(dx, dy)`, on a `Point` or a `Box` |
| `translatePoints(ps, dx, dy)` | `new Polyline(ps).translate(dx, dy)` |
| `translateShape(s, dx, dy)`, `translateEdge(e, dx, dy)` | translate `s.bounds`, `e.points` and `label` where drawing's shape and edge live |
| `grow(b, by)` | `b.grow(by)` |
| `segmentHits(a, b, box, s)` | `new Segment(a, b).hits(box, s)` |
| `segmentHitsBox(a, b, box, s)` | `new Segment(a, b).hitsBounds(box, s)` |
| `segmentsCross(a, b, c, d)`, `properCross(s, t)` | `new Segment(a, b).crosses(new Segment(c, d))`, `s.crosses(t)` |
| `polylinesCross(a, b)` | `new Polyline(a).crosses(new Polyline(b))` |
| `pathHits(ps, box, s)` | `new Polyline(ps).hits(box, s)` |
| `toSegments(ps)` | `new Polyline(ps).segments()` |
| `dedupe(ps)` | `new Polyline(ps).deduped()` |
| `hitCount(ps, boxes, ignore)` | `new Polyline(ps).hitCount(boxes, ignore)`; `XIndex<Box>` fits `BoxesByX` |
| `pathHitsAny(ps, boxes, ignore)` | `new Polyline(ps).hitsAny(boxes, ignore)` |
| `isOrthogonal(ps, t)` | `new Polyline(ps).isOrthogonal(t)` |
| `roundPoints(ps)` | `new Polyline(ps).rounded()` |
| `degenerate(ps)` | `new Polyline(ps).rounded().length < 2` |
| `borderDistance(b, p)` | `new BoxBorder(b).distanceTo(p)` |
| `borderPoint(b, to)` | `new BoxBorder(b).pointTowards(to)` |
| `median(vs)` | `new Samples(vs).median()` |
| `clamp(v, lo, hi)` | `new Interval(lo, hi).clamp(v)` |
| **`diagram/utils/di-ids.ts`, `expansion.ts`, `raw.ts`, `di/`** | |
| `Style`, `IdClaims` | `DiStyle`, `IdClaims` |
| `allIds`, `claimUnique`, `styledId`, `rootDiId`, `namesRoot` | the same names on `DiIdStyle` |
| `diStyles(defs)` | `DiIdStyle.stylesOf(definitions)` |
| `followDiIds(defs, el, old, id, ids)` | `DiIdStyle.followRename(definitions, el, old, id, document.ids.registry)` |
| `DiIds`, `DiIdMemo` | the same; `DiIds` has the methods `shape`, `edge`, `plane`, `diagram` |
| `DiPruner.prune(defs, sem)` | `DiPruner.prune(definitions, document.tree.all())` |
| `DiPruner.pruneEdges`, `DiagramReader.displayRoot` | `DiPruner.pruneEdges`, `DiagramIndex.displayRoot` |
| `DrawnElementIds` | drawing's: only a full redraw calls it |
| `SUB_PROCESS_TYPES`, `diExpansionState(defs)`, `resolveExpanded(model, o)` | `DiagramIndex.SUB_PROCESS_TYPES`, `document.diagram.expansionState()`, `document.diagram.expandedIds(o)` |
| `raw(x, p)`, `rawList(x, p)`, `idOf(x)` of `raw.ts` | `x?.peek(p)`, `x?.list(p) ?? []`, `x?.peek<string>('id')` |
| `rawTree(root, skip)` | `new ElementWalk(root).stored(skip)` |
| `boxOf(bounds)` | `DiagramIndex.boxOf(bounds)` |
| **`editing/properties/`, `editing/events/EventTrigger.ts`** | |
| `SET_KEYS`, `SetKeyCatalog.KEYS` | `PropertyKeys.ALL`, without writers |
| `SetKeyCatalog.docs()` | `PropertyCatalog.docs()` |
| `SetKeyCatalog.settableKeys(doc, el)` | `PropertyCatalog.of(el).settableKeys()` |
| `SetKeyCatalog.unknownKey(doc, el, k, why)` | `PropertyCatalog.of(el).unknownKey(k, why)` |
| `SetKeyCatalog.assertVendorKey(doc, el, k)` | `PropertyCatalog.of(el).assertVendorKey(k)` |
| `SetKeyCatalog.readKeysBeforeGeneric(el, doc)`, `readKeysAfterGeneric(el, doc)` | `PropertyCatalog.of(el).readBeforeGeneric(document)`, `.readAfterGeneric(document)` |
| `SetKeyCatalog.appliesTo`, `isPlaceholder` | private; `PropertyCatalog.of(el).entry(key)` answers for one key and refuses with `E_UNKNOWN_KEY` |
| `SetKeyCatalog.writerOf`, the `write` of each key | edit's `PropertyEditor` |
| `PropertyCoercer.blockedReason(k)` | `PropertyCatalog.blockedReason(k)` |
| `PropertyCoercer.isSettable(doc, p)`, `genericKeys(doc, el)`, `enumLiterals(doc, t)` | `PropertyCatalog.of(el).isSettable(p)`, `.genericKeys()`, `.enumLiterals(t)` |
| `DecisionLinkReader(doc)` | `new DecisionLinkReader(document.namespaces)` |
| `EventTrigger.read`, `interruptingOnly`, `ALWAYS_INTERRUPTING`, `TIMER_PROPS`, `TriggerOptions` | the same on `EventTrigger` in model |
| `EventTrigger.details`, `describe` | views': only views read them |
| `EventTrigger.optionsOf` | edit's: it knows the operation's keys |
