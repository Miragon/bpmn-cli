import { describe, expect, it } from 'vitest';
import { FullLayout } from '../../../src/drawing/full/FullLayout.js';
import { LayoutRequests } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('FullLayout', () => {
  it('redraws a model and names no warning when every shape has a home', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');

    expect(new FullLayout(document, new LayoutRequests()).draw().warnings).toEqual([]);
  });
});
