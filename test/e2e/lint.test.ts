import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../support/InProcessCli.js';

const NAMING = JSON.stringify({ rules: { '@miragon/rules/element-id-naming': ['error', { prefixes: { 'bpmn:UserTask': 'Task_' }, case: 'PascalCase' }] } });
const BUILT_IN_RULE = JSON.stringify({ rules: { 'label-required': 'error' } });

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

function inRepository(rc: string): string {
  mkdirSync(join(cli.folder, '.git'));
  mkdirSync(join(cli.folder, 'models', 'deep'), { recursive: true });
  writeFileSync(join(cli.folder, '.bpmnlintrc'), rc);
  return join(cli.folder, 'models', 'deep');
}

describe('bpmn with a .bpmnlintrc', () => {
  it('lints in validate, from the nearest file up to the repository root', async () => {
    const folder = inRepository(BUILT_IN_RULE);
    const file = join(folder, 'order.bpmn');
    await cli.run(['new', file, 'Order']);
    await cli.run(['add', file, 'task', '--in', 'order']);

    const { stdout, exit } = await cli.run(['validate', file]);

    expect(exit).toBe(2);
    expect(stdout).toContain('validator bpmnlint (');
    expect(stdout).toContain('label-required');
  });

  it('skips the file with --no-lint-config, and reads another with --lint-config', async () => {
    const file = cli.copied('edit/order-check.bpmn');
    const other = join(cli.folder, 'strict.json');
    writeFileSync(other, BUILT_IN_RULE);

    expect((await cli.run(['validate', file, '--no-lint-config'])).stdout).not.toContain('validator bpmnlint');
    expect((await cli.run(['validate', file, '--lint-config', other])).stdout).toContain(`validator bpmnlint (--lint-config ${other})`);
  });

  it('refuses a broken file named by --lint-config, and only warns about one it found', async () => {
    const file = cli.copied('edit/order-check.bpmn');
    const broken = join(cli.folder, 'broken.json');
    writeFileSync(broken, '{ nope');
    writeFileSync(join(cli.folder, '.bpmnlintrc'), '{ nope');

    expect(await cli.run(['validate', file, '--lint-config', broken])).toMatchObject({ exit: 4, stderr: expect.stringMatching(/^error E_LINT_CONFIG: /) });
    expect(await cli.run(['validate', file, '--lint-config', join(cli.folder, 'missing.json')])).toMatchObject({ exit: 4 });
    expect(await cli.run(['validate', file])).toMatchObject({ exit: 0, stdout: expect.stringContaining('W_LINT_UNAVAILABLE') });
  });

  it('looks only in the directory of the file outside a repository', async () => {
    mkdirSync(join(cli.folder, 'below'));
    writeFileSync(join(cli.folder, '.bpmnlintrc'), BUILT_IN_RULE);
    const file = join(cli.folder, 'below', 'order.bpmn');
    await cli.run(['new', file]);

    expect((await cli.run(['validate', file])).stdout).not.toContain('validator bpmnlint');
  });

  it('gives new ids the naming of the nearest file, and conventions prints it', async () => {
    const file = join(inRepository(NAMING), 'order.bpmn');
    await cli.run(['new', file, 'Order']);

    expect((await cli.run(['add', file, 'userTask', 'Check it', '--in', 'order'])).stdout).toContain('created userTask: Task_CheckIt');
    expect((await cli.run(['conventions', file])).stdout).toContain('case PascalCase');
  });

  it('warns with W_CONFIG_IGNORED about a value new ids cannot follow', async () => {
    const file = join(inRepository(JSON.stringify({ rules: { '@miragon/rules/element-id-naming': ['warn', { case: 'nope' }] } })), 'order.bpmn');

    expect((await cli.run(['conventions', file])).stdout).toContain('W_CONFIG_IGNORED');
    expect(JSON.parse((await cli.run(['conventions', file, '--json'])).stdout).notes[0].code).toBe('W_CONFIG_IGNORED');
  });
});
