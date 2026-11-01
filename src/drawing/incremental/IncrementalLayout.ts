import { DiPruner, type Box, type BpmnDocument, type ChangeSet } from '../../model/index.js';
import type { DrawingSnapshot } from '../DrawingSnapshot.js';
import { FullLayout, type EngineDrawing } from '../full/FullLayout.js';
import type { DEdge } from '../plane/DEdge.js';
import type { Plane } from '../plane/Plane.js';
import { PlaneReader } from '../plane/PlaneReader.js';
import { PlaneWriter } from '../plane/PlaneWriter.js';
import { Semantics } from '../plane/Semantics.js';
import { Drawing } from './Drawing.js';
import { DrawingDiff } from './DrawingDiff.js';
import { NodePlacer } from './placement/NodePlacer.js';
import { PlacementState } from './placement/PlacementState.js';
import type { EdgeBefore } from './routing/EdgeRouter.js';
import { CrossingRepair } from './run/CrossingRepair.js';
import { DuplicateDiGuard } from './run/DuplicateDiGuard.js';
import { EdgeCollection } from './run/EdgeCollection.js';
import { FrameGrowth } from './run/FrameGrowth.js';
import { IncrementalRouting } from './run/IncrementalRouting.js';
import { JoinPuller } from './run/JoinPuller.js';
import { LabelRefresh } from './run/LabelRefresh.js';
import { LayoutRun } from './run/LayoutRun.js';
import { ModelOrder } from './run/ModelOrder.js';
import { RunCheckpoint } from './run/RunCheckpoint.js';
import { BlockAdopter } from './steps/BlockAdopter.js';
import { ContainerPlacer } from './steps/ContainerPlacer.js';
import { NewNodes } from './steps/NewNodes.js';
import { RunReport, type IncrementalReport } from './steps/RunReport.js';

export type { IncrementalReport } from './steps/RunReport.js';

interface Steps {
  run: LayoutRun;
  containers: ContainerPlacer;
  routing: IncrementalRouting;
  edges: EdgeCollection;
  growth: FrameGrowth;
  labels: LabelRefresh;
  nodes: NewNodes;
  report: RunReport;
  edgesBefore: Map<DEdge, EdgeBefore>;
}

export class IncrementalLayout {
  constructor(
    private readonly document: BpmnDocument,
    private readonly before: DrawingSnapshot,
  ) {}

  async place(changes: ChangeSet): Promise<IncrementalReport> {
    const { tree } = this.document;
    const { definitions } = tree;
    const semantics = Semantics.of(definitions);
    const prunedNow = DiPruner.prune(definitions, semantics.byId);
    const stale = this.before.pruneReEnded(definitions);
    const duplicates = new DuplicateDiGuard(definitions);
    const run = this.runOf(semantics, changes);
    if (stale.length) {
      run.notes.push(`edge(s) of ${[...new Set(stale)].join(', ')} removed from a further diagram of the same root: their ends changed, and further diagrams are not laid out`);
    }
    const baseline = new Map(run.planes.flatMap((plane) => [...plane.shapes.values()].map((shape) => [shape.id, shape.bounds.copy()] as const)));
    const steps = this.stepsOf(run, changes, baseline);
    const detached = this.noteEdgesBefore(steps);
    const rerouted = await this.drawChanges(steps, changes);
    for (const id of new Set(rerouted)) {
      const ends = detached.get(id);
      if (ends) {
        run.notes.push(`${id} routed again: it did not reach ${ends.join(' and ')}`);
      }
    }
    new PlaneWriter(tree).write(run.planes);
    tree.invalidate();
    duplicates.assertNone(definitions);
    return steps.report.of(prunedNow, rerouted, steps.edgesBefore);
  }

  private runOf(semantics: Semantics, changes: ChangeSet): LayoutRun {
    const planes = new PlaneReader(this.document.tree.definitions, semantics).planes().filter((plane, index, all) => all.findIndex((other) => other.rootId === plane.rootId) === index);
    const { oldSource, oldTarget } = this.oldEnds(semantics);
    const collapsed = new Set(changes.expansions.expansion().collapse);
    const newDrawing = (plane: Plane, touched?: Set<string>, fresh?: ReadonlySet<string>): Drawing => new Drawing(plane, touched, fresh);
    const place = new PlacementState({ planes, semantics, oldSource, oldTarget, collapsed, notes: [], newDrawing });
    return new LayoutRun(this.document, this.before, place, new NodePlacer(place));
  }

  private oldEnds(semantics: Semantics): { oldSource: Map<string, string>; oldTarget: Map<string, string> } {
    const oldSource = new Map<string, string>();
    const oldTarget = new Map<string, string>();
    for (const [oldFlowId, ends] of this.before.flowEnds) {
      const id = this.before.currentId(oldFlowId);
      const element = semantics.byId.get(id);
      const now = element ? PlaneReader.edgeEnds(element) : undefined;
      const source = this.before.currentId(ends.sourceId);
      const target = this.before.currentId(ends.targetId);
      if (now && source && now.sourceId !== source) {
        oldSource.set(id, source);
      }
      if (now && target && now.targetId !== target) {
        oldTarget.set(id, target);
      }
    }
    return { oldSource, oldTarget };
  }

  private stepsOf(run: LayoutRun, changes: ChangeSet, baseline: ReadonlyMap<string, Box>): Steps {
    const { before, document } = this;
    const edgesBefore = new Map<DEdge, EdgeBefore>();
    let engineRun: Promise<EngineDrawing> | undefined;
    const engine = (): Promise<EngineDrawing> => (engineRun ??= FullLayout.engineDrawing(document, changes.expansions));
    const adopter = new BlockAdopter(run);
    const containers = new ContainerPlacer(run, before, adopter, engine);
    run.place.hooks.planeFor = (id) => containers.planeFor(id);
    return {
      run,
      containers,
      routing: new IncrementalRouting(run, edgesBefore),
      edges: new EdgeCollection(run, before, edgesBefore),
      growth: new FrameGrowth(run, before, baseline),
      labels: new LabelRefresh(run, before),
      nodes: new NewNodes(run, new ModelOrder(document.tree.definitions), changes.created.map(({ id }) => id), adopter, engine),
      report: new RunReport(run, before),
      edgesBefore,
    };
  }

  private noteEdgesBefore({ run, edgesBefore }: Steps): Map<string, string[]> {
    const detached = new Map<string, string[]>();
    for (const plane of run.planes) {
      const vertical = !!plane.verticalBand();
      const { routes } = run.drawing(plane);
      for (const edge of plane.edges.values()) {
        edgesBefore.set(edge, routes.edgeBefore(edge));
        const ends = vertical ? [] : routes.detachedEnds(edge);
        if (ends.length && !(edge.di && this.before.changedEnds(edge.di).length)) {
          detached.set(edge.id, ends);
        }
      }
    }
    return detached;
  }

  private async drawChanges(steps: Steps, changes: ChangeSet): Promise<string[]> {
    const { run, containers, routing } = steps;
    const diff = new DrawingDiff(run, this.before);
    const joins = new JoinPuller(run, this.before);
    const checkpoints = new RunCheckpoint(run);
    const wrapped = containers.followRoot();
    const strips = diff.removedAndRelocated(new Set(changes.relocated));
    diff.closeStrips(strips, new Set([...run.reroute, ...run.place.oldSource.keys(), ...run.place.oldTarget.keys()]));
    diff.applyExpansion(changes.expansions.expansion());
    await containers.placeContainers(wrapped);
    diff.laneChanges();
    joins.pullJoins();
    joins.pushTargets();
    const start = checkpoints.take();
    const rerouted = await new CrossingRepair(run, checkpoints).repair(await this.draw(steps), start, () => this.draw(steps));
    return [...new Set([...rerouted, ...routing.routeGrazed()])];
  }

  private async draw({ run, nodes, routing, edges, growth, labels, report }: Steps): Promise<string[]> {
    await nodes.place((plane, id) => routing.routeNow(plane, id));
    growth.growForTitles();
    growth.separateAll();
    growth.growGroups();
    edges.collect();
    const rerouted = routing.routeAll();
    for (const id of run.routedNow.keys()) {
      if (!run.newEdges.has(id) && !rerouted.includes(id) && run.planes.some((plane) => plane.edges.has(id))) {
        rerouted.push(id);
      }
    }
    labels.labels(new Set([...rerouted, ...run.newEdges]));
    report.assertHorizontal(rerouted);
    return rerouted;
  }
}
