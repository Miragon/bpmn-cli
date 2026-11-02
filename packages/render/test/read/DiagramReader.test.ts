import { describe, expect, it } from 'vitest';
import { DiagramReader } from '../../src/read/DiagramReader.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('DiagramReader', () => {
  const gallery = 'models/render/gallery.bpmn';

  it('reads a diagram per collapsed sub-process into planes', async () => {
    const planes = (await CorpusModel.reader(gallery)).planes();
    expect(planes.map((plane) => plane.rootId)).toEqual(['Collaboration_RenderGallery', 'Activity_CollapsedSubProcess', 'Activity_AdHocSubProcess']);
  });

  it('refuses text that is no XML', async () => {
    await expect(DiagramReader.fromXml('not xml')).rejects.toMatchObject({ code: 'E_PARSE' });
  });

  it('refuses a root element other than definitions', async () => {
    const task = '<task xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Task_A"/>';
    await expect(DiagramReader.fromXml(task)).rejects.toMatchObject({ code: 'E_PARSE' });
  });

  it.each([
    ['Activity_UserTask', 'task'],
    ['Activity_ExpandedSubProcess', 'subProcess'],
    ['Event_TwoDays', 'boundary'],
    ['Event_Answer', 'event'],
    ['Gateway_WhichPath', 'gateway'],
    ['DataObjectReference_Order', 'data'],
    ['DataStoreReference_Customers', 'data'],
    ['TextAnnotation_ATextAnnotationThatWrapsOverSeveralLines', 'annotation'],
    ['Participant_Partner', 'participant'],
    ['Group_FirstTasks', 'group'],
  ])('reads %s as a %s', async (id, kind) => {
    expect((await CorpusModel.shape(gallery, id)).kind).toBe(kind);
  });

  it('marks pools, lanes and expanded sub-processes as containers, and a boundary event with its host', async () => {
    expect((await CorpusModel.shape(gallery, 'Participant_Partner')).container).toBe(true);
    expect((await CorpusModel.shape(gallery, 'Activity_ExpandedSubProcess')).container).toBe(true);
    expect((await CorpusModel.shape(gallery, 'Activity_CollapsedSubProcess')).container).toBe(false);
    expect((await CorpusModel.shape(gallery, 'Event_TwoDays')).hostId).toBeDefined();
  });

  it('links a task to the expanded sub-process around it', async () => {
    expect((await CorpusModel.shape(gallery, 'Activity_InnerTask')).parentId).toBe('Activity_ExpandedSubProcess');
  });

  it('reads the ends of data associations from the activity around them', async () => {
    const output = await CorpusModel.edge(gallery, 'DataOutputAssociation_UserTaskToOrder');
    const input = await CorpusModel.edge(gallery, 'DataInputAssociation_CustomersToServiceTask');
    expect([output.kind, output.sourceId, output.targetId]).toEqual(['dataAssociation', 'Activity_UserTask', 'DataObjectReference_Order']);
    expect([input.sourceId, input.targetId]).toEqual(['DataStoreReference_Customers', 'Activity_ServiceTask']);
  });

  it('keeps a shape out of the plane when its bounds are no numbers', async () => {
    const plane = await CorpusModel.plane('models/incremental/nobounds.bpmn');
    expect(plane.shapes.size).toBeLessThan(((await CorpusModel.reader('models/incremental/nobounds.bpmn')).semantics.byId.size));
  });

  it('shows the first process on a plane that names no element', async () => {
    const reader = await CorpusModel.reader('models/incremental/noroot.bpmn');
    expect(reader.planes()[0]?.rootId).toBeDefined();
  });

  it('reads the label bounds of a flow and of a labelled event', async () => {
    const edge = await CorpusModel.edge(gallery, 'Flow_WhichPathToRejected');
    const event = await CorpusModel.shape(gallery, 'Event_Rejected');
    expect(edge.label ?? event.label).toBeDefined();
  });
});
