/**
 * Layout quality metrics with element ids: a library port of `analyse()` in
 * tools/layout-regress.mjs.
 *
 * CONTRACT
 *  - LayoutAnalysis.of(defs) (the public layoutProblems) inspects the DI of every BPMNDiagram of a moddle
 *    `bpmn:Definitions` element and returns `{ counts, problems, score }`.
 *    For the kinds of the regression harness (HARNESS_KEYS) it uses exactly
 *    the harness's metric definitions, de-duplication and weights: `counts[k]`
 *    equals the length of the harness's de-duplicated list for `k` (problems
 *    are de-duplicated by the harness's own key string). The harness stays
 *    independent of this module: change both together. `score = Σ counts[k] ·
 *    WEIGHTS[k]` over all KEYS.
 *  - EXTRA_KEYS are structural defects the harness does not measure (the
 *    clean engine never produces them); hard defects, weighted like an
 *    overlap:
 *      frameIntrusion  a shape (node, boundary event, artifact, expanded
 *                      sub-process) whose centre lies strictly inside an
 *                      expanded sub-process, pool or lane of its plane that
 *                      is not its home: a sub-process is home when it is a
 *                      semantic ancestor (or the host of a boundary event),
 *                      a pool when it holds the shape's process, a lane when
 *                      it (or a lane below it) lists the shape, its host or
 *                      an enclosing sub-process, or, when none of them is in
 *                      a lane, any lane of the shape's process. Frames inside
 *                      the shape itself and collaboration-level artifacts
 *                      (no process) are left out
 *      frameOverlap    two expanded sub-processes of one process, two lanes
 *                      of one process, or two pools, neither inside the other
 *                      semantically, overlapping by more than 1 px both ways
 *      degenerateEdge  a BPMNEdge with fewer than 2 waypoints or of zero
 *                      length
 *      detachedEdge    a BPMNEdge whose first or last waypoint lies more
 *                      than DETACHED_GAP (10) px outside the bounds of the
 *                      shape of that end on its plane (an end without a
 *                      shape there, or docked on a connection, is not
 *                      checked): a line left at its end's old place, which
 *                      the incremental layout reroutes (EdgeRouter.ts
 *                      detachedEnds, the same rule)
 *  - QUALITY_KEYS are soft drawing-quality kinds the harness does not
 *    measure either (weights below 6, so the bench and the fuzzer never count
 *    them as hard):
 *      backwardFlow      a sequence flow whose target's centre lies left of
 *                        its source's left border, unless the target reaches
 *                        the source again (a loop return); sequence flows and
 *                        boundary events (host -> event) form the graph
 *      segmentOverlap    two sequence flows into the same target running on
 *                        top of each other for more than 20 px (a shared
 *                        final segment: they merge before the target; a
 *                        common first segment of a fork does not count).
 *                        Into a gateway (any kind), the common tail of two
 *                        flows that both enter its bottom vertex, or both
 *                        its top vertex, on a vertical final segment does
 *                        not count either: a join's entries share that
 *                        vertex, as bpmn-js draws them. The tail runs from
 *                        the vertex back to where the two part (while
 *                        their runs are collinear and start at the same
 *                        point, 2 px tolerance); what they share elsewhere
 *                        counts, and so do a merge onto a line into a side
 *                        vertex and two flows drawn on top of each other
 *                        from start to end
 *      labelOutsideFrame the label of a named event, gateway, data object /
 *                        store or sequence flow reaching out of its home
 *                        frame: the expanded sub-process it lives in, else
 *                        the pool of its process (2 px tolerance)
 *      labelOnTitle      the label of a named event (boundary events
 *                        included), gateway, data object / store, sequence
 *                        or message flow overlapping the title of a named
 *                        expanded sub-process (event sub-processes,
 *                        transactions and ad-hoc ones too) on its plane:
 *                        where bpmn-js draws its name, diagram/utils/text.ts titleBox.
 *                        Pool and lane names are not checked
 *      messageLabelFar   a named message flow whose label is more than 50 px
 *                        away from its line
 *  - `through` uses a real segment-rectangle test (an axis-parallel segment:
 *    the same as its bounding box); labelOnLine and msgThroughPool keep the
 *    harness's bounding-box test.
 *  - Leaf shapes (overlaps, through, label on shape) are every shape but
 *    pools, lanes, expanded sub-processes and groups: a group box is drawn
 *    around its members, so it overlaps them by design (the harness alike).
 *  - Every problem names the elements involved (`ids`), problems are listed in
 *    KEYS order and, within a kind, in the order the harness finds them:
 *      crossings      [edgeA, edgeB]           overlaps     [shapeA, shapeB]
 *      frameIntrusion [shape, frame]           frameOverlap [frameA, frameB]
 *      through        [edge, shape]            diagonal     [edge]
 *      degenerateEdge [edge]                   detachedEdge [edge, end shape(s) it does not reach]
 *      missing        [element]                labelClash   [labelOwner, shape | other labelOwner]
 *      labelOnLine    [labelOwner, edge]       inOut        [incoming, outgoing, node]
 *      parallelRun    [edgeA, edgeB]           outsideLane  [node, lane]
 *      outsidePool    [node, participant]      outsideSub   [node, subProcess]
 *      edgeLeavesLane [flow, lane]             edgeOutside  [flow, participant | subProcess]
 *      msgThroughPool [messageFlow, participant]
 *      laneGap        [lane, participant]      failed       []
 *      backwardFlow   [flow, source, target]   segmentOverlap [flowA, flowB, shared node]
 *      labelOutsideFrame [labelOwner, frame]   messageLabelFar [messageFlow]
 *      labelOnTitle   [labelOwner, subProcess]
 *    `detail` carries the label variant ('label on shape' | 'label on label'),
 *    the lane side ('top' | 'bottom'), the collinear length of a parallel run
 *    or a segment overlap ('35px'), the distance of a far message label
 *    ('80px') or the failure message.
 *  - `failed` only comes from import warnings, which LayoutAnalysis.ofXml (or a
 *    caller passing `importWarnings`) reports; the harness additionally uses it
 *    for a crashed layout command.
 *  - new ProblemLocator(defs).locate(problems) (ProblemLocator.ts, the public locateProblems) adds where each problem shows (`at`;
 *    `bpmn render --problems` puts a numbered badge there): a point on the
 *    plane of the element `at.plane` names (the plane's bpmnElement),
 *    rounded to 2 decimals, found from the problem's kind, ids and detail
 *    with the same tests the checks use. It lies inside the bounding box of
 *    the problem's elements (shapes, waypoints, DI label bounds), on the
 *    defect itself:
 *      crossings      the crossing point          overlaps, frameOverlap  the centre of the overlap
 *      through, msgThroughPool  the middle of the segment's part inside the shape / pool
 *      diagonal       the middle of the first diagonal segment
 *      degenerateEdge its first waypoint (none without waypoints)
 *      detachedEdge   the end point of the first end it does not reach
 *      labelClash     the centre of the label's overlap with the shape / other label
 *      labelOnLine    the middle of the segment's part in the label text
 *      inOut, parallelRun, segmentOverlap  the middle of the first shared run
 *                     (of a segmentOverlap: the first one that counts, a
 *                     join's common tail skipped)
 *      frameIntrusion, outsideLane, outsidePool, outsideSub  the shape's centre
 *      edgeLeavesLane, edgeOutside  the first waypoint outside the frame
 *      laneGap        the middle of the gap between the lane and the pool border
 *      backwardFlow   half-way along the flow
 *      labelOutsideFrame, messageLabelFar  the centre of the label
 *      labelOnTitle   the centre of the label's overlap with the title
 *    `missing` and `failed` (and a problem whose elements are not drawn)
 *    get no `at`. It is a separate pass, so LayoutAnalysis (every mutation
 *    runs it) and its output are unchanged: results and `metrics` never
 *    carry coordinates.
 *  - Read-only: model properties are read directly, never through `get()`,
 *    which would materialise empty collections on the model.
 *  - diffProblems(before, after) (utils/problems.ts) matches problems by problemKey: the kind, the
 *    ids (order-free for symmetric kinds) and the detail unless it is a
 *    measurement (parallelRun length). Duplicates are matched one to one.
 */
import { is, parseXml, type El } from '../model/utils/moddle.js';
import { PlaneAnalysis, type Add } from './PlaneAnalysis.js';
import { enclosingProcess, type MetricIndex } from './utils/harness.js';
import { idOf, raw, rawList } from './utils/plane.js';
import { KEYS, perKey, scoreOf, type LayoutMetrics, type LayoutProblem } from './utils/problems.js';

export class LayoutAnalysis {
  private readonly index: MetricIndex = { parentOf: new Map(), laneOf: new Map(), poolOf: new Map(), need: new Set(), next: new Map() };
  private readonly keys = perKey(() => new Set<string>());
  private readonly found = perKey<LayoutProblem[]>(() => []);

  /**
   * Layout problems of all diagrams of `defs`. `importWarnings` (the number of
   * warnings of the XML import) is reported as one `failed` problem.
   */
  static of(defs: El, opts: { importWarnings?: number } = {}): LayoutMetrics {
    return new LayoutAnalysis(defs).run(opts.importWarnings);
  }

  /** Parses `xml` with bpmn-moddle and measures it (import warnings count as `failed`). */
  static async ofXml(xml: string): Promise<LayoutMetrics> {
    const { definitions, importWarnings } = await parseXml(xml);
    return LayoutAnalysis.of(definitions, { importWarnings: importWarnings.length });
  }

  private constructor(private readonly defs: El) {}

  private readonly add: Add = (kind, key, ids, detail) => {
    if (this.keys[kind].has(key)) return;
    this.keys[kind].add(key);
    this.found[kind].push(detail === undefined ? { kind, ids } : { kind, ids, detail });
  };

  private run(importWarnings: number | undefined): LayoutMetrics {
    if (importWarnings) {
      const message = `import warnings: ${importWarnings}`;
      this.add('failed', message, [], message);
    }
    this.indexDefinitions();
    const seen = new Set<string>();
    for (const diagram of rawList(this.defs, 'diagrams')) new PlaneAnalysis(raw(diagram, 'plane'), this.index, seen, this.add).run();
    for (const id of this.index.need) if (!seen.has(id)) this.add('missing', id, [id]);
    const counts = perKey(() => 0);
    for (const k of KEYS) counts[k] = this.found[k].length;
    return { counts, problems: KEYS.flatMap((k) => this.found[k]), score: scoreOf(counts) };
  }

  private indexDefinitions(): void {
    const roots = rawList(this.defs, 'rootElements');
    for (const root of roots) {
      if (is(root, 'bpmn:Process')) this.collectScope(root);
      if (is(root, 'bpmn:Collaboration')) {
        for (const p of rawList(root, 'participants')) {
          const id = idOf(p);
          if (id) this.index.need.add(id);
          const procId = idOf(raw<El>(p, 'processRef'));
          if (procId) this.index.poolOf.set(procId, p);
        }
        for (const m of rawList(root, 'messageFlows')) {
          const id = idOf(m);
          if (id) this.index.need.add(id);
        }
      }
    }
    this.dropUnlaidProcesses(roots);
  }

  private collectLanes(lanes: El[], laneOf: Map<string, El>): void {
    for (const lane of lanes) {
      for (const node of rawList(lane, 'flowNodeRef')) {
        const id = idOf(node);
        if (id) laneOf.set(id, lane);
      }
      const child = raw<El>(lane, 'childLaneSet');
      if (child) this.collectLanes(rawList(child, 'lanes'), laneOf);
    }
  }

  private link(from: string | undefined, to: string | undefined): void {
    if (!from || !to) return;
    const list = this.index.next.get(from);
    if (list) list.push(to);
    else this.index.next.set(from, [to]);
  }

  private collectScope(scope: El): void {
    for (const fe of rawList(scope, 'flowElements')) {
      const id = idOf(fe);
      if (id) {
        this.index.parentOf.set(id, scope);
        const drawn = is(fe, 'bpmn:FlowNode') || is(fe, 'bpmn:SequenceFlow') || is(fe, 'bpmn:DataObjectReference') || is(fe, 'bpmn:DataStoreReference');
        if (drawn) this.index.need.add(id);
      }
      if (is(fe, 'bpmn:SubProcess')) this.collectScope(fe);
      if (is(fe, 'bpmn:SequenceFlow')) this.link(idOf(raw(fe, 'sourceRef')), idOf(raw(fe, 'targetRef')));
      if (is(fe, 'bpmn:BoundaryEvent')) this.link(idOf(raw(fe, 'attachedToRef')), id);
      for (const da of [...rawList(fe, 'dataInputAssociations'), ...rawList(fe, 'dataOutputAssociations')]) {
        const daId = idOf(da);
        if (daId) this.index.need.add(daId);
      }
    }
    for (const a of rawList(scope, 'artifacts')) {
      const id = idOf(a);
      if (!id) continue;
      this.index.parentOf.set(id, scope);
      if (is(a, 'bpmn:TextAnnotation') || is(a, 'bpmn:Association')) this.index.need.add(id);
    }
    for (const ls of rawList(scope, 'laneSets')) this.collectLanes(rawList(ls, 'lanes'), this.index.laneOf);
  }

  /** only the laid-out root needs DI: further root processes are a documented limitation */
  private dropUnlaidProcesses(roots: El[]): void {
    const collab = roots.find((e) => is(e, 'bpmn:Collaboration'));
    const laid = new Set<string>();
    if (collab) {
      for (const p of rawList(collab, 'participants')) {
        const id = idOf(raw<El>(p, 'processRef'));
        if (id) laid.add(id);
      }
    } else {
      const id = idOf(roots.find((e) => is(e, 'bpmn:Process')));
      if (id) laid.add(id);
    }
    for (const id of [...this.index.need]) {
      const proc = enclosingProcess(this.index.parentOf.get(id));
      if (proc && !laid.has(idOf(proc) ?? '')) this.index.need.delete(id);
    }
  }
}
