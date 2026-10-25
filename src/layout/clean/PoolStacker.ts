import { is, many, type El, idOf } from '../../model/utils/moddle.js';
import { SIZES } from '../../drawing/utils/sizes.js';
import type { Box, Point, ScopeLayout } from '../../drawing/types.js';
import type { EngineWarning } from './CleanEngine.js';
import type { DiWriter } from './DiWriter.js';
import { LaneArranger } from './LaneArranger.js';
import { MessageFlowRouter, type MessageFlowJob, type MessagePool } from './MessageFlowRouter.js';
import { ScopeFrame } from './ScopeFrame.js';
import type { ScopePlacer } from './ScopePlacer.js';
import type { Segment } from './utils/geometry.js';
import { laneDepth, stretchLane } from './utils/lanes.js';
import { isContainerShape, poolOf } from './utils/pools.js';

export interface PoolLayout {
  participant: El;
  process?: El;
  scope?: ScopeLayout;
  box: Box;
  origin: Point;
  di?: El[];
}

interface MessageFlowEnds extends Omit<MessageFlowJob, 'sourcePool' | 'targetPool'> {
  sourcePool?: PoolLayout;
  targetPool?: PoolLayout;
}

/**
 * Draws the pools of a collaboration and stacks them in the order whose message flows
 * cut the fewest shapes (declaration order on ties), then routes the message flows.
 */
export class PoolStacker {
  readonly pools: PoolLayout[] = [];

  constructor(
    private readonly root: El,
    private readonly writer: DiWriter,
  ) {}

  drawPools(placer: ScopePlacer, groups: ReadonlyMap<string, readonly string[]> | undefined): void {
    const { pools, writer } = this;
    for (const participant of many(this.root, 'participants')) {
      const process = participant.get<El | undefined>('processRef');
      if (process) {
        const scope = placer.layOut(process);
        new LaneArranger(scope, process, groups).apply();
        pools.push({ participant, process, scope, box: { x: 0, y: 0, width: 0, height: 0 }, origin: { x: 0, y: 0 } });
      } else {
        pools.push({ participant, box: { x: 0, y: 0, width: 0, height: SIZES.blackBoxHeight }, origin: { x: 0, y: 0 } });
      }
    }
    let maxWidth = 300;
    for (const p of pools) {
      if (!p.scope) continue;
      const depth = p.scope.lanes.length ? laneDepth(p.scope.lanes) : 0;
      const framed = new ScopeFrame(p.scope).framedSize();
      const contentW = framed.width - framed.left + 2 * SIZES.lanePadding + depth * SIZES.laneHeader;
      maxWidth = Math.max(maxWidth, SIZES.participantHeader + contentW);
      p.box.height = p.scope.lanes.length ? p.scope.height : Math.max(150, p.scope.height + 2 * SIZES.lanePadding);
    }
    const margin = SIZES.outerMargin;
    let y = margin;
    for (const p of pools) {
      p.box = { x: margin, y, width: maxWidth, height: p.box.height };
      const depth = p.scope?.lanes.length ? laneDepth(p.scope.lanes) : 0;
      p.origin = { x: p.box.x + SIZES.participantHeader + depth * SIZES.laneHeader + SIZES.lanePadding, y: p.box.y + (p.scope?.lanes.length ? 0 : SIZES.lanePadding) };
      y += p.box.height + SIZES.poolGap;
    }
    for (const p of pools) {
      const first = writer.di.length;
      writer.shape(p.participant, p.box, { isHorizontal: true });
      if (p.scope) {
        for (const lane of p.scope.lanes) stretchLane(lane, p.box.width - SIZES.participantHeader);
        writer.emitScope(p.scope, p.scope.lanes.length ? { x: p.origin.x, y: p.box.y } : p.origin);
        for (const lane of p.scope.lanes) writer.fixLaneShapes(lane, p);
      }
      p.di = writer.di.slice(first);
    }
  }

  drawMessageFlows(warnings: EngineWarning[]): void {
    const { pools, writer } = this;
    const flows = this.collectMessageFlows(warnings);
    let views = new Map(pools.map((p) => [p, this.messageView(p)]));
    const order = new MessageFlowRouter(this.messageJobs(flows, views), pools.map((p) => views.get(p)!)).poolOrder();
    const reordered = order.map((view) => pools.find((p) => views.get(p) === view)!);
    if (reordered.some((p, i) => p !== pools[i])) {
      this.restackPools(reordered);
      pools.splice(0, pools.length, ...reordered);
      views = new Map(pools.map((p) => [p, this.messageView(p)]));
    }
    for (const route of new MessageFlowRouter(this.messageJobs(flows, views), pools.map((p) => views.get(p)!)).route()) {
      const name = route.el.get<string | undefined>('name');
      writer.edge(route.el, route.points, name ? MessageFlowRouter.label(route.points, name, route.channelY) : undefined);
    }
  }

  private boundaryBoxes(el: El): Box[] {
    const parent = el.$parent as El | undefined;
    if (!parent || is(el, 'bpmn:Participant')) return [];
    return many(parent, 'flowElements')
      .filter((b) => is(b, 'bpmn:BoundaryEvent') && b.get<El | undefined>('attachedToRef') === el)
      .map((b) => this.writer.absBoxes.get(idOf(b)))
      .filter((b): b is Box => !!b);
  }

  private collectMessageFlows(warnings: EngineWarning[]): MessageFlowEnds[] {
    const { pools } = this;
    const { absBoxes } = this.writer;
    const out: MessageFlowEnds[] = [];
    for (const mf of many(this.root, 'messageFlows')) {
      const s = mf.get<El | undefined>('sourceRef');
      const t = mf.get<El | undefined>('targetRef');
      const sb = s ? absBoxes.get(idOf(s)) : undefined;
      const tb = t ? absBoxes.get(idOf(t)) : undefined;
      if (!s || !t || !sb || !tb) {
        warnings.push({ code: 'DI_NOT_CREATED', elementId: idOf(mf), message: `No DI created for message flow ${idOf(mf)} (endpoint without shape)` });
        continue;
      }
      out.push({ el: mf, source: s, target: t, sourceBox: sb, targetBox: tb, sourceOwn: this.boundaryBoxes(s), targetOwn: this.boundaryBoxes(t), sourcePool: poolOf(pools, s), targetPool: poolOf(pools, t) });
    }
    return out;
  }

  private messageJobs(flows: MessageFlowEnds[], views: Map<PoolLayout, MessagePool>): MessageFlowJob[] {
    return flows.map((f) => ({ ...f, sourcePool: f.sourcePool && views.get(f.sourcePool), targetPool: f.targetPool && views.get(f.targetPool) }));
  }

  private messageView(p: PoolLayout): MessagePool {
    const obstacles: Box[] = [];
    const lines: Segment[] = [];
    for (const d of p.di ?? []) {
      const el = d.get<El | undefined>('bpmnElement');
      if (!el) continue;
      if (is(d, 'bpmndi:BPMNShape')) {
        const box = this.writer.absBoxes.get(idOf(el));
        if (box && !isContainerShape(d, el)) obstacles.push(box);
        continue;
      }
      const pts = many(d, 'waypoint').map((w) => ({ x: w.get<number>('x'), y: w.get<number>('y') }));
      for (let i = 0; i + 1 < pts.length; i++) lines.push([pts[i]!, pts[i + 1]!]);
    }
    const depth = p.scope?.lanes.length ? laneDepth(p.scope.lanes) : 0;
    return { box: p.box, obstacles, lines, contentLeft: p.box.x + SIZES.participantHeader + depth * SIZES.laneHeader };
  }

  private shiftPool(p: PoolLayout, dy: number): void {
    if (!dy) return;
    const moveBounds = (b: El | undefined): void => {
      if (b) b.set('y', b.get<number>('y') + dy);
    };
    for (const d of p.di ?? []) {
      moveBounds(d.get<El | undefined>('label')?.get<El | undefined>('bounds'));
      if (!is(d, 'bpmndi:BPMNShape')) {
        for (const w of many(d, 'waypoint')) w.set('y', w.get<number>('y') + dy);
        continue;
      }
      moveBounds(d.get<El | undefined>('bounds'));
      const el = d.get<El | undefined>('bpmnElement');
      const box = el ? this.writer.absBoxes.get(idOf(el)) : undefined;
      if (box) box.y += dy;
    }
    p.box.y += dy;
    p.origin.y += dy;
  }

  private restackPools(order: PoolLayout[]): void {
    let y = SIZES.outerMargin;
    for (const p of order) {
      this.shiftPool(p, y - p.box.y);
      y += p.box.height + SIZES.poolGap;
    }
  }
}
