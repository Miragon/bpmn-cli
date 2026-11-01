import { describe, expect, it } from 'vitest';
import { MessageFlowRouter, type MessageFlowJob } from '../../../../src/drawing/full/links/MessageFlowRouter.js';
import type { MessagePool } from '../../../../src/drawing/full/links/MessageLegs.js';
import { Box, Point } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('MessageFlowRouter', () => {
  const pool = (y: number, obstacles: Box[] = []): MessagePool => ({ box: new Box(0, y, 1000, 200), obstacles, lines: [], contentLeft: 30 });

  function job(id: string, source: Box, target: Box, sourcePool: MessagePool | undefined, targetPool: MessagePool | undefined, sourceType = 'bpmn:Task', targetType = 'bpmn:Task'): MessageFlowJob {
    return { el: ScopeSketch.element('bpmn:MessageFlow', id), source: ScopeSketch.element(sourceType, `${id}_s`), target: ScopeSketch.element(targetType, `${id}_t`), sourceBox: source, targetBox: target, sourceOwn: [], targetOwn: [], sourcePool, targetPool };
  }

  it('routes down out of one element, along the gap, down into the other', () => {
    const [source, target] = [new Box(100, 50, 100, 80), new Box(600, 350, 100, 80)];
    const [upper, lower] = [pool(0, [source]), pool(280, [target])];

    const [route] = new MessageFlowRouter([job('flow', source, target, upper, lower)], [upper, lower]).route();

    expect(route!.points).toHaveLength(4);
    expect(route!.channelY).toBeGreaterThan(200);
    expect(route!.channelY).toBeLessThan(280);
  });

  it('keeps a straight flow straight with its label in the middle of the gap', () => {
    const [source, target] = [new Box(100, 50, 100, 80), new Box(100, 350, 100, 80)];
    const [upper, lower] = [pool(0, [source]), pool(280, [target])];

    const [route] = new MessageFlowRouter([job('flow', source, target, upper, lower)], [upper, lower]).route();

    expect(route!.points).toHaveLength(2);
    expect(MessageFlowRouter.label(route!.points, 'order', route!.channelY).y).toBeLessThan(route!.channelY!);
  });

  it('routes a flow between far pools around the right of them all', () => {
    const [source, target] = [new Box(100, 50, 100, 80), new Box(100, 650, 100, 80)];
    const pools = [pool(0, [source]), pool(280), pool(560, [target])];

    const [route] = new MessageFlowRouter([job('flow', source, target, pools[0], pools[2])], pools).route();

    expect(Math.max(...route!.points.map((point) => point.x))).toBeGreaterThan(1000);
  });

  it('docks a flow from a pool at the other end, and one between two pools inside both', () => {
    const [upper, lower] = [pool(0), pool(280)];
    const target = new Box(600, 350, 100, 80);

    const [toTask, poolToPool] = new MessageFlowRouter([job('one', upper.box, target, upper, lower, 'bpmn:Participant'), job('two', upper.box, lower.box, upper, lower, 'bpmn:Participant', 'bpmn:Participant')], [upper, lower]).route();

    expect(toTask!.points[0]!.x).toBe(650);
    expect(poolToPool!.points[0]!.x).toBeGreaterThan(0);
  });

  it('gives crossing flows in one gap the order without a crossing', () => {
    const boxes = [new Box(100, 50, 100, 80), new Box(600, 50, 100, 80), new Box(600, 350, 100, 80), new Box(100, 350, 100, 80)];
    const [upper, lower] = [pool(0, boxes.slice(0, 2)), pool(280, boxes.slice(2))];

    const routes = new MessageFlowRouter([job('one', boxes[0]!, boxes[2]!, upper, lower), job('two', boxes[1]!, boxes[3]!, upper, lower)], [upper, lower]).route();

    expect(routes[0]!.channelY).not.toBe(routes[1]!.channelY);
  });

  it('prefers the order whose flows cut the fewest shapes and keeps the declared one on a tie', () => {
    const blocker = new Box(100, 20, 100, 60);
    const source = new Box(100, 120, 100, 60);
    const target = new Box(100, 340, 100, 60);
    const [lower, upper] = [pool(0, [blocker, source]), pool(280, [target])];
    const order = new MessageFlowRouter([job('flow', source, target, lower, upper)], [lower, upper]);
    const tied = new MessageFlowRouter([job('flow', target, source, upper, lower)], [upper, lower]);

    expect(order.poolOrder()).toEqual([lower, upper]);
    expect(tied.poolOrder()).toHaveLength(2);
    expect(new MessageFlowRouter([], [lower, upper]).poolOrder()).toEqual([lower, upper]);
  });

  it('puts a label beside a vertical leg when no level leg exists', () => {
    const label = MessageFlowRouter.label([new Point(100, 0), new Point(100, 80)], 'a message');

    expect(label.x).toBe(106);
    expect(label.y).toBeLessThan(40);
  });
});
