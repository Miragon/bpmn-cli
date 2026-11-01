import { describe, expect, it } from 'vitest';
import { FullLayout } from '../../../src/drawing/full/FullLayout.js';
import { LayoutRequests } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('FullLayout', () => {
  it('is not ported yet', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');

    expect(() => new FullLayout(document, new LayoutRequests()).draw()).toThrow(/not ported yet/);
  });

  it.todo('holds the 115 scenarios of corpus/layout to main in total, on the full step');
});
