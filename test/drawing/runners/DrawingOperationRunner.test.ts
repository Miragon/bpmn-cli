import { describe, expect, it } from 'vitest';
import { DrawingOperationRunner } from '../../../src/drawing/runners/DrawingOperationRunner.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DrawingOperationRunner', () => {
  it('has nothing to run for a layout operation alone', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');

    expect(new DrawingOperationRunner(document).run([{ op: 'layout' }])).toEqual([]);
  });

  it.todo('runs the drawing operations of a batch in order, on the runners step');
});
