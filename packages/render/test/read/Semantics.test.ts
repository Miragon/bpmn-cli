import { describe, expect, it } from 'vitest';
import { Semantics } from '../../src/read/Semantics.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('Semantics', () => {
  it('finds semantic elements by id but no DI', async () => {
    const { semantics } = await CorpusModel.reader('models/render/gallery.bpmn');
    expect(semantics.byId.has('Activity_UserTask')).toBe(true);
    expect(semantics.byId.has('BPMNShape_Activity_UserTask')).toBe(false);
  });

  it('counts an ad-hoc sub-process and a transaction as sub-processes, a task not', async () => {
    const shape = (id: string) => CorpusModel.shape('models/render/gallery.bpmn', id);
    expect(Semantics.isSubProcess((await shape('Activity_AdHocSubProcess')).element)).toBe(true);
    expect(Semantics.isSubProcess((await shape('Activity_Transaction')).element)).toBe(true);
    expect(Semantics.isSubProcess((await shape('Activity_UserTask')).element)).toBe(false);
  });

  it('puts a flow node into its deepest lane', async () => {
    const { semantics } = await CorpusModel.reader('models/step1/lane-label.bpmn');
    expect(semantics.laneOf.size).toBeGreaterThan(0);
    expect([...semantics.laneOf.values()].every((laneId) => semantics.laneProcess.has(laneId))).toBe(true);
  });

  it('knows the scope of a task inside a sub-process and the pool of a process', async () => {
    const { semantics } = await CorpusModel.reader('models/render/gallery.bpmn');
    expect(semantics.scopeOf.get('Activity_InnerTask')?.id).toBe('Activity_ExpandedSubProcess');
    expect(semantics.poolOfProcess.get('Process_RenderGallery')).toBe('Participant_RenderGallery');
    expect(semantics.collaboration?.id).toBe('Collaboration_RenderGallery');
  });

  it('knows the scope of an annotation in a collaboration', async () => {
    const { semantics } = await CorpusModel.reader('models/incremental/collabnote.bpmn');
    const scopes = [...semantics.scopeOf.values()].map((scope) => scope.type);
    expect(scopes).toContain('bpmn:Collaboration');
  });
});
