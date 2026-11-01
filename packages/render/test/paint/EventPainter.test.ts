import { describe, expect, it } from 'vitest';
import { EventPainter } from '../../src/paint/EventPainter.js';
import { Style } from '../../src/paint/Style.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('EventPainter', () => {
  async function painted(id: string): Promise<string> {
    const shape = await CorpusModel.shape('models/render/gallery.bpmn', id);
    return new EventPainter(shape, new Style(shape.di)).svg();
  }

  it('draws a start event with one thin ring and no glyph', async () => {
    const svg = await painted('Event_OrderReceived');
    expect(svg).toContain('stroke-width="2"');
    expect(svg.match(/<circle/g)).toHaveLength(1);
  });

  it('draws an end event with one thick ring', async () => {
    expect(await painted('Event_Rejected')).toContain('stroke-width="4"');
  });

  it('draws an intermediate event with two rings', async () => {
    expect((await painted('Event_Milestone')).match(/stroke-width="1.5"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('dashes a non-interrupting boundary event', async () => {
    expect(await painted('Event_Reminder')).toContain('stroke-dasharray="5.5 3"');
    expect(await painted('Event_TwoDays')).not.toContain('stroke-dasharray');
  });

  it('dashes a non-interrupting start of an event sub-process', async () => {
    expect(await painted('Event_MessageStartInEventSubProcess')).toContain('stroke-dasharray="5.5 3"');
  });

  it('draws a pentagon for a multiple event and a plus for a parallel multiple one', async () => {
    expect(await painted('Event_Milestone')).toContain('M0 -8L7.6 -2.5');
    expect(await painted('Event_Go')).toContain('M-2 -9H2V-2');
  });

  it.each([
    ['Event_TwoDays', 'r="10.5"'],
    ['Event_Terminated', 'r="10.5"'],
    ['Event_ErrorEnd', 'M-8 8L-3.5'],
    ['Event_EscalationEnd', 'M0 -9L7 8'],
    ['Event_SignalEnd', 'M0 -9.5L8.5 6'],
    ['Event_MessageEnd', 'M-8.5 -6L0 0.8'],
    ['Event_CompensationEnd', 'M-8 0L0 -6V6'],
    ['Event_OnCancel', 'M-7 -9L0 -2'],
  ])('draws the glyph of %s', async (id, glyph) => {
    expect(await painted(id)).toContain(glyph);
  });

  it('fills the glyph of a throwing event and leaves that of a catching one white', async () => {
    const catching = await painted('Event_Changed');
    const throwing = await painted('Event_MessageEnd');
    expect(throwing).toContain('width="17" height="12" fill="#22242a"');
    expect(catching).not.toContain('width="17" height="12" fill="#22242a"');
  });
});
