/**
 * What the pipeline does when the incremental layout fails (simulated with a
 * module mock): `auto` falls back to a full redraw with a warning, an
 * explicitly requested incremental layout is an E_LAYOUT_INCREMENTAL error.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/domain/diagram/layout/incremental/IncrementalLayout.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/domain/diagram/layout/incremental/IncrementalLayout.js')>()),
  IncrementalLayout: {
    run: async () => {
      throw new Error('boom');
    },
  },
}));

const { Doc } = await import('../../../src/domain/document/Doc.js');
const { mutateDoc } = await import('../../../src/index.js');
const { BpmnError } = await import('../../../src/domain/document/BpmnError.js');

/** A drawn file the clean engine would not reproduce (every shape moved by 30 px). */
async function handXml(): Promise<string> {
  const outcome = await mutateDoc(Doc.create({ processId: 'P' }), [
    { op: 'add', kind: 'startEvent', id: 'S' },
    { op: 'add', kind: 'task', id: 'A', after: 'S' },
  ], { dryRun: true });
  return outcome.xml.replace(/ x="(\d+)"/g, (wholeMatch, left: string) => ` x="${Number(left) + 30}"`);
}

describe('incremental layout failure', () => {
  it('auto falls back to a full redraw and says so', async () => {
    const outcome = await mutateDoc(await Doc.fromXml(await handXml(), 'x.bpmn'), [{ op: 'add', kind: 'task', id: 'B', after: 'A' }], { dryRun: true });
    expect(outcome.layout.mode).toBe('full');
    expect(outcome.layout.reason).toMatch(/incremental layout failed \(boom\)/);
    expect(outcome.layout.warnings.map((warning) => warning.code)).toEqual(['INCREMENTAL_FAILED']);
    expect(outcome.xml).toContain('bpmnElement="B"');
  });

  it('a requested incremental layout fails with E_LAYOUT_INCREMENTAL', async () => {
    const doc = await Doc.fromXml(await handXml(), 'x.bpmn');
    const err = await mutateDoc(doc, [{ op: 'add', kind: 'task', id: 'B', after: 'A' }], { dryRun: true, layout: 'incremental' }).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(BpmnError);
    expect(err).toMatchObject({ code: 'E_LAYOUT_INCREMENTAL', category: 'layout', details: { hint: expect.stringMatching(/--layout full/) } });
  });
});
