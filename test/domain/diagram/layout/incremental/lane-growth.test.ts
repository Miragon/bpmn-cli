/**
 * Lanes without a pool grow like a pool when a splice pushes (SpaceTool.ts capGrowth): only as far
 * as the content drawn in them now reaches, keeping the margin they had; nested lanes follow their
 * top lane, and content no lane lists (and a group) counts where it is drawn.
 */
import { describe, expect, it } from 'vitest';
import { Doc } from '../../../../../src/domain/document/Doc.js';
import { mutateDoc } from '../../../../../src/index.js';
import { DI_NS, edgeDi, sequenceFlow, shapeDi, shapes } from '../../../../helpers/drawing.js';

const sh = (id: string, left: number, top: number, width: number, height: number): string => shapeDi(id, left, top, width, height, id.startsWith('L') ? ' isHorizontal="true"' : '');
const refs = (ids: string[]): string => ids.map((id) => `<bpmn:flowNodeRef>${id}</bpmn:flowNodeRef>`).join('');

/**
 * S -> A -> G; "yes": B -> C -> E on the main row in lane LMain, "no": R -> RE below in lane LRej
 * (nested: in its child lane LInner); `listed` false leaves LMain without flow node refs, `group`
 * draws a group around R and RE up to the lanes' end
 */
const laned = ({ nested = false, listed = true, group = false } = {}): string => {
  const main = listed ? refs(['S', 'A', 'G', 'B', 'C', 'E']) : '';
  const rejection = nested ? `<bpmn:childLaneSet id="LS2"><bpmn:lane id="LInner">${refs(['R', 'RE'])}</bpmn:lane></bpmn:childLaneSet>` : refs(['R', 'RE']);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions ${DI_NS} id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
<bpmn:process id="P"><bpmn:laneSet id="LS"><bpmn:lane id="LMain">${main}</bpmn:lane><bpmn:lane id="LRej">${rejection}</bpmn:lane></bpmn:laneSet>
  <bpmn:startEvent id="S" /><bpmn:task id="A" name="A" /><bpmn:exclusiveGateway id="G" />
  <bpmn:task id="B" name="B" /><bpmn:task id="C" name="C" /><bpmn:endEvent id="E" />
  <bpmn:task id="R" name="R" /><bpmn:endEvent id="RE" />${group ? '<bpmn:group id="Grp" categoryValueRef="CV" />' : ''}
  ${sequenceFlow('F1', 'S', 'A')}${sequenceFlow('F2', 'A', 'G')}${sequenceFlow('F3', 'G', 'B')}${sequenceFlow('F4', 'B', 'C')}${sequenceFlow('F5', 'C', 'E')}${sequenceFlow('F6', 'G', 'R')}${sequenceFlow('F7', 'R', 'RE')}
</bpmn:process><bpmn:category id="Cat"><bpmn:categoryValue id="CV" value="Rejection" /></bpmn:category>
<bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="PL" bpmnElement="P">${[
    sh('LMain', 70, 120, 798, 140),
    sh('LRej', 70, 260, 798, 160),
    ...(nested ? [sh('LInner', 100, 260, 768, 160)] : []),
    ...(group ? [sh('Grp', 446, 285, 422, 115)] : []),
    sh('S', 100, 182, 36, 36),
    sh('A', 196, 160, 100, 80),
    sh('G', 356, 175, 50, 50),
    sh('B', 466, 160, 100, 80),
    sh('C', 626, 160, 100, 80),
    sh('E', 786, 182, 36, 36),
    sh('R', 466, 300, 100, 80),
    sh('RE', 626, 322, 36, 36),
    edgeDi('F1', [[136, 200], [196, 200]]),
    edgeDi('F2', [[296, 200], [356, 200]]),
    edgeDi('F3', [[406, 200], [466, 200]]),
    edgeDi('F4', [[566, 200], [626, 200]]),
    edgeDi('F5', [[726, 200], [786, 200]]),
    edgeDi('F6', [[381, 225], [381, 340], [466, 340]]),
    edgeDi('F7', [[566, 340], [626, 340]]),
  ].join('')}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>\n</bpmn:definitions>`;
};

const run = async (xml: string, ops: object[]) => {
  const result = await mutateDoc(await Doc.fromXml(xml), ops, { dryRun: true, layout: 'incremental' });
  return { result, before: shapes(await Doc.fromXml(xml)), after: shapes(await Doc.fromXml(result.xml)) };
};

describe('lanes without a pool grow only as far as their content reaches', () => {
  for (const variant of [{}, { nested: true }, { listed: false }]) {
    const lanes = ['LMain', 'LRej', ...(variant.nested ? ['LInner'] : [])];

    it(`a task on the shorter lane leaves the lanes as they are ${JSON.stringify(variant)}`, async () => {
      const { result, before, after } = await run(laned(variant), [{ op: 'add', kind: 'task', id: 'N', name: 'N', after: 'R' }]);
      expect(after.get('RE')!.bounds.x).toBeGreaterThan(before.get('RE')!.bounds.x);
      for (const id of lanes) {
        expect(after.get(id)!.bounds, id).toEqual(before.get(id)!.bounds);
      }
      expect(result.layout.metrics!.added).toEqual([]);
    });

    it(`a task on the row that reaches the border widens every lane by the push, keeping the margin ${JSON.stringify(variant)}`, async () => {
      const { result, before, after } = await run(laned(variant), [{ op: 'add', kind: 'task', id: 'N', name: 'N', after: 'C' }]);
      const dx = after.get('E')!.bounds.x - before.get('E')!.bounds.x;
      expect(dx).toBeGreaterThan(0);
      for (const id of lanes) {
        expect(after.get(id)!.bounds.width, id).toBe(before.get(id)!.bounds.width + dx);
      }
      expect(result.layout.metrics!.added).toEqual([]);
    });
  }

  it('a group drawn in the lanes that grows with the push takes every lane along', async () => {
    const { result, before, after } = await run(laned({ group: true }), [{ op: 'add', kind: 'task', id: 'N', name: 'N', after: 'R' }]);
    const dx = after.get('Grp')!.bounds.width - before.get('Grp')!.bounds.width;
    expect(dx).toBeGreaterThan(0);
    for (const id of ['LMain', 'LRej']) {
      expect(after.get(id)!.bounds.width, id).toBe(before.get(id)!.bounds.width + dx);
    }
    expect(result.layout.metrics!.added).toEqual([]);
  });
});
