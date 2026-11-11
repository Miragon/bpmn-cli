import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IdConventionsReader } from '../../../src/cli/files/IdConventionsReader.js';

const RULE = '@miragon/rules/element-id-naming';

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'conventions-'));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function read(content: string) {
  const path = join(folder, '.bpmnlintrc');
  writeFileSync(path, content);
  return new IdConventionsReader().of(path, '.bpmnlintrc in .');
}

describe('IdConventionsReader', () => {
  it('reads the options of the rule', async () => {
    const { conventions, severity, where } = await read(JSON.stringify({ rules: { [RULE]: ['error', { prefixes: { 'bpmn:UserTask': 'Task_' } }] } }));

    expect(conventions?.prefixes['bpmn:UserTask']).toBe('Task_');
    expect(severity).toBe('error');
    expect(where).toBe('.bpmnlintrc in .');
  });

  it('finds the rule in a configuration of the plugin a file extends', async () => {
    const { conventions, severity } = await read(JSON.stringify({ extends: ['bpmnlint:recommended', 'plugin:@miragon/rules/strict'] }));

    expect(conventions?.prefixes['bpmn:UserTask']).toBe('userTask_');
    expect(severity).toBe('error');
  });

  it('takes a number as the severity and lets the file switch an inherited rule off', async () => {
    expect((await read(JSON.stringify({ rules: { [RULE]: 1 } }))).severity).toBe('warn');
    expect(await read(JSON.stringify({ extends: 'plugin:@miragon/rules/strict', rules: { [RULE]: 'off' } }))).toEqual({ notes: [], where: '.bpmnlintrc in .', undeclared: 'off' });
  });

  it('says why it declares nothing', async () => {
    expect((await read('{ nope')).undeclared).toBe('not loaded');
    expect((await read('[]')).undeclared).toBe('not loaded');
    expect((await read('{"extends":"bpmnlint:recommended"}')).undeclared).toBe('off');
  });

  it('looks once per directory, and finds nothing where no file is', async () => {
    const reader = new IdConventionsReader();
    const path = join(folder, 'a.bpmn');

    expect(await reader.near(path)).toBe(await reader.near(join(folder, 'b.bpmn')));
    expect((await reader.near(path)).undeclared).toBe('no config');
  });
});
