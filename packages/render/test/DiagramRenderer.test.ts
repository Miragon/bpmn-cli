import { describe, expect, it } from 'vitest';
import { DiagramRenderer } from '../src/DiagramRenderer.js';
import { CorpusModel } from './golden/CorpusModel.js';

describe('DiagramRenderer', () => {
  const gallery = 'models/render/gallery.bpmn';
  const fromCorpus = (path: string): Promise<DiagramRenderer> => DiagramRenderer.fromXml(CorpusModel.xml(path));
  const fromFixture = (name: string): Promise<DiagramRenderer> => DiagramRenderer.fromXml(CorpusModel.fixture(name));

  it('lists the planes of a file with collapsed sub-processes', async () => {
    expect((await fromCorpus(gallery)).planes).toEqual(['Collaboration_RenderGallery', 'Activity_CollapsedSubProcess', 'Activity_AdHocSubProcess']);
  });

  it('draws the first plane unless told otherwise, with size, scale and drawn ids', async () => {
    const image = (await fromCorpus(gallery)).svg();
    expect(image.plane).toBe('Collaboration_RenderGallery');
    expect(image.svg).toContain(`width="${image.width}" height="${image.height}"`);
    expect(image.scale).toBe(1);
    expect(image.drawn).toContain('Activity_UserTask');
    expect(image.notes).toEqual([]);
  });

  it('draws the same bytes twice', async () => {
    const first = (await fromCorpus(gallery)).svg({ plane: 'Activity_CollapsedSubProcess' });
    const second = (await fromCorpus(gallery)).svg({ plane: 'Activity_CollapsedSubProcess' });
    expect(second.svg).toBe(first.svg);
  });

  it('draws a parsed tree without parsing it again', async () => {
    const reader = await CorpusModel.reader(gallery);
    const definitions = (reader as unknown as { definitions: { value(key: string): unknown } }).definitions;
    const tree = (definitions as unknown as { object: object }).object;
    expect(DiagramRenderer.fromDefinitions(tree).svg().svg).toBe((await fromCorpus(gallery)).svg().svg);
  });

  it('draws the plane of a collapsed sub-process', async () => {
    const image = (await fromCorpus(gallery)).svg({ plane: 'Activity_CollapsedSubProcess' });
    expect(image.plane).toBe('Activity_CollapsedSubProcess');
  });

  it('refuses a plane no element has, and an element without a plane', async () => {
    const diagram = await fromCorpus(gallery);
    expect(() => diagram.svg({ plane: 'Nothing' })).toThrowError(expect.objectContaining({ code: 'E_NOT_FOUND', element: 'Nothing' }));
    expect(() => diagram.svg({ plane: 'Activity_UserTask' })).toThrowError(expect.objectContaining({ code: 'E_WRONG_KIND' }));
  });

  it('notes a file without a diagram and draws an empty image', async () => {
    const image = (await fromFixture('no-diagram.bpmn')).svg();
    expect(image.plane).toBeUndefined();
    expect(image.notes).toEqual([{ kind: 'no-diagram', ids: [] }]);
    expect([image.width, image.height]).toEqual([40, 40]);
  });

  it('notes a shape whose bounds are no numbers as undrawn', async () => {
    const image = (await fromCorpus('models/incremental/nan.bpmn')).svg();
    expect(image.notes).toEqual([{ kind: 'undrawn', ids: ['C'] }]);
    expect(image.drawn).not.toContain('C');
  });

  it('notes coordinates beyond a million and leaves the element out', async () => {
    const image = (await fromFixture('broken.bpmn')).svg({ plane: 'Process_Far' });
    expect(image.notes).toContainEqual({ kind: 'broken-coordinates', ids: ['Task_Beyond'] });
    expect(image.drawn).toEqual(['Task_Near']);
  });

  it('notes broken label bounds and still draws the element', async () => {
    const image = (await fromFixture('broken.bpmn')).svg({ plane: 'Process_Label' });
    expect(image.notes).toContainEqual({ kind: 'broken-labels', ids: ['Event_Label', 'Flow_Label'] });
    expect(image.drawn).toContain('Event_Label');
  });

  it('refuses a plane on which everything has broken coordinates', async () => {
    const diagram = await fromFixture('broken.bpmn');
    expect(() => diagram.svg({ plane: 'Process_Broken' })).toThrowError(expect.objectContaining({ code: 'E_RENDER', element: 'Process_Broken' }));
  });

  it('notes an empty plane', async () => {
    const { notes } = (await fromFixture('broken.bpmn')).svg({ plane: 'Process_Empty' });
    expect(notes).toEqual([{ kind: 'empty-plane', ids: ['Process_Empty'] }]);
  });

  it('crops to the fit, with the flows between its ids, and picks their plane', async () => {
    const image = (await fromCorpus(gallery)).svg({ fit: ['Event_InnerStart', 'Activity_InnerTask', 'Event_InnerStart'] });
    expect(image.plane).toBe('Collaboration_RenderGallery');
    expect(image.drawn).toHaveLength(3);
    expect(image.width).toBeLessThan((await fromCorpus(gallery)).svg().width);
  });

  it('notes ids of the fit on another plane or on none', async () => {
    const { notes } = (await fromFixture('broken.bpmn')).svg({ fit: ['Event_Label', 'Nothing', 'Task_Near'] });
    expect(notes).toContainEqual({ kind: 'fit-on-other-plane', ids: ['Task_Near'] });
    expect(notes).toContainEqual({ kind: 'fit-not-drawn', ids: ['Nothing'] });
  });

  it('refuses a fit with nothing on the plane or on any plane', async () => {
    const diagram = await fromCorpus(gallery);
    expect(() => diagram.svg({ fit: ['Nothing'] })).toThrowError(expect.objectContaining({ code: 'E_NO_MATCH', element: 'Nothing' }));
    expect(() => diagram.svg({ plane: 'Activity_CollapsedSubProcess', fit: ['Activity_UserTask'] })).toThrowError(expect.objectContaining({ code: 'E_NO_MATCH' }));
  });

  it('draws badges and says which it drew', async () => {
    const { badges, svg } = (await fromCorpus(gallery)).svg({ badges: [{ n: 4, ids: ['Activity_UserTask'] }] });
    expect(badges).toEqual([4]);
    expect(svg).toContain('data-badge="4"');
  });
});
