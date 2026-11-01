import { describe, expect, it } from 'vitest';
import { ImageView, type RenderOptions } from '../../../src/views/image/ImageView.js';
import { Fixtures } from '../../support/Fixtures.js';

const image = async (options: RenderOptions = {}, file = 'models/render/gallery.bpmn') => new ImageView(await Fixtures.read(file), options).answer();

describe('ImageView', () => {
  it('paints the first plane by default', async () => {
    const { svg, plane, problems } = await image();

    expect(svg).toContain('<svg');
    expect(plane).toBeDefined();
    expect(problems).toBeUndefined();
  });

  it('crops to the neighbourhood of an id', async () => {
    const whole = await image();
    const { drawn, width, depth } = await image({ around: 'Activity_InnerTask' });

    expect(drawn).toContain('Activity_InnerTask');
    expect(width).toBeLessThan(whole.width);
    expect(depth).toBe(1);
  });

  it('draws the plane of a collapsed sub-process for its id', async () => {
    expect((await image({ ids: ['Activity_CollapsedSubProcess'] })).plane).toBe('Activity_CollapsedSubProcess');
  });

  it('numbers the layout problems and puts their badges into the image', async () => {
    const { problems, badges, svg } = await image({ problems: true });

    expect(problems?.[0]).toMatchObject({ n: 1, kind: 'crossings' });
    expect(badges.length).toBeGreaterThan(0);
    expect(problems?.filter(({ drawn }) => drawn).map(({ n }) => n)).toEqual(badges);
    expect(svg).toContain('data-badge="1"');
  });

  it('lists only the problems of the crop', async () => {
    const { problems } = await image({ ids: ['Activity_ExpandedSubProcess'], problems: true });

    expect(problems?.length).toBeGreaterThan(0);
    expect(problems?.length).toBeLessThan(13);
  });

  it('answers with a BpmnError when nothing of the crop is drawn', async () => {
    await expect(image({ ids: ['Stray'] }, 'views/groups.bpmn')).rejects.toMatchObject({ code: 'E_NO_MATCH', details: { hint: expect.stringContaining('bpmn layout') } });
    await expect(image({ ids: ['Message_Nope'] })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });

  it('draws a file without a drawing in memory and says so', async () => {
    const { svg, notes } = await image({}, 'models/views/claims.bpmn');

    expect(svg).toContain('Activity_Pay');
    expect(notes[0]).toEqual({ kind: 'no-diagram', ids: [] });
  });

  it('lists the problems of a file drawn in memory without a badge', async () => {
    const { problems, badges } = await image({ problems: true }, 'models/views/claims.bpmn');

    expect(problems?.some(({ kind }) => kind === 'missing')).toBe(true);
    expect(problems?.every(({ drawn }) => !drawn)).toBe(true);
    expect(badges).toEqual([]);
  });
});
