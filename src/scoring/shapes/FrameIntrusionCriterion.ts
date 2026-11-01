import type { BpmnElement } from '../../model/index.js';
import type { DrawnPlane } from '../plane/DrawnPlane.js';
import type { DrawnShape } from '../plane/DrawnShape.js';
import { ElementHomes } from '../plane/ElementHomes.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

interface Home {
  el: BpmnElement;
  scopes: BpmnElement[];
  host: BpmnElement | undefined;
  process: BpmnElement;
}

export class FrameIntrusionCriterion extends ScoringCriterion {
  readonly kinds = ['frameIntrusion'] as const;

  private static homeOf({ el, isPool, isLane }: DrawnShape): Home | undefined {
    const scopes = ElementHomes.scopesOf(el);
    const process = scopes.at(-1);
    if (isPool || isLane || el.is('bpmn:Group') || !process?.is('bpmn:Process')) {
      return undefined;
    }
    return { el, scopes, process, host: el.peek<BpmnElement>('attachedToRef') };
  }

  private static centreIsInside(shape: DrawnShape, frame: DrawnShape): boolean {
    const { x, y } = shape.bounds.center;
    return x > frame.bounds.x && x < frame.bounds.right && y > frame.bounds.y && y < frame.bounds.bottom;
  }

  private static laneIsHome(homes: ElementHomes, home: Home, lane: BpmnElement): boolean {
    const listed = [home.el, home.host, ...home.scopes.filter((scope) => scope.is('bpmn:SubProcess'))].flatMap((candidate) => homes.lanes.get(candidate?.id) ?? []);
    return listed.length ? listed.some((own) => ElementHomes.laneChainOf(own).includes(lane)) : homes.processOf(lane) === home.process;
  }

  private static frameIsHome(homes: ElementHomes, home: Home, frame: DrawnShape): boolean {
    if (frame.isPool) {
      return frame.el.peek<BpmnElement>('processRef') === home.process;
    }
    if (frame.isLane) {
      return FrameIntrusionCriterion.laneIsHome(homes, home, frame.el);
    }
    return frame.el === home.host || home.scopes.includes(frame.el) || (!!home.host && ElementHomes.scopesOf(home.host).includes(frame.el));
  }

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const shape of plane.shapes) {
      const home = FrameIntrusionCriterion.homeOf(shape);
      const foreign = home ? plane.frames.filter((frame) => frame !== shape && FrameIntrusionCriterion.centreIsInside(shape, frame) && !FrameIntrusionCriterion.frameIsHome(plane.homes, home, frame)) : [];
      for (const frame of foreign) {
        if (!ElementHomes.scopesOf(frame.el).includes(shape.el)) {
          report.add('frameIntrusion', `${shape.id}@${frame.id}`, [shape.id, frame.id]);
        }
      }
    }
  }
}
