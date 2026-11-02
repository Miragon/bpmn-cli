import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../support/InProcessCli.js';

let cli: InProcessCli;
let file: string;

beforeEach(() => {
  cli = new InProcessCli();
  file = cli.copied('edit/order-check.bpmn');
});

afterEach(() => {
  cli.remove();
});

describe('bpmn with its edit commands', () => {
  it('creates a file, refuses to overwrite it and takes the name as a word', async () => {
    const created = join(cli.folder, 'new.bpmn');

    expect(await cli.run(['new', created, 'Order handling', '--target', 'camunda8'])).toMatchObject({ exit: 0, stdout: `written: ${created}\n` });
    expect(readFileSync(created, 'utf8')).toContain('name="Order handling"');
    expect(await cli.run(['new', created])).toMatchObject({ exit: 4, stderr: expect.stringContaining('E_FILE_EXISTS') });
    expect((await cli.run(['new', created, '--force'])).exit).toBe(0);
  });

  it('prints a new model on stdout', async () => {
    const { stdout, stderr } = await cli.run(['new', '-', 'Order']);

    expect(stdout).toContain('<bpmn:process');
    expect(stderr).toBe('written: -\n');
  });

  it('ends every write with the layout score, the state and the file', async () => {
    await cli.run(['layout', file]);

    const { stdout, exit } = await cli.run(['add', file, 'userTask', 'Extra', '--after', 'check', 'doc=Four eyes']);

    expect(exit).toBe(0);
    expect(stdout).toContain('created userTask: userTask_extra');
    expect(stdout).toMatch(/layout quality: score \d+ -> \d+.*\nstate: 0 errors, 0 warnings \(bpmn validate lists them and runs the project's lint\)\nwritten: /);
    expect(readFileSync(file, 'utf8')).toContain('Four eyes');
  });

  it('fills set from key=value, also when the name is left out', async () => {
    await cli.run(['add', file, 'boundaryEvent:timer', 'timer=P2D', '--on', 'check', '--id', 'event_late']);

    expect((await cli.run(['show', file, 'event_late'])).stdout).toContain('timer=P2D');
  });

  it('prints a write as JSON without the XML, with file and written', async () => {
    const report = JSON.parse((await cli.run(['set', file, 'check', 'name=Checked', '--json'])).stdout);

    expect(report).toMatchObject({ ok: true, file, written: true, changed: [{ id: 'check' }] });
    expect(report.xml).toBeUndefined();
  });

  it('writes nothing on a dry run, and writes to another file with -o', async () => {
    const before = readFileSync(file, 'utf8');
    const copy = join(cli.folder, 'copy.bpmn');

    expect((await cli.run(['set', file, 'check', 'name=Checked', '--dry-run'])).stdout).toContain('not written');
    expect((await cli.run(['set', file, 'check', 'name=Checked', '-o', copy])).stdout).toContain(`written: ${copy}`);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(readFileSync(copy, 'utf8')).toContain('Checked');
  });

  it('writes the result to stdout with -o - and the report to stderr, also for a model from stdin', async () => {
    const stdin = readFileSync(file, 'utf8');

    const { stdout, stderr } = await cli.run(['set', '-', 'check', 'name=Checked'], { stdin });

    expect(stdout).toContain('name="Checked"');
    expect(stderr).toContain('written: -');
    expect((await cli.run(['set', file, 'check', 'name=Checked', '-o', '-'])).stdout).toContain('name="Checked"');
  });

  it('writes no file when the result equals it', async () => {
    await cli.run(['layout', file]);

    const { stdout } = await cli.run(['set', file, 'check', 'name=Check order']);

    expect(stdout).toContain('unchanged: ');
  });

  it('runs a batch from a file and from stdin, in one transaction', async () => {
    const operations = join(cli.folder, 'ops.json');
    writeFileSync(operations, JSON.stringify([{ op: 'add', kind: 'task', name: 'One', after: 'check', as: '$one' }, { op: 'set', id: '$one', set: { doc: 'x' } }]));

    expect((await cli.run(['apply', file, operations])).stdout).toContain('aliases: $one = task_one');
    expect((await cli.run(['apply', file, '-'], { stdin: '[{"op":"remove","ids":["task_one"]}]' })).stdout).toContain('task_one');
    expect(await cli.run(['apply', file, '-'], { stdin: '{nope' })).toMatchObject({ exit: 1, stderr: expect.stringContaining('Ops are not valid JSON') });
    expect((await cli.run(['apply', '-', '-'])).stderr).toContain('cannot both come from stdin');
  });

  it('removes keys with a repeated --unset and refuses an empty value', async () => {
    await cli.run(['set', file, 'check', 'doc=Four eyes', 'camunda:assignee=kermit']);

    expect(await cli.run(['set', file, 'check', '--unset', 'doc', 'name=Check it', '--unset', 'camunda:assignee'])).toMatchObject({ exit: 0 });
    expect(readFileSync(file, 'utf8')).not.toMatch(/Four eyes|kermit/);
    expect(await cli.run(['set', file, 'check', 'name='])).toMatchObject({ exit: 1, stderr: 'error E_INVALID_VALUE: name needs a value\n  hint: Use --unset name to remove it.\n' });
  });

  it('keeps extension attributes, the body and the selector apart', async () => {
    const camunda = cli.copied('edit/extensions-camunda.bpmn');

    await cli.run(['ext', 'add', camunda, 'bare', 'camunda:inputParameter', 'name=amount', 'body=${total}']);
    expect(readFileSync(camunda, 'utf8')).toContain('<camunda:inputParameter name="amount">${total}</camunda:inputParameter>');
    expect((await cli.run(['ext', 'remove', camunda, 'bare', '0'])).exit).toBe(0);
    expect(readFileSync(camunda, 'utf8')).not.toContain('name="amount"');
  });

  it('answers E_USAGE to a retired command, alias or flag, and E_UNKNOWN_KEY to what the element does not hold', async () => {
    for (const words of [['metrics', file], ['rm', file, 'check'], ['add', file, 'userTask', '--timer', 'P2D'], ['remove', file, 'check', '--no-bridge'], ['ext', 'list', file, 'check']]) {
      expect(await cli.run(words)).toMatchObject({ exit: 1, stderr: expect.stringMatching(/^error E_USAGE: /) });
    }
    expect(await cli.run(['add', file, 'userTask', '--after', 'check', 'timer=P2D'])).toMatchObject({ exit: 2, stderr: expect.stringContaining('E_UNKNOWN_KEY') });
    expect(await cli.run(['add', file, 'userTask', '--after', 'check', 'id=mine'])).toMatchObject({ exit: 2, stderr: expect.stringContaining('E_UNKNOWN_KEY') });
  });

  it('takes --bridge none and all, and nothing else', async () => {
    expect((await cli.run(['remove', file, 'check', '--bridge', 'maybe'])).stderr).toContain('Allowed choices are none, all');
    expect((await cli.run(['remove', file, 'gateway_join', '--bridge', 'all'])).exit).toBe(0);
    expect((await cli.run(['remove', file, 'ship', '--bridge', 'none'])).exit).toBe(0);
  });

  it('keeps --strict off the writes', async () => {
    expect((await cli.run(['set', file, 'check', 'name=x', '--strict'])).stderr).toContain("unknown option '--strict'");
  });

  it('reports refusals with code, hint and exit code, as text and as JSON', async () => {
    const { exit, stderr } = await cli.run(['add', file, 'userTask', 'X', '--after', 'nope']);
    const json = await cli.run(['add', file, 'userTask', 'X', '--after', 'nope', '--json']);

    expect(exit).toBe(2);
    expect(stderr).toMatch(/^error E_NOT_FOUND: /);
    expect(JSON.parse(json.stderr)).toMatchObject({ ok: false, error: { code: 'E_NOT_FOUND' } });
    expect(await cli.run(['show', join(cli.folder, 'missing.bpmn')])).toMatchObject({ exit: 4, stderr: expect.stringContaining('E_FILE_NOT_FOUND') });
    expect(await cli.run(['add', file, 'noSuchKind'])).toMatchObject({ exit: 1, stderr: expect.stringMatching(/^error E_UNKNOWN_KIND: Unknown kind/) });
  });
});
