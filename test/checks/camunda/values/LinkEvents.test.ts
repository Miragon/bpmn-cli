import { describe, expect, it } from 'vitest';
import { LinkEvents } from '../../../../src/checks/camunda/values/LinkEvents.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('LinkEvents', () => {
  const linksOf = async (path: string) => {
    const document = await Fixtures.read(path);
    const linkName = (node: Parameters<typeof document.scopes.flowNodes>[0]) => node.list('eventDefinitions')[0]?.peek<string>('name');
    return new LinkEvents(document, document.scopes.flowNodes(document.tree.require('P')), linkName);
  };

  it('finds the catching event of a link name', async () => {
    const links = await linksOf('engine/structure/link-catch-without-a-throw.bpmn');

    expect(links.catchNamed('Jump')?.id).toBe('L');
    expect(links.catchNamed('Elsewhere')).toBeUndefined();
  });

  it('finds no duplicate and no unmatched throw beside one catching event', async () => {
    const links = await linksOf('engine/structure/link-catch-without-a-throw.bpmn');

    expect(links.duplicateCatches()).toEqual([]);
    expect(links.unmatchedThrows()).toEqual([]);
  });
});
