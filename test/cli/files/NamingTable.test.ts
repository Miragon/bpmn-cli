import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IdConventionsReader } from '../../../src/cli/files/IdConventionsReader.js';

const RULE = '@miragon/rules/element-id-naming';

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'naming-'));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function read(options?: object) {
  const path = join(folder, '.bpmnlintrc');
  writeFileSync(path, JSON.stringify({ rules: { [RULE]: ['error', options] } }));
  return new IdConventionsReader().of(path, '.bpmnlintrc in .');
}

async function messagesOf(options: object): Promise<string> {
  return (await read(options)).notes.map(({ message }) => message).join();
}

describe('NamingTable', () => {
  it('gives every kind the prefix of the rule, a gateway through its family', async () => {
    const { prefixes, qualifier, case: bodyCase, source } = (await read()).conventions!;

    expect(prefixes['bpmn:ExclusiveGateway']).toBe('gateway_');
    expect(prefixes['bpmn:Gateway']).toBeUndefined();
    expect([qualifier, bodyCase, source]).toEqual(['optional', 'camelCase', '.bpmnlintrc in .']);
  });

  it('lists qualified prefixes unless the qualifier is off', async () => {
    expect((await read({ eventDefinitionQualifier: 'required' })).conventions?.prefixes['bpmn:StartEvent:timer']).toBe('timerStartEvent_');
    expect((await read({ eventDefinitionQualifier: 'off' })).conventions?.prefixes['bpmn:StartEvent:timer']).toBeUndefined();
  });

  it('leaves the case out when any case goes', async () => {
    expect((await read({ case: 'any' })).conventions?.case).toBeUndefined();
  });

  it('notes what new ids cannot follow', async () => {
    expect(await messagesOf({ case: 'nope' })).toContain('case "nope" is unknown');
    expect(await messagesOf({ eventDefinitionQualifier: 'nope' })).toContain('eventDefinitionQualifier "nope" is unknown');
    expect(await messagesOf({ prefixes: { 'bpmn:Task': '1_' } })).toContain('cannot start an id');
    expect(await messagesOf({ prefixes: { 'bpmn:Task': 'ä_' } })).toContain('outside ASCII');
    expect(await messagesOf({ prefixes: { 'bpmndi:BPMNShape': 'Shape_' } })).toContain('names DI after its element');
  });

  it('ignores a prefix too long for a qualified id, once', async () => {
    const { conventions, notes } = await read({ eventDefinitionQualifier: 'required', prefixes: { 'bpmn:StartEvent': `${'s'.repeat(52)}_` } });

    expect(conventions?.ignored).toContain('bpmn:StartEvent:timer');
    expect(notes.some(({ message }) => message?.includes('longer than 56 characters'))).toBe(true);
  });
});
