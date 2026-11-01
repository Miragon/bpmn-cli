import { describe, expect, it } from 'vitest';
import { ElementContainer } from '../../../src/views/facts/ElementContainer.js';
import { Fixtures } from '../../support/Fixtures.js';

const claims = () => Fixtures.read('models/views/claims.bpmn');

describe('ElementContainer', () => {
  it('resolves a pool to its process', async () => {
    const container = new ElementContainer(await claims(), 'Participant_Insurer');

    expect(container.element.id).toBe('Process_Claims');
    expect(container.isLane).toBe(false);
  });

  it('holds what lies inside a sub-process, not the sub-process itself', async () => {
    const document = await claims();
    const container = new ElementContainer(document, 'Activity_Assess');

    expect(container.holds(document.tree.require('Activity_CheckPolicy'))).toBe(true);
    expect(container.holds(document.tree.require('Flow_ToRate'))).toBe(true);
    expect(container.holds(document.tree.require('Activity_Assess'))).toBe(false);
    expect(container.holds(document.tree.require('Activity_Pay'))).toBe(false);
  });

  it('holds in a lane its nodes, a nested lane, flows by their source and what a sub-process there holds', async () => {
    const document = await claims();
    const container = new ElementContainer(document, 'Lane_Office');

    expect(container.isLane).toBe(true);
    expect(container.process.id).toBe('Process_Claims');
    expect(container.holds(document.tree.require('Activity_Pay'))).toBe(true);
    expect(container.holds(document.tree.require('Flow_ToAssess'))).toBe(true);
    expect(container.holds(document.tree.require('Activity_CheckPolicy'))).toBe(true);
    expect(container.holds(document.tree.require('Activity_Investigate'))).toBe(false);
    expect(container.holds(document.tree.require('DataObjectReference_ClaimFile'))).toBe(false);
  });

  it('refuses a task and a black box', async () => {
    const document = await claims();

    expect(() => new ElementContainer(document, 'Activity_Pay')).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND' }));
    expect(() => new ElementContainer(document, 'Participant_Customer')).toThrow(expect.objectContaining({ code: 'E_BLACK_BOX' }));
    expect(() => new ElementContainer(document, 'Nowhere')).toThrow(expect.objectContaining({ code: 'E_NOT_FOUND' }));
  });
});
