import { describe, expect, it } from 'vitest';
import { TextPreservation } from '../../../src/model/xml/TextPreservation.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('TextPreservation', () => {
  const original = Fixtures.text('models/roundtrip/styled.bpmn');

  async function serialised(text: string): Promise<string> {
    const { DocumentWriter } = await import('../../../src/model/document/DocumentWriter.js');
    const { DocumentReader } = await import('../../../src/model/document/DocumentReader.js');
    return new DocumentWriter().plain(await new DocumentReader().read(text));
  }

  it('gives the original back when the change changed nothing', async () => {
    const baseline = await serialised(original);

    expect(await new TextPreservation(original, baseline, baseline).result()).toEqual({ xml: original, mode: 'unchanged', droppedComments: 0 });
  });

  it('rewrites only the changed element', async () => {
    const baseline = await serialised(original);
    const next = baseline.replace(/name="[^"]+"/, 'name="Renamed"');

    const result = await new TextPreservation(original, baseline, next).result();

    expect(result.mode).toBe('preserved');
    expect(result.xml).toContain('name="Renamed"');
    expect(result.xml.length).toBeGreaterThan(next.length - 200);
  });

  it('falls back to the plain text when the original is no XML its reader takes', async () => {
    const result = await new TextPreservation('<!DOCTYPE a><a/>', '<a/>', '<a x="1"/>').result();

    expect([result.mode, result.xml]).toEqual(['plain', '<a x="1"/>']);
    expect(result.reason).toContain('DOCTYPE');
  });

  it('counts the comments a plain text loses', () => {
    expect(new TextPreservation('<a><!-- one --><!-- two --></a>', '<a/>', '<a x="1"/>').plain('forced').droppedComments).toBe(2);
  });

  it('falls back when no preserved text reads back as the changed model', async () => {
    const result = await new TextPreservation('<a/>', '<a/>', '<a x="1"/>').result();

    expect(result.mode).toBe('plain');
    expect(result.reason).toContain('does not read back');
  });

  it('falls back when the roots differ', async () => {
    const result = await new TextPreservation('<a/>', '<a/>', '<b/>').result();

    expect(result).toMatchObject({ mode: 'plain', reason: 'the root elements differ' });
  });
});
