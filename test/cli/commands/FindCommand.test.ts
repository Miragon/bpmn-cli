import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../../support/InProcessCli.js';

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

describe('FindCommand', () => {
  it('lists every element without a text', async () => {
    const { stdout } = await cli.run(['find', cli.copied('edit/order-check.bpmn')]);

    expect(stdout.split('\n')[0]).toMatch(/^\S+\t/);
  });

  it('keeps one line and five columns per hit when a name or a value holds a newline or a tab', async () => {
    const lines = (await cli.run(['find', cli.copied('views/names-over-lines.bpmn'), '--kind', 'task'])).stdout.trimEnd().split('\n');
    const topic = (await cli.run(['find', cli.copied('views/names-over-lines.bpmn'), 'second'])).stdout.trimEnd().split('\n');

    expect(lines.map((line) => line.split('\t')[0])).toEqual(['task_lines', 'task_topic']);
    expect(lines[0]).toBe('task_lines\ttask\tCheck the order\tProcess_lines');
    expect(topic).toEqual(['task_topic\tserviceTask\t\tProcess_lines\tcamunda:topic=first second']);
  });

  it('leaves the name as it is in the JSON', async () => {
    const { hits } = JSON.parse((await cli.run(['find', cli.copied('views/names-over-lines.bpmn'), 'order', '--json'])).stdout);

    expect(hits[0].name).toBe('Check\nthe\torder');
  });

  it('prints the hits as JSON', async () => {
    const { total, hits } = JSON.parse((await cli.run(['find', cli.copied('edit/order-check.bpmn'), 'zzz', '--json'])).stdout);

    expect([total, hits]).toEqual([0, []]);
  });
});
