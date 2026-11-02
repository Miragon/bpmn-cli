import { describe, expect, it } from 'vitest';
import { DrawnDiagram } from '../../../src/drawing/runners/DrawnDiagram.js';
import { RoomHint } from '../../../src/drawing/runners/RoomHint.js';
import { ShapePlacement } from '../../../src/drawing/runners/ShapePlacement.js';
import type { PlaceOperation } from '../../../src/operations/index.js';
import { BpmnError } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('RoomHint', () => {
  const INTO_THE_GATEWAY: PlaceOperation = { op: 'place', ids: ['Activity_ApprovePurchase', 'Gateway_PurchaseApproved'], rowOf: 'Gateway_1hd8x2m', after: 'Gateway_1hd8x2m' };

  async function refusal(operation: PlaceOperation, asFile: boolean, attempted?: () => string[]): Promise<BpmnError> {
    const diagram = new DrawnDiagram(await Fixtures.read('models/layout-batch/no-room-merge.bpmn'));
    const place = attempted ?? ((): string[] => new ShapePlacement(diagram, operation, diagram.snapshot(), []).run());
    try {
      new RoomHint(diagram, operation, asFile).run(place);
    } catch (error) {
      return error as BpmnError;
    }
    throw new Error('expected a refusal');
  }

  it('hands the outcome of a place that fits through', async () => {
    const diagram = new DrawnDiagram(await Fixtures.read('drawing/runners/branching.bpmn'));

    expect(new RoomHint(diagram, { op: 'place', ids: ['A'], columnOf: 'A' }, true).run(() => ['flow'])).toEqual(['flow']);
  });

  it('names the space run that makes the room, as a command on the file', async () => {
    const { details, code } = await refusal(INTO_THE_GATEWAY, true);

    expect(code).toBe('E_NO_ROOM');
    expect(details['command']).toBe('bpmn space <file> --after Gateway_1hd8x2m --by 2col');
    expect(details['ops']).toEqual([{ op: 'space', after: 'Gateway_1hd8x2m', by: '2col' }]);
    expect(details.hint).toContain('(checked: the place fits then)');
  });

  it('names only the batch operation when earlier operations changed the drawing', async () => {
    const { details } = await refusal(INTO_THE_GATEWAY, false);

    expect(details['command']).toBeUndefined();
    expect(details.hint).toContain('in this batch, put {"op":"space"');
  });

  it('names the shapes to move first when no space run helps', async () => {
    const { details } = await refusal({ op: 'place', ids: ['Activity_0f3j5ny'], columnOf: 'StartEvent_1', rowOf: 'StartEvent_1' }, true);

    expect(details.hint).toMatch(/^No space-tool run makes this room \(the request names no column or row to make room at\)/);
  });

  it('tries the columns after what flows into a before target', async () => {
    const diagram = new DrawnDiagram(await Fixtures.read('drawing/runners/split.bpmn'));
    const operation: PlaceOperation = { op: 'place', ids: ['B2'], rowOf: 'A1', before: 'A2' };
    const attempt = (): string[] => new ShapePlacement(diagram, operation, diagram.snapshot(), []).run();

    expect(() => new RoomHint(diagram, operation, true).run(attempt)).toThrow(expect.objectContaining({ code: 'E_NO_ROOM', details: expect.objectContaining({ ops: [{ op: 'space', after: 'A1', by: '1col' }] }) }));
  });

  it('tries rows below the target of a below', async () => {
    const diagram = new DrawnDiagram(await Fixtures.read('drawing/runners/branching.bpmn'));
    const operation: PlaceOperation = { op: 'place', ids: ['E2'], below: 'E' };
    const refused = (): string[] => {
      throw BpmnError.model('E_NO_ROOM', 'no', { related: ['E2', 'C'] });
    };

    expect(() => new RoomHint(diagram, operation, true).run(refused)).toThrow(expect.objectContaining({ details: expect.objectContaining({ ops: [expect.objectContaining({ below: 'E' })] }) }));
  });

  it('passes any other refusal on as it is', async () => {
    const failure = BpmnError.model('E_WRONG_KIND', 'no');

    await expect(refusal(INTO_THE_GATEWAY, true, () => { throw failure; })).resolves.toBe(failure);
  });

  it('restores the drawing it tried its runs on', async () => {
    const diagram = new DrawnDiagram(await Fixtures.read('models/layout-batch/no-room-merge.bpmn'));
    const before = diagram.snapshot();

    expect(() => new RoomHint(diagram, INTO_THE_GATEWAY, true).run(() => new ShapePlacement(diagram, INTO_THE_GATEWAY, diagram.snapshot(), []).run())).toThrow();
    expect(before.changedShapes()).toEqual([]);
  });
});
