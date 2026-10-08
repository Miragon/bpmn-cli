/**
 * What the pipeline does when the incremental layout fails (simulated with a
 * module mock): `auto` falls back to a full redraw with a warning, an
 * explicitly requested incremental layout is an E_LAYOUT_INCREMENTAL error.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/diagram/incremental.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/diagram/incremental.js')>()),
  layoutIncremental: async () => {
    throw new Error('boom');
  },
}));

const { Doc } = await import('../src/document.js');
const { mutateDoc } = await import('../src/pipeline.js');
const { CliError } = await import('../src/errors.js');

/** A drawn file the clean engine would not reproduce (every shape moved by 30 px). */
async function handXml(): Promise<string> {
  const r = await mutateDoc(Doc.create({ processId: 'P' }), [
    { op: 'add', kind: 'startEvent', id: 'S' },
    { op: 'add', kind: 'task', id: 'A', after: 'S' },
  ], { dryRun: true });
  return r.xml.replace(/ x="(\d+)"/g, (_, x: string) => ` x="${Number(x) + 30}"`);
}

describe('incremental layout failure', () => {
  it('auto falls back to a full redraw and says so', async () => {
    const r = await mutateDoc(await Doc.fromXml(await handXml(), 'x.bpmn'), [{ op: 'add', kind: 'task', id: 'B', after: 'A' }], { dryRun: true });
    expect(r.layout.mode).toBe('full');
    expect(r.layout.reason).toMatch(/incremental layout failed \(boom\)/);
    expect(r.layout.warnings.map((w) => w.code)).toEqual(['INCREMENTAL_FAILED']);
    expect(r.xml).toContain('bpmnElement="B"');
  });

  it('a requested incremental layout fails with E_LAYOUT_INCREMENTAL', async () => {
    const doc = await Doc.fromXml(await handXml(), 'x.bpmn');
    const err = await mutateDoc(doc, [{ op: 'add', kind: 'task', id: 'B', after: 'A' }], { dryRun: true, layout: 'incremental' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err).toMatchObject({ code: 'E_LAYOUT_INCREMENTAL', category: 'layout', details: { hint: expect.stringMatching(/--layout full/) } });
  });
});
