import { describe, expect, it } from 'vitest';
import { TopWays } from '../../../../src/drawing/full/trials/TopWays.js';
import { Box, Point } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('TopWays', () => {
  it('counts each pair of crossing lines once', () => {
    const line = [new Point(0, 50), new Point(100, 50), new Point(0, 50)];

    expect(TopWays.crossingPairs([line], [[new Point(50, 0), new Point(50, 100)]])).toBe(1);
    expect(TopWays.crossingPairs([line], [[new Point(50, 60), new Point(50, 100)]])).toBe(0);
  });

  function sketched(onTop: boolean) {
    const sketch = new ScopeSketch().node('task', 'host', 0, 200).boundary('event', 'host', 40, { onTop, name: 'Late' }).node('task', 'target', 300, 0).flow('event', 'target');
    const edge = sketch.edge('event', 'target');
    const y = sketch.at('event').box.y;
    edge.points = onTop ? [new Point(58, y), new Point(58, 40), new Point(300, 40)] : [new Point(58, 280), new Point(58, 320), new Point(250, 320), new Point(250, 40), new Point(300, 40)];
    edge.runsAbove = onTop;
    return { sketch, ways: new TopWays(sketch.layout(), [sketch.at('event')]) };
  }

  it('finds a way on the bottom border worth trying when it runs a detour', () => {
    const { sketch, ways } = sketched(false);

    ways.look();

    expect(ways.ways.get(sketch.at('event'))).toMatchObject({ worth: true, up: false, bends: 3 });
  });

  it('finds a way worth trying when its flow cuts a shape or a label', () => {
    const { sketch } = sketched(false);
    sketch.edge('event', 'target').points = [new Point(58, 280), new Point(58, 40), new Point(300, 40)];
    sketch.node('task', 'blocker', 8, 100);
    const ways = new TopWays(sketch.layout(), [sketch.at('event')]);

    ways.look();

    expect(ways.ways.get(sketch.at('event'))?.worth).toBe(true);
    expect(ways.linkCrossings).toBe(0);
  });

  it('holds a label on another line or shape against the way on the top border', () => {
    const { sketch, ways } = sketched(true);
    const other = sketch.at('target');
    other.box = new Box(60, 150, 100, 80);

    ways.look();

    expect(ways.ways.get(sketch.at('event'))?.labelClear).toBe(false);
  });

  it('judges a way on the top border by leaving upwards, with line and label clear', () => {
    const { sketch, ways } = sketched(true);

    ways.look();

    expect(ways.ways.get(sketch.at('event'))).toMatchObject({ up: true, clearOfLines: true, labelClear: true, worth: false });
  });
});
