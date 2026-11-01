import { describe, expect, it } from 'vitest';
import { GatewayPainter } from '../../src/paint/GatewayPainter.js';
import { Style } from '../../src/paint/Style.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('GatewayPainter', () => {
  async function painted(id: string, path = 'models/render/gallery.bpmn'): Promise<string> {
    const shape = await CorpusModel.shape(path, id);
    return new GatewayPainter(shape, new Style(shape.di)).svg();
  }

  it('draws an exclusive gateway with its marker when the DI shows it', async () => {
    expect(await painted('Gateway_WhichPath')).toContain('M-7.5 -9.5L7.5 9.5');
  });

  it('draws a parallel gateway with a plus', async () => {
    expect(await painted('Gateway_AfterWhichPath')).toContain('M0 -12V12M-12 0H12');
  });

  it('draws an inclusive gateway with a ring', async () => {
    expect(await painted('Gateway_AnyOf')).toContain('r="10.5"');
  });

  it('draws an event-based gateway with two rings and a pentagon', async () => {
    const svg = await painted('Gateway_WaitFor');
    expect(svg).toContain('r="9.3"');
    expect(svg).toContain('M0 -5.5L5.2 -1.7');
  });

  it('draws a complex gateway with a star and leaves an unmarked exclusive one empty', async () => {
    const svg = await new Promise<string>((resolve) => {
      resolve(painted('Gateway_Star', '../packages/render/test/golden/fixtures/gateways.bpmn'));
    });
    expect(svg).toContain('M-8.5 -8.5L8.5 8.5');
    expect(await painted('Gateway_Plain', '../packages/render/test/golden/fixtures/gateways.bpmn')).not.toContain('<g transform');
  });

  it('draws a parallel event-based gateway with one ring and a plus', async () => {
    const svg = await painted('Gateway_ParallelEvents', '../packages/render/test/golden/fixtures/gateways.bpmn');
    expect(svg).not.toContain('r="9.3"');
    expect(svg).toContain('M-1.5 -7H1.5');
  });
});
