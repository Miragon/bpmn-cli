import { is, many, type El, idOf } from '../../../document/utils/moddle.js';
import { SIZES } from '../../utils/sizes.js';
import type { Box, Point, ScopeLayout } from '../../di/types.js';
import type { EngineWarning } from './CleanEngine.js';
import type { DiWriter } from './DiWriter.js';
import { LaneArranger } from './LaneArranger.js';
import { MessageFlowRouter, type MessageFlowJob, type MessagePool } from './MessageFlowRouter.js';
import { ScopeFrame } from './ScopeFrame.js';
import type { ScopePlacer } from './ScopePlacer.js';
import type { Segment } from '../../utils/geom.js';
import { laneDepth, stretchLane } from '../../utils/lanes.js';
import { isContainerShape, poolOf } from '../../utils/pools.js';
import { isAnnotationLine } from '../../utils/annotations.js';

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
    for (const pool of pools) {
      if (!pool.scope) continue;
      const depth = pool.scope.lanes.length ? laneDepth(pool.scope.lanes) : 0;
      const framed = new ScopeFrame(pool.scope).framedSize();
      const contentW = framed.width - framed.left + 2 * SIZES.lanePadding + depth * SIZES.laneHeader;
      maxWidth = Math.max(maxWidth, SIZES.participantHeader + contentW);
      pool.box.height = pool.scope.lanes.length ? pool.scope.height : Math.max(150, pool.scope.height + 2 * SIZES.lanePadding);
    }
    const margin = SIZES.outerMargin;
    let top = margin;
    for (const pool of pools) {
      pool.box = { x: margin, y: top, width: maxWidth, height: pool.box.height };
      const depth = pool.scope?.lanes.length ? laneDepth(pool.scope.lanes) : 0;
      pool.origin = { x: pool.box.x + SIZES.participantHeader + depth * SIZES.laneHeader + SIZES.lanePadding, y: pool.box.y + (pool.scope?.lanes.length ? 0 : SIZES.lanePadding) };
      top += pool.box.height + SIZES.poolGap;
    }
    for (const pool of pools) {
      const first = writer.di.length;
      writer.shape(pool.participant, pool.box, { isHorizontal: true });
      if (pool.scope) {
        for (const lane of pool.scope.lanes) {
          stretchLane(lane, pool.box.width - SIZES.participantHeader);
        }
        writer.emitScope(pool.scope, pool.scope.lanes.length ? { x: pool.origin.x, y: pool.box.y } : pool.origin);
        for (const lane of pool.scope.lanes) {
          writer.fixLaneShapes(lane, pool);
        }
      }
      pool.di = writer.di.slice(first);
    }
  }

  drawMessageFlows(warnings: EngineWarning[]): void {
    const { pools, writer } = this;
    const flows = this.collectMessageFlows(warnings);
    let views = new Map(pools.map((pool) => [pool, this.messageView(pool)]));
    const order = new MessageFlowRouter(this.messageJobs(flows, views), pools.map((pool) => views.get(pool)!)).poolOrder();
    const reordered = order.map((view) => pools.find((pool) => views.get(pool) === view)!);
    if (reordered.some((pool, index) => pool !== pools[index])) {
      this.restackPools(reordered);
      pools.splice(0, pools.length, ...reordered);
      views = new Map(pools.map((pool) => [pool, this.messageView(pool)]));
    }
    for (const route of new MessageFlowRouter(this.messageJobs(flows, views), pools.map((pool) => views.get(pool)!)).route()) {
      const name = route.el.get<string | undefined>('name');
      writer.edge(route.el, route.points, name ? MessageFlowRouter.label(route.points, name, route.channelY) : undefined);
    }
  }

  private boundaryBoxes(el: El): Box[] {
    const parent = el.$parent as El | undefined;
    if (!parent || is(el, 'bpmn:Participant')) return [];
    return many(parent, 'flowElements')
      .filter((boundary) => is(boundary, 'bpmn:BoundaryEvent') && boundary.get<El | undefined>('attachedToRef') === el)
      .map((boundary) => this.writer.absBoxes.get(idOf(boundary)))
      .filter((boundary): boundary is Box => !!boundary);
  }

  private collectMessageFlows(warnings: EngineWarning[]): MessageFlowEnds[] {
    const { pools } = this;
    const { absBoxes } = this.writer;
    const out: MessageFlowEnds[] = [];
    for (const mf of many(this.root, 'messageFlows')) {
      const source = mf.get<El | undefined>('sourceRef');
      const target = mf.get<El | undefined>('targetRef');
      const sb = source ? absBoxes.get(idOf(source)) : undefined;
      const tb = target ? absBoxes.get(idOf(target)) : undefined;
      if (!source || !target || !sb || !tb) {
        warnings.push({ code: 'DI_NOT_CREATED', elementId: idOf(mf), message: `No DI created for message flow ${idOf(mf)} (endpoint without shape)` });
        continue;
      }
      out.push({ el: mf, source, target, sourceBox: sb, targetBox: tb, sourceOwn: this.boundaryBoxes(source), targetOwn: this.boundaryBoxes(target), sourcePool: poolOf(pools, source), targetPool: poolOf(pools, target) });
    }
    return out;
  }

  private messageJobs(flows: MessageFlowEnds[], views: Map<PoolLayout, MessagePool>): MessageFlowJob[] {
    return flows.map((flow) => ({ ...flow, sourcePool: flow.sourcePool && views.get(flow.sourcePool), targetPool: flow.targetPool && views.get(flow.targetPool) }));
  }

  private messageView(pool: PoolLayout): MessagePool {
    const obstacles: Box[] = [];
    const lines: Segment[] = [];
    const crossable: Segment[] = [];
    for (const diagramElement of pool.di ?? []) {
      const el = diagramElement.get<El | undefined>('bpmnElement');
      if (!el) continue;
      if (is(diagramElement, 'bpmndi:BPMNShape')) {
        const box = this.writer.absBoxes.get(idOf(el));
        if (box && !isContainerShape(diagramElement, el)) obstacles.push(box);
        continue;
      }
      const pts = many(diagramElement, 'waypoint').map((waypoint) => ({ x: waypoint.get<number>('x'), y: waypoint.get<number>('y') }));
      const note = isAnnotationLine(el);
      for (let index = 0; index + 1 < pts.length; index++) {
        lines.push([pts[index]!, pts[index + 1]!]);
        if (!note) crossable.push([pts[index]!, pts[index + 1]!]);
      }
    }
    const depth = pool.scope?.lanes.length ? laneDepth(pool.scope.lanes) : 0;
    return { box: pool.box, obstacles, lines, crossable, contentLeft: pool.box.x + SIZES.participantHeader + depth * SIZES.laneHeader };
  }

  private shiftPool(pool: PoolLayout, dy: number): void {
    if (!dy) return;
    const moveBounds = (bounds: El | undefined): void => {
      if (bounds) bounds.set('y', bounds.get<number>('y') + dy);
    };
    for (const diagramElement of pool.di ?? []) {
      moveBounds(diagramElement.get<El | undefined>('label')?.get<El | undefined>('bounds'));
      if (!is(diagramElement, 'bpmndi:BPMNShape')) {
        for (const waypoint of many(diagramElement, 'waypoint')) {
          waypoint.set('y', waypoint.get<number>('y') + dy);
        }
        continue;
      }
      moveBounds(diagramElement.get<El | undefined>('bounds'));
      const el = diagramElement.get<El | undefined>('bpmnElement');
      const box = el ? this.writer.absBoxes.get(idOf(el)) : undefined;
      if (box) box.y += dy;
    }
    pool.box.y += dy;
    pool.origin.y += dy;
  }

  private restackPools(order: PoolLayout[]): void {
    let top = SIZES.outerMargin;
    for (const pool of order) {
      this.shiftPool(pool, top - pool.box.y);
      top += pool.box.height + SIZES.poolGap;
    }
  }
}
