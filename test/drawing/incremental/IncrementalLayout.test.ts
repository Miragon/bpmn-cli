import { describe, expect, it } from 'vitest';
import { DrawingSnapshot } from '../../../src/drawing/DrawingSnapshot.js';
import { IncrementalLayout } from '../../../src/drawing/incremental/IncrementalLayout.js';
import { ChangeSet } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('IncrementalLayout', () => {
  it('is not ported yet', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');

    await expect(new IncrementalLayout(document, DrawingSnapshot.of(document)).place(new ChangeSet())).rejects.toThrow(/not ported yet/);
  });

  it.todo('places what the ChangeSet names and leaves the rest of the drawing, on the incremental step');
});
