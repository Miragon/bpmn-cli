import { describe, expect, it } from 'vitest';
import { LayoutRequests } from '../../../src/model/diagram/LayoutRequests.js';

describe('LayoutRequests', () => {
  it('splits the sub-processes to expand from those to collapse, in request order', () => {
    const requests = new LayoutRequests();
    requests.expand('sub_events', true);
    requests.expand('sub_adhoc', false);
    requests.expand('sub_inner', true);

    expect(requests.expansion()).toEqual({ expand: ['sub_events', 'sub_inner'], collapse: ['sub_adhoc'] });
  });

  it('lets a later request for the same sub-process replace the earlier one', () => {
    const requests = new LayoutRequests();
    requests.expand('sub_adhoc', true);
    requests.expand('sub_adhoc', false);

    expect(requests.expansion()).toEqual({ expand: [], collapse: ['sub_adhoc'] });
  });

  it('lets the merged requests win over those already held and keeps the rest', () => {
    const held = new LayoutRequests();
    held.expand('sub_adhoc', true);
    held.expand('sub_events', true);
    const other = new LayoutRequests();
    other.expand('sub_adhoc', false);

    held.merge(other);

    expect(held.expansion()).toEqual({ expand: ['sub_events'], collapse: ['sub_adhoc'] });
  });
});
