import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../../support/InProcessCli.js';

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

describe('ApplyCommand', () => {
  it('refuses text that is no JSON', async () => {
    const file = cli.copied('edit/order-check.bpmn');

    expect(await cli.run(['apply', file, '-'], { stdin: 'nope' })).toMatchObject({ exit: 1, stderr: expect.stringContaining('not valid JSON') });
  });

  it('runs the operations of a file in one write', async () => {
    const file = cli.copied('edit/order-check.bpmn');
    const operations = join(cli.folder, 'ops.json');
    writeFileSync(operations, '{"ops":[{"op":"remove","ids":["ship"]},{"op":"remove","ids":["reject"]}]}');

    expect((await cli.run(['apply', file, operations, '--json'])).exit).toBe(0);
  });
});
