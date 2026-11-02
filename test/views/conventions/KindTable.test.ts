import { describe, expect, it } from 'vitest';
import { KindTable } from '../../../src/views/conventions/KindTable.js';

describe('KindTable', () => {
  it('lists each kind with the id pattern new ids of it follow', () => {
    const { kinds } = new KindTable().answer();

    expect(kinds.find(({ kind }) => kind === 'userTask')).toMatchObject({ type: 'bpmn:UserTask', family: 'task', aliases: ['user'], pattern: 'userTask_{name:camel}' });
  });

  it('follows declared conventions in the pattern', () => {
    const { kinds } = new KindTable({ prefixes: { 'bpmn:UserTask': 'UT_' }, case: 'snake_case' }).answer();

    expect(kinds.find(({ kind }) => kind === 'userTask')?.pattern).toBe('UT_{name:snake}');
  });

  it('names for each trigger its definition, keys and the kinds that take it', () => {
    const { triggers } = new KindTable().answer();

    expect(triggers.find(({ trigger }) => trigger === 'timer')).toMatchObject({ type: 'bpmn:TimerEventDefinition', keys: ['timer'], kinds: ['startEvent', 'intermediateCatchEvent', 'boundaryEvent'] });
    expect(triggers.find(({ trigger }) => trigger === 'none')).not.toHaveProperty('type');
    expect(triggers.find(({ trigger }) => trigger === 'message')?.alsoOn).toEqual(['sendTask', 'receiveTask']);
  });
});
