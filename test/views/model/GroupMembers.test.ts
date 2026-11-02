import { describe, expect, it } from 'vitest';
import { GroupMembers } from '../../../src/views/model/GroupMembers.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('GroupMembers', () => {
  it('reads the members of a group from its category value', async () => {
    expect(new GroupMembers(await Fixtures.read('views/groups.bpmn')).of().get('Group_Category')).toEqual(['Invoice']);
  });

  it('takes what the box of a group holds when nothing references its category value', async () => {
    expect(new GroupMembers(await Fixtures.read('views/groups.bpmn')).of().get('Group_Box')).toEqual(['Boxed']);
  });

  it('leaves a group around nothing empty', async () => {
    expect(new GroupMembers(await Fixtures.read('views/groups.bpmn')).of().get('Group_Nothing')).toEqual([]);
  });

  it('finds no group in a model without one', async () => {
    expect(new GroupMembers(await Fixtures.read('models/views/claims.bpmn')).of().size).toBe(0);
  });
});
