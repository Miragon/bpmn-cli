import { describe, expect, it } from 'vitest';
import { SvgComposer } from '../../src/compose/SvgComposer.js';
import { Scene } from '../../src/paint/Scene.js';
import { Box } from '../../src/read/Box.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('SvgComposer', () => {
  const box = new Box(100, 100, 200, 50);
  const task = { box, layer: 3, svg: '<g id="task"/>' };

  it('frames the items with a margin of 20 px at scale 1', () => {
    const { width, height, scale, svg } = new SvgComposer([task], undefined, {}).composition();
    expect([width, height, scale]).toEqual([240, 90, 1]);
    expect(svg).toContain('viewBox="80 80 240 90"');
    expect(svg.endsWith('</svg>\n')).toBe(true);
  });

  it('draws an empty white image for no items', () => {
    const { width, height, svg } = new SvgComposer([], undefined, {}).composition();
    expect([width, height]).toEqual([40, 40]);
    expect(svg.match(/\n/g)).toHaveLength(3);
  });

  it('sorts by layer and keeps the order inside a layer', () => {
    const items = [
      { box, layer: 6, svg: '<g id="flow"/>' },
      { box, layer: 3, svg: '<g id="a"/>' },
      { box, layer: 3, svg: '<g id="b"/>' },
    ];
    const { svg } = new SvgComposer(items, undefined, {}).composition();
    expect(svg.indexOf('id="a"')).toBeLessThan(svg.indexOf('id="b"'));
    expect(svg.indexOf('id="b"')).toBeLessThan(svg.indexOf('id="flow"'));
  });

  it('fits context not into the view but draws it where it shows', () => {
    const near = { box: new Box(90, 90, 10, 10), layer: 0, svg: '<g id="near"/>', context: true };
    const far = { box: new Box(1000, 1000, 10, 10), layer: 0, svg: '<g id="far"/>', context: true };
    const { svg } = new SvgComposer([task, near, far], undefined, {}).composition();
    expect(svg).toContain('viewBox="80 80 240 90"');
    expect(svg).toContain('id="near"');
    expect(svg).not.toContain('id="far"');
  });

  it('fits a stub instead of its whole flow', () => {
    const flow = { box: new Box(0, 0, 1000, 10), fitted: new Box(0, 0, 40, 10), layer: 6, svg: '<g id="flow"/>' };
    expect(new SvgComposer([flow], undefined, {}).composition().width).toBe(80);
  });

  it('fits context when nothing else is there', () => {
    const lane = { box, layer: 1, svg: '<g id="lane"/>', context: true };
    expect(new SvgComposer([lane], undefined, {}).composition().width).toBe(240);
  });

  it('scales the size in pixels, not the view', () => {
    const { width, height, scale, svg } = new SvgComposer([task], undefined, { scale: 2 }).composition();
    expect([width, height, scale]).toEqual([480, 180, 2]);
    expect(svg).toContain('viewBox="80 80 240 90"');
  });

  it('takes a scale that is no positive number as 1', () => {
    expect(new SvgComposer([task], undefined, { scale: -1 }).composition().scale).toBe(1);
    expect(new SvgComposer([task], undefined, { scale: Number.NaN }).composition().scale).toBe(1);
  });

  it('shrinks an image longer than the maximum, and only such an image', () => {
    expect(new SvgComposer([task], undefined, { maxSize: 120 }).composition()).toMatchObject({ width: 120, height: 45, scale: 0.5 });
    expect(new SvgComposer([task], undefined, { maxSize: 1000 }).composition().scale).toBe(1);
    expect(new SvgComposer([task], undefined, { maxSize: 0 }).composition().scale).toBe(1);
  });

  it('draws badges above everything and lists those it drew', async () => {
    const plane = await CorpusModel.plane('models/render/gallery.bpmn');
    const { items } = new Scene(plane, undefined);
    const { svg, badges } = new SvgComposer(items, plane, { badges: [{ n: 1, ids: ['Activity_UserTask'] }, { n: 2, ids: ['Gone'] }] }).composition();
    expect(badges).toEqual([1]);
    expect(svg.indexOf('data-badge="1"')).toBeGreaterThan(svg.lastIndexOf('data-label'));
  });
});
