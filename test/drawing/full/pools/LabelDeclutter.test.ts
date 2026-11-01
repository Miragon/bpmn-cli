import { describe, expect, it } from 'vitest';
import { LabelDeclutter } from '../../../../src/drawing/full/pools/LabelDeclutter.js';
import { Box, type BpmnDocument, type BpmnElement } from '../../../support/ModelValues.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('LabelDeclutter', () => {
  function shape(document: BpmnDocument, element: BpmnElement, box: Box, label?: Box, extra: Record<string, unknown> = {}): BpmnElement {
    const { tree } = document;
    const bounds = (at: Box): BpmnElement => tree.build('dc:Bounds', { x: at.x, y: at.y, width: at.width, height: at.height });
    const di = tree.build('bpmndi:BPMNShape', { bpmnElement: element, bounds: bounds(box), ...extra });
    if (label) {
      di.set('label', tree.build('bpmndi:BPMNLabel', { bounds: bounds(label) }));
    }
    return di;
  }

  function labelOf(di: BpmnElement): Box {
    const bounds = di.peek<BpmnElement>('label')!.peek<BpmnElement>('bounds')!;
    return new Box(bounds.get<number>('x'), bounds.get<number>('y'), bounds.get<number>('width'), bounds.get<number>('height'));
  }

  it('moves a label off a shape, and leaves a free one where it is', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const [first, second, third] = [...document.tree.all().values()].filter((element) => element.is('bpmn:FlowNode'));
    const blocker = shape(document, first!, new Box(100, 100, 100, 80));
    const clashing = shape(document, second!, new Box(40, 120, 36, 36), new Box(90, 130, 40, 14));
    const free = shape(document, third!, new Box(400, 100, 36, 36), new Box(400, 142, 36, 14));

    new LabelDeclutter([blocker, clashing, free]).run();

    expect(labelOf(clashing).overlaps(new Box(100, 100, 100, 80))).toBe(false);
    expect(labelOf(free).y).toBe(142);
  });

  it('prefers a spot inside the frame around the element', async () => {
    const document = await Fixtures.read('models/incremental/sub.bpmn');
    const sub = [...document.tree.all().values()].find((element) => element.is('bpmn:SubProcess'))!;
    const nodes = [...document.tree.all().values()].filter((element) => element.is('bpmn:FlowNode') && element !== sub);
    const frameBox = new Box(0, 0, 300, 200);
    const frame = shape(document, sub, frameBox, undefined, { isExpanded: true });
    const inner = shape(document, nodes[0]!, new Box(100, 80, 36, 36), new Box(100, 80, 36, 14));

    new LabelDeclutter([frame, inner]).run();

    expect(labelOf(inner).isInside(frameBox)).toBe(true);
  });
});
