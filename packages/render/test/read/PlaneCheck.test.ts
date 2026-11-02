import { describe, expect, it } from 'vitest';
import { DiagramReader } from '../../src/read/DiagramReader.js';
import { PlaneCheck } from '../../src/read/PlaneCheck.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('PlaneCheck', () => {
  async function checkOf(path: string) {
    const reader = await CorpusModel.reader(path);
    const planes = reader.planes();
    return { planes, check: new PlaneCheck(reader.semantics, planes) };
  }

  it('leaves a sound plane as it is', async () => {
    const { planes, check } = await checkOf('models/render/gallery.bpmn');
    const sane = check.sane(planes[0]!);
    expect(sane).toEqual({ plane: planes[0], broken: [], labels: [] });
  });

  it('takes a shape with broken coordinates out of the plane', async () => {
    const reader = await DiagramReader.fromXml(CorpusModel.fixture('broken.bpmn'));
    const planes = reader.planes();
    const { plane, broken } = new PlaneCheck(reader.semantics, planes).sane(planes[1]!);
    expect(broken).toEqual(['Task_Far', 'Flow_Far']);
    expect(plane.shapes.size + plane.edges.size).toBe(0);
  });

  it('counts a shape whose bounds are no numbers as undrawn on its plane', async () => {
    const { planes, check } = await checkOf('models/incremental/nan.bpmn');
    expect(check.undrawn(planes[0]!)).toEqual(['C']);
  });

  it('counts each element on the plane it belongs to', async () => {
    const reader = await DiagramReader.fromXml(CorpusModel.fixture('undrawn.bpmn'));
    const planes = reader.planes();
    const check = new PlaneCheck(reader.semantics, planes);
    expect(check.undrawn(planes[0]!).sort()).toEqual(['Flow_Messages', 'Lane_Sales', 'Note_Pool', 'Participant_Other', 'Task_Inside', 'Task_Pool']);
    expect(check.undrawn(planes[1]!)).toEqual(['Task_Collapsed']);
  });

  it('finds no plane for what a diagram of its process would show', async () => {
    const reader = await DiagramReader.fromXml(CorpusModel.fixture('undrawn.bpmn'));
    const planes = reader.planes();
    const undrawn = planes.flatMap((plane) => new PlaneCheck(reader.semantics, planes).undrawn(plane));
    expect(undrawn).not.toContain('Task_Unseen');
  });

  it('finds nothing undrawn in a complete diagram', async () => {
    const { planes, check } = await checkOf('models/render/gallery.bpmn');
    expect(planes.flatMap((plane) => check.undrawn(plane))).toEqual([]);
  });
});
