import { describe, expect, it } from 'vitest';
import { DrawingOperationRunner, type DrawnOperation, type FormatResult } from '../../../src/drawing/runners/DrawingOperationRunner.js';
import { DrawnDiagram } from '../../../src/drawing/runners/DrawnDiagram.js';
import { Fixtures } from '../../support/Fixtures.js';

interface Row {
  fixture: string;
  operation: unknown;
  drawnAfterOtherOperations?: boolean;
  answer?: FormatResult | null;
  refused?: string;
}

describe('DrawingOperationRunner', () => {
  const ROWS: Row[] = JSON.parse(Fixtures.text('drawing/runners/main-answers.json'));

  const read = (fixture: string) => Fixtures.read(fixture.includes('/') ? `${fixture}.bpmn` : `drawing/runners/${fixture}.bpmn`);

  function operationsOf(given: unknown): DrawnOperation[] {
    const { model, drawing } = Fixtures.operations([given]);
    return [...model, ...drawing] as DrawnOperation[];
  }

  it('has nothing to run for a layout operation alone', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');

    expect(new DrawingOperationRunner(document).run([{ op: 'layout' }])).toEqual([]);
  });

  it('answers each operation as main does, on its fixture', async () => {
    const answers = await Promise.all(
      ROWS.map(async ({ fixture, operation, drawnAfterOtherOperations }) => {
        const document = await read(fixture);
        try {
          const [answer] = new DrawingOperationRunner(document).run(operationsOf(operation), !drawnAfterOtherOperations);
          return answer ?? null;
        } catch (error) {
          return { refused: (error as { code: string }).code };
        }
      }),
    );

    expect(answers).toEqual(ROWS.map(({ answer, refused }) => (refused ? { refused } : answer)));
  });

  it('runs the operations of a batch in order, each on what the one before left', async () => {
    const document = await read('branching');

    const [first, second] = new DrawingOperationRunner(document).run([{ op: 'color', ids: ['A'], color: 'red' }, { op: 'space', after: 'A' }]);

    expect(first).toMatchObject({ op: 'color', index: 0, colored: ['A'] });
    expect(second).toMatchObject({ op: 'space', index: 1, moved: expect.arrayContaining(['G']) });
  });

  it('writes the drawing back at the end of the batch', async () => {
    const document = await read('branching');
    const before = new DrawnDiagram(document).drawnShape('G').shape.bounds.x;

    new DrawingOperationRunner(document).run([{ op: 'space', after: 'A', by: 100 }]);

    expect(new DrawnDiagram(document).drawnShape('G').shape.bounds.x).toBe(before + 100);
  });

  it('names the position of the operation that refused', async () => {
    const document = await read('branching');

    expect(() => new DrawingOperationRunner(document).run([{ op: 'layout' }, { op: 'tidy' }, { op: 'label', id: 'A', side: 'below' }])).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND', details: expect.objectContaining({ op: 2 }) }));
  });

  it('leaves a refused batch out of the drawing', async () => {
    const document = await read('branching');
    const before = new DrawnDiagram(document).drawnShape('G').shape.bounds.x;

    expect(() => new DrawingOperationRunner(document).run([{ op: 'space', after: 'A' }, { op: 'label', id: 'A', side: 'below' }])).toThrow();
    expect(new DrawnDiagram(document).drawnShape('G').shape.bounds.x).toBe(before);
  });

  it('draws nothing for an order of the flows of a node', async () => {
    const document = await read('branching');

    expect(new DrawingOperationRunner(document).run([{ op: 'order', id: 'G', flows: ['F_no', 'F_yes'] }])).toEqual([]);
  });

  it('names a space command only for the first operation on the file', async () => {
    const place = { op: 'place', ids: ['Activity_ApprovePurchase', 'Gateway_PurchaseApproved'], rowOf: 'Gateway_1hd8x2m', after: 'Gateway_1hd8x2m' } satisfies DrawnOperation;
    const first = await read('models/layout-batch/no-room-merge');
    const second = await read('models/layout-batch/no-room-merge');

    expect(() => new DrawingOperationRunner(first).run([place], true)).toThrow(expect.objectContaining({ details: expect.objectContaining({ command: expect.any(String) }) }));
    expect(() => new DrawingOperationRunner(second).run([{ op: 'tidy' }, place], true)).toThrow(expect.objectContaining({ details: expect.not.objectContaining({ command: expect.any(String) }) }));
  });

  it('refuses a selector on a file without diagram', async () => {
    const document = await Fixtures.read('layout/collab__notes-on-collaboration.bpmn');

    expect(() => new DrawingOperationRunner(document).run([{ op: 'color', branch: 'Flow_1', color: 'red' }])).toThrow(expect.objectContaining({ code: 'E_NO_DIAGRAM' }));
  });
});
