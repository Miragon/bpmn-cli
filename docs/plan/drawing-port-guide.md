# Drawing port guide

For the steps that port `layout/clean/`, `layout/incremental/` and `commands/`. Read it once; it holds what the
first part found out. `ChannelRouter` fits the limits: 868 lines became 11 classes of at most 212 lines, and
replaying main's 317 routed scopes gives the same coordinates. Expect ≈ 1.35 lines per line of main on router code.

## Codemod, then tsc

`node docs/plan/drawing-codemod.mjs <copies of main's files>` strips doc comments and rewrites main's helpers to this
page's calls, on balanced brackets: `right(x)`, `is(x, t)`, `raw(x, p)`, `hitCount(...)`, `PlaneQuery.*`, `Frames.*`, literals
without a comma inside. It leaves 143 old calls in 12.5k lines, the imports, multi-line literals, block statements and the
names `sem`, `defs`. Copy, run it, fix imports, then let tsc list the rest. Split a function only after that.

## Decisions

- **`Box` and `Point`**: always the classes of `model/geometry`, never a literal, also in hot code. `box.right` costs nothing.
  `box.center` allocates, as `center(box)` did: hold it in a local in a loop. The port of the router takes 25 to 27 ms where
  main takes 21 ms over 317 scopes (tsx adds some of it). In its profile `Polyline`'s spans and segments lead and no getter of `Box`
  shows: in a hot loop hold one `Polyline`, do not build it per test.
- **`El` becomes `BpmnElement`**: `GNode.el`, `DShape.el` and `di` hold the wrapper. `BpmnTree` and `BpmnElement.of` return one
  wrapper per object, so `===`, `Map` and `Set` hold. Read `el.name`, `el.peek<T>('p')`, `el.list('p')`. No cache for names: main's
  `nameOf` goes. `el.id` calls moddle's `get`; on what may lack an id use `el.peek<string>('id')`.
- **Rounding for `Scorer`**: a trial writes nothing. `new TrialGuard(planes, new ElementHomes(document), policy)` asks
  `scorer.scoreDrawing(Plane.drawingsOf(planes), homes)`. `DShape.drawing()` and `DEdge.drawing()` give what `PlaneWriter` would store:
  as read when within 0.5 px of the DI, else rounded, a removed label as the DI holds it. Main wrote into the DI per trial, so its
  "as read" moved with each trial; here it is the DI of the last real write. Call `PlaneWriter.write` only on the kept result.
  `homes` holds until the semantics change: make one after the model operations. `TrialGuard.NO_WORSE` is `GUARDED`.

## Where main's names went

| main | here |
| --- | --- |
| `DiagramReader`, `Semantics.of(defs)` | `new PlaneReader(definitions)`, `Semantics.of(definitions)`; `plane.shapes`, `plane.edges` as before |
| `{ id, el, ... }` of `DShape`, `DEdge` | `new DShape(id, el, bounds, kind, container)`, `new DEdge(id, el, kind, points)`, `PlaneReader.edgeOf(el, id, points)`; set the rest after |
| `PlaneQuery.spacingOf(p)`, `isLeaf(s)`, `planeWith(ps, id)`, other statics | `p.spacing()`, `s.isLeaf`, `Plane.with(ps, id)`, methods of `Plane` |
| `Frames.of(p, s)`, `within`, `chain`; `Frames.interior`, `title`, `labelArea` | `new Frames(p).of(s)`; these stay static |
| `titleBox(b, n)` | `Frames.titleBox(b, n)`, a `Box`; `TextMetrics.titleBox` gives a plain `TextBox` |
| `text.ts` | `TextMetrics.labelSize`, `.titleDepth`, `.width`, `.wrap`, `.activitySize`, `.LABEL_LINE`, `.BOTTOM_ROOM` from `@miragon/bpmn-render/text` |
| `SIZES.*`, `METRICS`, `defaultSizeOf`, `annotationSize` | `ShapeSizes.TASK`, `.GAPS`, `.of`, `.ofAnnotation` |
| `near(box, axis)` and the rest of `bands.ts` | `BoxAxis.of(axis).near(box)` |
| `sides.ts`, `span`, `pointOn` | `ShapeSides.of`, `.attached`, `.ofGateway`, `.span`, `.pointOn` |
| `labelAt(s, ...)`, `labelSideOf(s, h)`, `edgeLabelAt`, `edgeLabelSideOf`, `ORDER` | `s.labelAt(...)`, `s.labelSide(h)`, `e.labelAt`, `e.labelSide()`, `DShape.LABEL_SIDES` |
| `hasExternalLabel(s)`, `translateShape`, `translateEdge` | `DShape.hasExternalLabel(s.kind)`, `s.translate`, `e.translate` |
| `unique(ids)`, `outermost(p, ss)`, `frameWord(f)`, `problemWords(ps)` | `[...new Set(ids)]`, `p.outermost(ss)`, `f.frameWord`, `DrawnDiagram.problemWords(ps)` |
| `colorsOf`, `applyColors`, `setSwatch`, `swatchOf`, `SWATCHES` | `new DiagramColors(tree).read()`, `.apply(c)`, `Swatches.set`, `.of`, `.TABLE` |
| `new Groups(defs)`, `.redraw(moddle, gs, id)`, `.relabel(moddle, g, n)` | `new Groups(tree)`, `.redraw(gs, id)`, `.relabel(g, n)` |
| `isAnnotationLine(x)`, `isContainerShape(di, el)`, `poolOf(ps, el)` | `Semantics.isAnnotationLine(x)`, `Frames.isContainerDi(di, el)`, `PoolLayouts.of(el)` |
| `DiPruner.prune(defs, sem)` | `DiPruner.prune(definitions, semantics.byId)`, from model |
| `BEND`, `CROSS`, the rest of `routing.ts` | `RouteCosts.BEND`; `Port` and `Seg` go with the class that makes them |
| `simplify(ps)`, `crossings(ps, lines)` | `new Polyline(ps).simplified()`, `new Polyline(ps).crossingCount(lines)`, lines as `Polyline` |
| `DETACHED_GAP` | `Plane.DETACHED_GAP` |
| `GNode`, `GEdge`, `GArtifact`, `ScopeLayout`, `LinkEnd`, `LaneBandInfo` | in `full/scopes/GNode.ts`: `new GNode(el, id, size, kind)`, the others literals as today; `LaneBox` is a class of its own |
| `outgoingOf(n)`, `isEvent(n)`, `boundaryLeft(n)`, `nameOf(x)` | `n.outgoing`, `n.isEvent`, `n.keepsBoundaryLeft`, `x.el.name` |
| `routedArtifacts(l)`, `obstacles`, `routedSegments`, `growToFit`, `shiftScope`, `shiftNode` | `new Scope(l).routedArtifacts()` and so on; `n.shift` |
| `laneDepth(ls)`, `stretchLane(l, w)` | `LaneBox.depthOf(ls)`, `l.stretch(w)` |
| `ChannelRouter.riseX(n)`, `riseSlots`, `risesInto`, `entriesFromBelow`, `RISE_KEEP` | `n.riseX()`, `n.riseSlots()`, `n.risesInto()`, `n.entriesFromBelow()`, `GNode.RISE_KEEP` |
| `ChannelRouter.riseFrom(e)`, `dataX(n)`, `countCrossings(...)` | the first two stay; `RoutingArea.crossingsOf(...)` |
| main's `Snapshot` | `DrawingSnapshot` at the module root; `pruneReEnded(definitions)` does only further views, `undrawn` went with the ownership check |
| main's `incremental/DrawingSnapshot` | a new name, it is the before-state of one drawing operation: `OperationBefore` |
| `IncrementalLayout.run(doc, snap, opts)` | `await new IncrementalLayout(document, before).place(changes)`: `changes.created`, `changes.relocated`, `changes.expansions.expansion()` |
| `new DrawnDiagram(doc)`, `.sem`, `.doc` | `.semantics`, `.document`; `drawing`, `room`, `snapshot`, `guard` and `measure` come back when `Drawing` is ported |

Already here, do not port again: `ChannelRouter` and its parts, `Channels`, `BorderSlots`, `XIndex`, `ScopeLabels`, `pools.ts`,
all of `di/` but `DiIds`, `DiIdMemo` and what scoring took.

## Rules the code cannot show

- **Plan differences to build**: no fallback to a full redraw; a new shape takes `ShapeSizes`, never the median of its kind; a task never
  widens for boundary events; a boundary event over the host's corner is `E_NO_ROOM`. Hints name no `--no-layout`, `--layout` or `--relayout`.
- **Vertical planes**: main's `assertHorizontal` throws a plain `Error`, so `DiagramDrawing` turns it into `E_LAYOUT_INCREMENTAL`. Keep that, so a
  write never turns the drawing.
- `DrawingOperationRunner.run` also gets an `order` of bands. `details.op` it sets is an index into its list; write adds the model operations.
- A `FullLayout.draw()` writes DI in place: `DiagramDrawing` invalidates the tree after it and restores the colours.

## Traps

- dependency-cruiser's `no-cycle` counts `import type`. That is why the graph lives in one file, why `Way` sits in `BoundaryWays` and not in
  `UpRoute`, and why `DShape` holds `storedBox`, not `PlaneWriter`. Put a mutual type in the lower file.
- A getter counts as a public method. A class at 12 has no room: move what one outside class calls to that class.
- A subfolder may not import a value from its parent: only the root's classes sit at the root. `incremental/` takes `DrawingSnapshot` as a type.
- `[start, end]` on a `Segment` runs a generator; use `{ start, end }` in a loop. `segment[0]` and `seg.some` do not compile, `[...seg]` does.
- Never spread a `Box`: `{ ...box, y }` is a plain object and `new Box(box.x, y, box.width, box.height)` is the port; `{ ...box }` is `box.copy()`.
- Main passes `ignore` lists by identity: `hitCount(points, boxes, [node.box])`. A `copy()` there stops ignoring.
- `new DiIds(x).shape` as a callback loses `this` here: `(id) => ids.shape(id)`.
- Class fields exist from the start: `'label' in shape` is always true, and `delete shape.label` becomes `shape.label = undefined`.
- `el.list(p)` and `el.get(p)` return copies, and `peek` wraps on each call: read once outside a loop, write with `add`, `remove`, `set`.
- `OperationParser.parse([])` refuses: `E_USAGE`.
- Keep the order of candidates and scores exactly: `rank * 0.001` decides ties, and pruning by the best so far must see the same order.

## Tests

- Values of model and scoring reach a mirrored test through `test/support/ModelValues.ts`; `ScopeSketch` builds a scope with coordinates,
  `RecordedScopes` reads `corpus/drawing/channel-router-scopes.json`, 33 scopes with main's result. The tests of `FullLayout`,
  `IncrementalLayout`, `DrawingOperationRunner` and `DiagramDrawing` pin the thin classes ("not ported yet"): replace those cases.
- Prove a port against main before the whole layout runs: wrap the class in `.oracle/main/dist` by `prototype`, drive it with `layoutXml` over `corpus/`,
  dump input and output as JSON, build the same input for the port, compare exactly. The layout probe then judges the total.
- `npm run oracle -- --entry drawing --probe layout` scores the 115 scenarios and the 156 walk steps. The row in `progress.json` holds 2 until both
  totals are no higher than main's; the commit that finishes step 11 removes it.
