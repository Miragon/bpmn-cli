import { describe, expect, it } from 'vitest';
import { ActivityPainter } from '../../src/paint/ActivityPainter.js';
import { LabelPainter } from '../../src/paint/LabelPainter.js';
import { Style } from '../../src/paint/Style.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('ActivityPainter', () => {
  async function painted(id: string): Promise<string> {
    const shape = await CorpusModel.shape('models/render/gallery.bpmn', id);
    const style = new Style(shape.planeElement);
    return new ActivityPainter(shape, style, new LabelPainter(style.label)).svg();
  }

  it.each([
    ['Activity_UserTask', 'M2 18V15C2 11.5'],
    ['Activity_ManualTask', 'M2 11C2 7.5'],
    ['Activity_ServiceTask', 'stroke-dasharray="2.59 2.59"'],
    ['Activity_SendTask', 'M2 5L10 11L18 5'],
    ['Activity_ReceiveTask', 'M2 5L10 11L18 5'],
    ['Activity_ScriptTask', 'M6 2H17C14 5'],
    ['Activity_BusinessRuleTask', 'M2 11.5H18M7 7.5V16'],
  ])('draws the icon of %s', async (id, icon) => {
    expect(await painted(id)).toContain(icon);
  });

  it('draws a plain task without an icon but with its name', async () => {
    const svg = await painted('Activity_InnerTask');
    expect(svg).not.toContain('<g transform');
    expect(svg).toContain('<tspan');
  });

  it('draws a call activity with a thick border and the plus of a collapsed sub-process', async () => {
    const svg = await painted('Activity_CallActivity');
    expect(svg).toContain('stroke-width="5"');
    expect(svg).toContain('M3.5 7H10.5M7 3.5V10.5');
  });

  it('draws a transaction with a double border', async () => {
    expect((await painted('Activity_Transaction')).match(/<rect/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('dots the border of an event sub-process', async () => {
    expect(await painted('Activity_EventSubProcess')).toContain('stroke-dasharray="1 4"');
  });

  it('puts the name of an expanded sub-process at its top and adds no plus', async () => {
    const svg = await painted('Activity_ExpandedSubProcess');
    expect(svg).not.toContain('M3.5 7H10.5M7 3.5V10.5');
    expect(svg).toContain('<tspan');
  });

  it.each([
    ['Activity_StandardLoop', 'M4.2 11.8A5.5'],
    ['Activity_ParallelMultiInstance', 'M3 2V12M7 2V12M11 2V12'],
    ['Activity_SequentialMultiInstance', 'M2 3H12M2 7H12M2 11H12'],
    ['Activity_Compensation', 'M1 7L7 2.5V11.5Z'],
    ['Activity_AdHocSubProcess', 'M1 8C3.5 4 5.5 4 7 7'],
  ])('draws the marker of %s', async (id, marker) => {
    expect(await painted(id)).toContain(marker);
  });
});
