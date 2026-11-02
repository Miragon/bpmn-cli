import { describe, expect, it } from 'vitest';
import { DecisionLinkWriter } from '../../../src/edit/properties/DecisionLinkWriter.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { type BpmnElement, ChangeSet, DocumentWriter } from '../../support/ModelValues.js';

async function link(path: string, id: string, value: string, platform?: ConstructorParameters<typeof EditSession>[1]) {
  const document = await Fixtures.readForWrite(path);
  const task = document.tree.require(id);
  const changes = new ChangeSet();
  const detail = new DecisionLinkWriter(new EditSession(document, platform)).write(task, value, changes);
  const calls = (task.get<BpmnElement | undefined>('extensionElements')?.list('values') ?? []).filter((value) => value.type.endsWith(':calledDecision'));
  return { document, task, changes, detail, calls };
}

const BOTH = 'edit/properties-decisions.bpmn';

describe('DecisionLinkWriter', () => {
  it('writes camunda:decisionRef in a Camunda 7 file and clears the other spellings', async () => {
    const { task, detail, calls } = await link(BOTH, 'task_both', 'risk', 'c7');

    expect(task.attrs['camunda:decisionRef']).toBe('risk');
    expect(task.attrs['calledDecision']).toBeUndefined();
    expect(task.attrs['calledElement']).toBeUndefined();
    expect(calls).toEqual([]);
    expect(detail).toBe('calledDecision=risk (camunda:decisionRef); removed calledElement, calledDecision, zeebe:calledDecision');
  });

  it('writes operaton:decisionRef in an Operaton-only file', async () => {
    const { task, detail } = await link('model/operaton.bpmn', 'task_rule', 'risk', 'c7');

    expect(task.attrs['operaton:decisionRef']).toBe('risk');
    expect(detail).toBe('calledDecision=risk (operaton:decisionRef)');
  });

  it('declares the camunda namespace when a Camunda 7 link lands in a file without it', async () => {
    const { document, task } = await link('edit/properties-decisions-bare.bpmn', 'task_new', 'risk', 'c7');

    expect(task.attrs['camunda:decisionRef']).toBe('risk');
    expect(document.tree.definitions.attrs['xmlns:camunda']).toBe('http://camunda.org/schema/1.0/bpmn');
  });

  it('updates the zeebe:calledDecision of a Camunda 8 file and keeps its result variable', async () => {
    const { calls, changes, detail } = await link('model/c8-vendor.bpmn', 'task_rule', 'risk', 'c8');

    expect(calls.map((call) => [call.peek('decisionId'), call.peek('resultVariable')])).toEqual([['risk', 'result']]);
    expect(changes.warnings).toEqual([]);
    expect(detail).toBe('calledDecision=risk (zeebe:calledDecision)');
  });

  it('warns that Camunda 8 needs a result variable for a new link', async () => {
    const { calls, changes } = await link('model/c8-vendor.bpmn', 'task_no_link', 'risk', 'c8');

    expect(calls).toHaveLength(1);
    expect(changes.warnings).toEqual([expect.objectContaining({ code: 'W_DECISION_RESULT_VARIABLE', element: 'task_no_link' })]);
  });

  it('removes every spelling with an empty value and leaves other extension elements', async () => {
    const { task, detail } = await link(BOTH, 'task_both', '');

    expect(task.attrs).not.toHaveProperty('camunda:decisionRef');
    expect(task.attrs).not.toHaveProperty('calledDecision');
    expect(task.get<BpmnElement>('extensionElements').list('values').map(({ type }) => type)).toEqual(['zeebe:taskHeaders']);
    expect(detail).toBe('calledDecision removed; removed calledElement, calledDecision, camunda:decisionRef, zeebe:calledDecision');
  });

  it('removes the extension elements a last zeebe:calledDecision leaves empty', async () => {
    const { task } = await link('model/c8-vendor.bpmn', 'task_rule', '');

    expect(task.get('extensionElements')).toBeUndefined();
  });

  it('refuses a link on anything but a business rule task', async () => {
    await expect(link(BOTH, 'task_service', 'risk')).rejects.toMatchObject({ code: 'E_UNKNOWN_KEY', details: { element: 'task_service' } });
  });

  describe('in a model without an engine', () => {
    it('keeps a camunda:decisionRef the task has and adds no unprefixed link', async () => {
      const { task, detail } = await link(BOTH, 'task_camunda', 'next', 'none');

      expect(task.attrs).toMatchObject({ 'camunda:decisionRef': 'next' });
      expect(task.attrs).not.toHaveProperty('calledDecision');
      expect(detail).toBe('calledDecision=next (camunda:decisionRef)');
    });

    it('keeps an operaton:decisionRef the task has', async () => {
      expect((await link('model/operaton.bpmn', 'task_rule', 'next', 'none')).task.attrs['operaton:decisionRef']).toBe('next');
    });

    it('updates a zeebe:calledDecision, keeps its result variable and does not warn', async () => {
      const { calls, changes, detail } = await link(BOTH, 'task_zeebe', 'next', 'none');

      expect(calls.map((call) => [call.peek('decisionId'), call.peek('resultVariable')])).toEqual([['next', 'price']]);
      expect(changes.warnings).toEqual([]);
      expect(detail).toBe('calledDecision=next (zeebe:calledDecision)');
    });

    it('takes a zeebe:calledDecision without a decisionId for no link', async () => {
      const { task, detail } = await link('edit/properties-decisions-zeebe.bpmn', 'task_host', 'next', 'none');

      expect(detail).toBe('calledDecision=next (z:calledDecision)');
      expect(task.get<BpmnElement>('extensionElements').list('values').map(({ type }) => type)).toEqual(['z:taskHeaders', 'z:calledDecision']);
    });

    it('writes a new link unprefixed when the file spells its links two ways', async () => {
      const { task, detail } = await link(BOTH, 'task_new', 'next', 'none');

      expect(task.attrs['calledDecision']).toBe('next');
      expect(detail).toBe('calledDecision=next (calledDecision)');
    });

    it('writes a new link unprefixed when the file has only unprefixed links', async () => {
      expect((await link('edit/properties-decisions-bare.bpmn', 'task_new', 'next', 'none')).task.attrs['calledDecision']).toBe('next');
    });

    it('updates an unprefixed link in place', async () => {
      const { task, detail } = await link('edit/properties-decisions-bare.bpmn', 'task_linked', 'next', 'none');

      expect(task.attrs['calledDecision']).toBe('next');
      expect(detail).toBe('calledDecision=next (calledDecision)');
    });

    it('follows the file\'s own prefix, and a link in a sub-process counts', async () => {
      const { document, task } = await link('edit/properties-decisions-own-prefix.bpmn', 'task_new', 'next', 'none');

      expect(task.attrs['c:decisionRef']).toBe('next');
      expect(document.tree.definitions.attrs).not.toHaveProperty('xmlns:camunda');
    });

    it('follows the file\'s single zeebe spelling under its own prefix, without a warning', async () => {
      const { calls, changes } = await link('edit/properties-decisions-zeebe.bpmn', 'task_new', 'next', 'none');

      expect(calls.map(({ type }) => type)).toEqual(['z:calledDecision']);
      expect(changes.warnings).toEqual([]);
    });
  });

  it('changes only the link\'s value in the written file', async () => {
    const path = 'edit/properties-decisions-own-prefix.bpmn';
    const { document } = await link(path, 'task_deep', 'next', 'none');

    expect(await new DocumentWriter().write(document)).toBe(Fixtures.text(path).replace('c:decisionRef="deep"', 'c:decisionRef="next"'));
  });
});
