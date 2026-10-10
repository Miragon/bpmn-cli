/**
 * Step 3: what `show --layout` tells an agent about x positions (columns,
 * wide gaps, rows that hold unrelated clusters) and the drawing-quality
 * problem kinds in a real write (src/diagram/view.ts, metrics.ts).
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/document.js';
import { layoutView } from '../src/diagram/view.js';
import { renderLayoutView } from '../src/format.js';
import type { El } from '../src/model.js';
import type { Op } from '../src/ops/types.js';
import { mutateDoc } from '../src/pipeline.js';

const BASE: Op[] = [
  { op: 'add', kind: 'startEvent', id: 'S', name: 'Start' },
  { op: 'add', kind: 'userTask', id: 'A', name: 'Check', after: 'S' },
  { op: 'add', kind: 'exclusiveGateway', id: 'G', name: 'ok?', after: 'A' },
  { op: 'add', kind: 'serviceTask', id: 'B', name: 'Book', after: 'G', flowName: 'yes', flowId: 'F_yes' },
  { op: 'add', kind: 'endEvent', id: 'E', name: 'Done', after: 'B' },
  { op: 'add', kind: 'task', id: 'C', name: 'Clarify', after: 'G', flowName: 'no', flowId: 'F_no' },
  { op: 'add', kind: 'endEvent', id: 'E2', name: 'Stopped', after: 'C' },
];

async function engineDoc(ops: Op[]): Promise<Doc> {
  const r = await mutateDoc(Doc.create({ processId: 'P' }), ops, { dryRun: true });
  return Doc.fromXml(r.xml);
}

/** Moves the shapes (and their labels and the waypoints right of `fromX`) of the plane by dx. */
function shiftRight(doc: Doc, ids: string[], dx: number): void {
  for (const pe of doc.definitions.get<El[]>('diagrams')[0]!.get<El>('plane').get<El[]>('planeElement')) {
    const id = pe.get<El>('bpmnElement').get<string>('id');
    if (!ids.includes(id)) continue;
    for (const b of [pe.get<El | undefined>('bounds'), pe.get<El | undefined>('label')?.get<El | undefined>('bounds')]) if (b) b.set('x', b.get<number>('x') + dx);
  }
}

describe('show --layout: columns and gaps', () => {
  it('numbers the columns across the drawing and marks wide gaps, in the diagram and inside a row', async () => {
    const doc = await engineDoc(BASE);
    // E (end of the upper row) far to the right: a wide gap in row 1 only, and an empty strip of columns
    shiftRight(doc, ['E'], 600);
    const view = layoutView(doc.definitions);
    const d = view.diagrams[0]!;
    const group = d.groups.find((g) => g.id === 'P')!;
    expect(group.rows).toEqual([['S', 'A', 'G', 'B', 'E'], ['C', 'E2']]);
    expect(group.columns).toEqual([[0, 1, 2, 3, 5], [3, 4]]);
    expect(group.gaps).toEqual([{ row: 0, before: [4] }]);
    expect(d.columns).toBe(6);
    expect(d.gaps).toEqual([{ after: 4, width: expect.any(Number) }]);
    expect(d.gaps[0]!.width).toBeGreaterThan(500);
    const text = renderLayoutView(view);
    expect(text).toMatch(/^ {2}columns: c0\.\.c5; wide gaps: c4\|c5 \d+px$/m);
    expect(text).toMatch(/^ {4}row 1: c0 S, c1 A, c2 G, c3 B … c5 E$/m);
    expect(text).toMatch(/^ {4}row 2: c3 C, c4 E2$/m);
  });
});
