import { describe, expect, it } from 'vitest';
import { RuleContext } from '../../../../src/checks/camunda/rules/RuleContext.js';
import { DocumentNamespaces } from '../../../../src/model/index.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('RuleContext', () => {
  it('reads the flows of a node from their ends, in a file without incoming and outgoing lists', async () => {
    const document = await Fixtures.read('engine/structure/cancel-boundary-on-a-task.bpmn');
    const context = new RuleContext(document, new DocumentNamespaces(document.tree.definitions), 'camunda');
    const task = document.tree.require('T');

    expect(context.incoming.get(task)?.map(({ id }) => id)).toEqual(['F1']);
    expect(context.outgoing.get(task)?.map(({ id }) => id)).toEqual(['F2']);
    expect(context.operaton).toBe(false);
  });
});
