import { Box, Point, Polyline, type BpmnElement, type Segment } from '../../../model/index.js';
import { Frames } from '../../plane/Frames.js';
import { Semantics } from '../../plane/Semantics.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import { LaneArranger } from '../lanes/LaneArranger.js';
import { MessageFlowRouter, type MessageFlowJob } from '../links/MessageFlowRouter.js';
import type { MessagePool } from '../links/MessageLegs.js';
import { LaneBox } from '../scopes/LaneBox.js';
import { PoolLayouts, type PoolLayout } from '../scopes/PoolLayouts.js';
import { ScopeFrame } from '../scopes/ScopeFrame.js';
import type { ScopePlacer } from '../scopes/ScopePlacer.js';
import type { DiWriter, EngineWarning } from './DiWriter.js';

type MessageFlowEnds = Omit<MessageFlowJob, 'sourcePool' | 'targetPool'> & { sourcePool?: PoolLayout | undefined; targetPool?: PoolLayout | undefined };

export class PoolStacker {
  private static readonly MIN_WIDTH = 300;
  private static readonly MIN_HEIGHT = 150;

  readonly pools = new PoolLayouts();

  constructor(
    private readonly root: BpmnElement,
    private readonly writer: DiWriter,
  ) {}

  private static laneDepth({ scope }: PoolLayout): number {
    return scope?.lanes.length ? LaneBox.depthOf(scope.lanes) : 0;
  }

  private static neededWidth(pool: PoolLayout): number {
    const { LANE_PADDING, LANE_HEADER, PARTICIPANT_HEADER } = ShapeSizes;
    const framed = new ScopeFrame(pool.scope!).framedSize();
    return PARTICIPANT_HEADER + framed.width - framed.left + 2 * LANE_PADDING + PoolStacker.laneDepth(pool) * LANE_HEADER;
  }

  private static heightOf({ scope }: PoolLayout): number {
    return scope!.lanes.length ? scope!.height : Math.max(PoolStacker.MIN_HEIGHT, scope!.height + 2 * ShapeSizes.LANE_PADDING);
  }

  drawPools(placer: ScopePlacer, groups: ReadonlyMap<string, readonly string[]> | undefined): void {
    for (const participant of this.root.list('participants')) {
      this.pools.list.push(this.laidOut(participant, placer, groups));
    }
    const { list } = this.pools;
    const drawn = list.filter((pool) => pool.scope);
    const width = Math.max(PoolStacker.MIN_WIDTH, ...drawn.map(PoolStacker.neededWidth));
    for (const pool of drawn) {
      pool.box.height = PoolStacker.heightOf(pool);
    }
    this.stack(width);
    for (const pool of list) {
      this.write(pool);
    }
  }

  drawMessageFlows(warnings: EngineWarning[]): void {
    const { writer } = this;
    const { list } = this.pools;
    const flows = this.collectMessageFlows(warnings);
    let views = new Map(list.map((pool) => [pool, this.messageView(pool)]));
    const order = new MessageFlowRouter(this.jobsOf(flows, views), list.map((pool) => views.get(pool)!)).poolOrder();
    const reordered = order.map((view) => list.find((pool) => views.get(pool) === view)!);
    if (reordered.some((pool, index) => pool !== list[index])) {
      this.restack(reordered);
      list.splice(0, list.length, ...reordered);
      views = new Map(list.map((pool) => [pool, this.messageView(pool)]));
    }
    for (const route of new MessageFlowRouter(this.jobsOf(flows, views), list.map((pool) => views.get(pool)!)).route()) {
      const name = route.el.get<string | undefined>('name');
      writer.edge(route.el, route.points, name ? MessageFlowRouter.label(route.points, name, route.channelY) : undefined);
    }
  }

  private laidOut(participant: BpmnElement, placer: ScopePlacer, groups: ReadonlyMap<string, readonly string[]> | undefined): PoolLayout {
    const process = participant.peek<BpmnElement>('processRef');
    if (!process) {
      return { participant, box: new Box(0, 0, 0, ShapeSizes.BLACK_BOX_HEIGHT), origin: new Point(0, 0) };
    }
    const scope = placer.layOut(process);
    new LaneArranger(scope, process, groups).apply();
    return { participant, process, scope, box: new Box(0, 0, 0, 0), origin: new Point(0, 0) };
  }

  private stack(width: number): void {
    const { OUTER_MARGIN, PARTICIPANT_HEADER, LANE_HEADER, LANE_PADDING, POOL_GAP } = ShapeSizes;
    let top = OUTER_MARGIN;
    for (const pool of this.pools.list) {
      pool.box = new Box(OUTER_MARGIN, top, width, pool.box.height);
      pool.origin = new Point(pool.box.x + PARTICIPANT_HEADER + PoolStacker.laneDepth(pool) * LANE_HEADER + LANE_PADDING, pool.box.y + (pool.scope?.lanes.length ? 0 : LANE_PADDING));
      top += pool.box.height + POOL_GAP;
    }
  }

  private write(pool: PoolLayout): void {
    const { writer } = this;
    const { box, scope, origin } = pool;
    const first = writer.di.length;
    writer.shape(pool.participant, box, { extra: { isHorizontal: true } });
    if (scope) {
      const laned = scope.lanes.length > 0;
      for (const lane of scope.lanes) {
        lane.stretch(box.width - ShapeSizes.PARTICIPANT_HEADER);
      }
      writer.emitScope(scope, laned ? new Point(origin.x, box.y) : origin);
      for (const lane of scope.lanes) {
        writer.fixLaneShapes(lane, box, box.x + ShapeSizes.PARTICIPANT_HEADER);
      }
    }
    pool.di = writer.di.slice(first);
  }

  private boundaryBoxes(element: BpmnElement): Box[] {
    const { parent } = element;
    if (!parent || element.is('bpmn:Participant')) {
      return [];
    }
    return parent
      .list('flowElements')
      .filter((boundary) => boundary.is('bpmn:BoundaryEvent') && boundary.peek('attachedToRef') === element)
      .flatMap((boundary) => this.writer.absBoxes.get(boundary.id) ?? []);
  }

  private collectMessageFlows(warnings: EngineWarning[]): MessageFlowEnds[] {
    const { absBoxes } = this.writer;
    const flows: MessageFlowEnds[] = [];
    for (const flow of this.root.list('messageFlows')) {
      const source = flow.peek<BpmnElement>('sourceRef');
      const target = flow.peek<BpmnElement>('targetRef');
      const sourceBox = source && absBoxes.get(source.id);
      const targetBox = target && absBoxes.get(target.id);
      if (source && target && sourceBox && targetBox) {
        flows.push({ el: flow, source, target, sourceBox, targetBox, sourceOwn: this.boundaryBoxes(source), targetOwn: this.boundaryBoxes(target), sourcePool: this.pools.of(source), targetPool: this.pools.of(target) });
      } else {
        warnings.push({ code: 'DI_NOT_CREATED', elementId: flow.id, message: `No DI created for message flow ${flow.id} (endpoint without shape)` });
      }
    }
    return flows;
  }

  private jobsOf(flows: readonly MessageFlowEnds[], views: ReadonlyMap<PoolLayout, MessagePool>): MessageFlowJob[] {
    return flows.map((flow) => ({ ...flow, sourcePool: flow.sourcePool && views.get(flow.sourcePool), targetPool: flow.targetPool && views.get(flow.targetPool) }));
  }

  private messageView(pool: PoolLayout): MessagePool {
    const obstacles: Box[] = [];
    const lines: Segment[] = [];
    const crossable: Segment[] = [];
    for (const di of pool.di ?? []) {
      const element = di.peek<BpmnElement>('bpmnElement');
      if (element && di.is('bpmndi:BPMNShape')) {
        const box = this.writer.absBoxes.get(element.id);
        if (box && !Frames.isContainerDi(di, element)) {
          obstacles.push(box);
        }
      } else if (element) {
        const segments = new Polyline(di.list('waypoint').map((waypoint) => new Point(waypoint.get<number>('x'), waypoint.get<number>('y')))).segments();
        lines.push(...segments);
        crossable.push(...(Semantics.isAnnotationLine(element) ? [] : segments));
      }
    }
    return { box: pool.box, obstacles, lines, crossable, contentLeft: pool.box.x + ShapeSizes.PARTICIPANT_HEADER + PoolStacker.laneDepth(pool) * ShapeSizes.LANE_HEADER };
  }

  private shiftPool(pool: PoolLayout, dy: number): void {
    if (!dy) {
      return;
    }
    const moveBounds = (bounds: BpmnElement | undefined): void => bounds?.set('y', bounds.get<number>('y') + dy);
    for (const di of pool.di ?? []) {
      moveBounds(di.peek<BpmnElement>('label')?.peek<BpmnElement>('bounds'));
      if (di.is('bpmndi:BPMNShape')) {
        moveBounds(di.peek<BpmnElement>('bounds'));
        const element = di.peek<BpmnElement>('bpmnElement');
        const box = element && this.writer.absBoxes.get(element.id);
        box?.translate(0, dy);
      } else {
        for (const waypoint of di.list('waypoint')) {
          waypoint.set('y', waypoint.get<number>('y') + dy);
        }
      }
    }
    pool.box.y += dy;
    pool.origin.y += dy;
  }

  private restack(order: readonly PoolLayout[]): void {
    let top = ShapeSizes.OUTER_MARGIN;
    for (const pool of order) {
      this.shiftPool(pool, top - pool.box.y);
      top += pool.box.height + ShapeSizes.POOL_GAP;
    }
  }
}
