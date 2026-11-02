import { Point, Polyline } from '../../../model/index.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { GNode } from '../scopes/GNode.js';
import type { RoutingArea } from './RoutingArea.js';

export class FlowPaths {
  private static readonly HOOK_DEPTH = 15;
  private static readonly SLOT_REACH = 30;

  constructor(private readonly area: RoutingArea) {}

  private static columnGap(): number {
    return ShapeSizes.GAPS.hGap / 2;
  }

  bottomSlot(node: GNode, length: number): number {
    const candidates = node.bottomCandidates();
    const { boxes, usedBottom } = this.area;
    const isClear = (slotX: number): boolean => !new Polyline([new Point(slotX, node.box.bottom), new Point(slotX, node.box.bottom + length)]).hitsAny(boxes, [node.box]);
    return candidates.find((slotX) => isClear(slotX) && !usedBottom.taken(node, slotX)) ?? candidates.find(isClear) ?? candidates[0]!;
  }

  exitToBelow(source: GNode, exitX: number, channelY: number): Point[] {
    const { box } = source;
    const { boxes } = this.area;
    const direct = [new Point(exitX, box.bottom), new Point(exitX, channelY)];
    if (!new Polyline(direct).hitsAny(boxes, [box])) {
      return direct;
    }
    const gapX = box.right + FlowPaths.columnGap();
    const sideY = box.y + box.height * 0.75;
    const viaGap = [new Point(box.right, sideY), new Point(gapX, sideY), new Point(gapX, channelY)];
    return new Polyline(viaGap).hitsAny(boxes, [box]) ? direct : viaGap;
  }

  hookFromBelow(target: GNode, fromY: number): Point[] {
    const { box } = target;
    const { boxes } = this.area;
    const slotX = this.bottomSlot(target, FlowPaths.SLOT_REACH);
    const hookY = box.bottom + FlowPaths.HOOK_DEPTH;
    const direct = [new Point(slotX, fromY), new Point(slotX, box.bottom)];
    if (fromY <= hookY || !new Polyline(direct).hitsAny(boxes, [box])) {
      return direct;
    }
    for (const gapX of [box.right + FlowPaths.columnGap(), box.x - FlowPaths.columnGap()]) {
      const path = [new Point(gapX, fromY), new Point(gapX, hookY), new Point(slotX, hookY), new Point(slotX, box.bottom)];
      if (!new Polyline(path).hitsAny(boxes, [box])) {
        return path;
      }
    }
    return direct;
  }

  channelFor(fromX: number, toX: number, base: number): number {
    return this.area.channels.claim(fromX, toX, base, ShapeSizes.GAPS.loopGap / 2);
  }

  channelRoute(source: GNode, target: GNode): Point[] {
    const base = this.area.spanBottom(source.layer, target.layer) + ShapeSizes.GAPS.loopGap;
    return this.throughChannel(source, target, this.channelFor(source.exitX, target.box.x - 20, base));
  }

  throughChannel(source: GNode, target: GNode, channelY: number): Point[] {
    return [...this.exitToBelow(source, source.exitX, channelY), ...this.hookFromBelow(target, channelY)];
  }
}
