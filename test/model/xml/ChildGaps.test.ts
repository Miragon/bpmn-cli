import { describe, expect, it } from 'vitest';
import { ChildGaps } from '../../../src/model/xml/ChildGaps.js';
import { XmlTextReader } from '../../../src/model/xml/XmlTextReader.js';

describe('ChildGaps', () => {
  function gapsOf(text: string): { gaps: ChildGaps; kids: ReturnType<typeof XmlTextReader.elementChildren> } {
    const { root } = XmlTextReader.read(text);
    const kids = XmlTextReader.elementChildren(root);
    return { gaps: ChildGaps.of(text, root, kids), kids };
  }

  it('splits the text around children at the line breaks', () => {
    const { gaps, kids } = gapsOf('<a> <!-- head -->\n  <b/> <!-- tail -->\n  <c/>\n</a>');

    expect(gaps.head).toBe(' <!-- head -->');
    expect(gaps.lead.get(kids[0]!)).toBe('\n  ');
    expect(gaps.trail.get(kids[0]!)).toBe(' <!-- tail -->');
    expect(gaps.closing).toBe('\n');
    expect(gaps.inline).toBe(false);
  });

  it('starts a line break of a CRLF file at its carriage return', () => {
    const { gaps, kids } = gapsOf('<a>\r\n  <b/>\r\n</a>');

    expect(gaps.lead.get(kids[0]!)).toBe('\r\n  ');
    expect(gaps.closing).toBe('\r\n');
  });

  it('calls children on one line inline', () => {
    const { gaps } = gapsOf('<a><b/><c/></a>');

    expect(gaps.inline).toBe(true);
  });

  it('calls an element without children not inline', () => {
    expect(gapsOf('<a></a>').gaps.inline).toBe(false);
  });
});
