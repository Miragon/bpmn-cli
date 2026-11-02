import { describe, expect, it } from 'vitest';
import { DiagramColors } from '../../../src/drawing/diagram/DiagramColors.js';
import { Swatches } from '../../../src/drawing/diagram/Swatches.js';
import type { BpmnElement } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DiagramColors', () => {
  it('reads the colours of shapes, edges and labels by element', async () => {
    const document = await Fixtures.read('drawing/colored.bpmn');

    const colors = new DiagramColors(document.tree).read();

    expect([...colors.keys()].sort()).toEqual(['blue_task', 'custom_flow', 'labelled_end']);
    expect(colors.get('labelled_end')?.label).toEqual({ 'color:color': '#831311' });
  });

  it('puts colours back after the DI was drawn anew, with a new label where needed', async () => {
    const document = await Fixtures.read('drawing/colored.bpmn');
    const colors = new DiagramColors(document.tree);
    const remembered = colors.read();
    const planeElements = document.diagram.planes()[0]!.list('planeElement');
    for (const element of planeElements) {
      Swatches.set(element, undefined);
      element.set('label', undefined);
    }

    colors.apply(remembered);

    expect(colors.read()).toEqual(remembered);
    expect(planeElements.some((element) => element.peek<BpmnElement>('label'))).toBe(true);
  });

  it('touches nothing without colours', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const colors = new DiagramColors(document.tree);

    colors.apply(colors.read());

    expect(colors.read().size).toBe(0);
  });
});
