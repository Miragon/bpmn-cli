import { describe, expect, it } from 'vitest';
import { StartTagWriter } from '../../../src/model/xml/StartTagWriter.js';
import { XmlTextReader } from '../../../src/model/xml/XmlTextReader.js';

describe('StartTagWriter', () => {
  function written(original: string, baseline: string, next: string, selfClosing = true, selfClose = ' />'): string {
    const documents = [XmlTextReader.read(original), XmlTextReader.read(baseline), XmlTextReader.read(next)] as const;
    const [origEl, n0, nextEl] = documents.map(({ root }) => root) as [typeof documents[0]['root'], typeof documents[0]['root'], typeof documents[0]['root']];
    return new StartTagWriter(...documents, selfClose).write({ origEl, n0, nextEl, name: nextEl.name }, selfClosing);
  }

  it('keeps the original tag when no attribute changed', () => {
    expect(written("<a  x='1'   y='2'/>", '<a x="1" y="2"/>', '<a x="1" y="2"/>')).toBe("<a  x='1'   y='2'/>");
  });

  it('keeps the order and the spelling of attributes that stayed, with the new value of the changed one', () => {
    expect(written("<a  y='2'\n   x='1'/>", '<a x="1" y="2"/>', '<a x="9" y="2"/>')).toBe('<a  y=\'2\'\n   x="9"/>');
  });

  it('writes a new attribute after the one it follows, on its own line in a broken tag', () => {
    expect(written('<a\n  x="1"/>', '<a x="1"/>', '<a x="1" y="2"/>')).toBe('<a\n  x="1"\n  y="2"/>');
  });

  it('drops a removed attribute but keeps a namespace declaration and what moddle never saw', () => {
    expect(written('<a xmlns:p="u" x="1" z="3"/>', '<a xmlns:p="u" x="1"/>', '<a/>')).toBe('<a xmlns:p="u" z="3"/>');
  });

  it('closes an element that had a body in the style of the file', () => {
    expect(written('<a x="1"></a>', '<a x="1"></a>', '<a x="2"/>', true, '/>')).toBe('<a x="2"/>');
  });

  it('opens a self-closing element for its new body', () => {
    expect(written('<a x="1" />', '<a x="1"/>', '<a x="2"/>', false)).toBe('<a x="2">');
  });

  it('reads the core of a tag without an attribute', () => {
    const document = XmlTextReader.read('<abc   />');

    expect(StartTagWriter.core(document, document.root)).toBe('<abc');
  });
});
