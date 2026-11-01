import { describe, expect, it } from 'vitest';
import { ShapePainter } from '../../src/paint/ShapePainter.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('ShapePainter', () => {
  const gallery = 'models/render/gallery.bpmn';

  it.each([
    ['Event_TwoDays', '<circle'],
    ['Gateway_WhichPath', 'stroke-linejoin="round"'],
    ['Activity_UserTask', 'rx="10"'],
    ['Participant_Partner', 'stroke-width="1.5"'],
    ['DataObjectReference_Order', '<path'],
    ['TextAnnotation_ATextAnnotationThatWrapsOverSeveralLines', 'text-anchor="start"'],
    ['Group_FirstTasks', 'stroke-dasharray="10 4 2 4"'],
  ])('paints %s by its kind', async (id, mark) => {
    expect(new ShapePainter(await CorpusModel.shape(gallery, id)).svg()).toContain(mark);
  });

  it('paints a lane', async () => {
    const plane = await CorpusModel.plane('models/step1/lane-label.bpmn');
    const lane = [...plane.shapes.values()].find((shape) => shape.kind === 'lane');
    expect(new ShapePainter(lane!).svg()).toContain('<rect');
  });

  it('labels an event at the bounds the DI gives', async () => {
    const shape = await CorpusModel.shape(gallery, 'Event_Rejected');
    const label = new ShapePainter(shape).label();
    expect(label?.box.y).toBe(Math.round(shape.label!.y));
  });

  it('puts a label without bounds below its shape', async () => {
    const shape = await CorpusModel.shape('../packages/render/test/golden/fixtures/data.bpmn', 'DataObjectReference_List');
    expect(new ShapePainter(shape).label()?.box.y).toBe(Math.round(shape.bounds.bottom));
  });

  it('puts the label of a group at its top, from its category value', async () => {
    const shape = await CorpusModel.shape(gallery, 'Group_FirstTasks');
    expect(new ShapePainter(shape).label()?.svg).toContain('data-label="Group_FirstTasks"');
  });

  it('labels no task outside its shape, and no event without a name', async () => {
    expect(new ShapePainter(await CorpusModel.shape(gallery, 'Activity_UserTask')).label()).toBeUndefined();
    expect(new ShapePainter(await CorpusModel.shape(gallery, 'Event_MessageStartInEventSubProcess')).label()).toBeUndefined();
  });

  it('draws an element of no kind it knows as a named box', async () => {
    const shape = await CorpusModel.shape('../packages/render/test/golden/fixtures/data.bpmn', 'Category_Odd');
    expect(new ShapePainter(shape).svg()).toContain('fill="none" stroke="#22242a" stroke-width="1"');
  });
});
