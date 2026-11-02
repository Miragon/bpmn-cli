import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InProcessCli } from '../../support/InProcessCli.js';

let cli: InProcessCli;

beforeEach(() => {
  cli = new InProcessCli();
});

afterEach(() => {
  cli.remove();
});

describe('DiagramCommand', () => {
  it('says when a file has no drawing', async () => {
    expect((await cli.run(['diagram', cli.copied('edit/order-check.bpmn')])).stdout).toContain('no diagram');
  });

  it('answers a file without a drawing with no score in the JSON', async () => {
    const { score } = JSON.parse((await cli.run(['diagram', cli.copied('edit/order-check.bpmn'), '--json'])).stdout);

    expect(score).toBeNull();
  });

  it('names the file in its JSON', async () => {
    const file = cli.copied('models/incremental/orders.bpmn');

    expect(JSON.parse((await cli.run(['diagram', file, '--json'])).stdout).file).toBe(file);
  });
});
