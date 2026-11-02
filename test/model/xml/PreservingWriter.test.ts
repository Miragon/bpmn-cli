import { describe, expect, it } from 'vitest';
import { PreservingWriter } from '../../../src/model/xml/PreservingWriter.js';
import { XmlTextReader } from '../../../src/model/xml/XmlTextReader.js';

describe('PreservingWriter', () => {
  function written(original: string, baseline: string, next: string, keepOrder = true): string {
    return new PreservingWriter(XmlTextReader.read(original), XmlTextReader.read(baseline), XmlTextReader.read(next), keepOrder).write();
  }

  it('copies an unchanged element from the original, comments and quotes included', () => {
    const original = `<?xml version="1.0"?>\n<r>\n  <!-- keep -->\n  <a id='1'/>\n  <b id="2"/>\n</r>\n`;

    expect(written(original, '<r><a id="1"/><b id="2"/></r>', '<r><a id="1"/><b id="2" x="3"/></r>')).toBe(`<?xml version="1.0"?>\n<r>\n  <!-- keep -->\n  <a id='1'/>\n  <b id="2" x="3"/>\n</r>\n`);
  });

  it('indents a new child like its siblings', () => {
    expect(written('<r>\n    <a id="1"/>\n</r>', '<r><a id="1"/></r>', '<r><a id="1"/><b id="2"/></r>')).toBe('<r>\n    <a id="1"/>\n    <b id="2"/>\n</r>');
  });

  it('writes a fresh subtree with the indentation unit of the file', () => {
    const fresh = '<r><a id="1"/><b id="2"><c id="3"/></b></r>';

    expect(written('<r>\n  <a id="1"/>\n</r>', '<r><a id="1"/></r>', fresh)).toBe('<r>\n  <a id="1"/>\n  <b id="2">\n    <c id="3"/>\n  </b>\n</r>');
  });

  it('keeps children on one line when the file has them so', () => {
    expect(written('<r><a id="1"/></r>', '<r><a id="1"/></r>', '<r><a id="1"/><b id="2"/></r>')).toBe('<r><a id="1"/><b id="2"/></r>');
  });

  it('keeps the original order of children moddle groups otherwise', () => {
    const original = '<r>\n  <b id="2"/>\n  <a id="1"/>\n</r>';

    expect(written(original, '<r><a id="1"/><b id="2"/></r>', '<r><a id="1"/><n id="9"/><b id="2"/></r>')).toBe('<r>\n  <b id="2"/>\n  <a id="1"/>\n  <n id="9"/>\n</r>');
  });

  it('takes moddle order when asked not to keep the order, or after a real reorder', () => {
    const original = '<r>\n  <b id="2"/>\n  <a id="1"/>\n</r>';

    expect(written(original, '<r><a id="1"/><b id="2"/></r>', '<r><a id="1"/><b id="2"/><n/></r>', false)).toBe('<r>\n  <a id="1"/>\n  <b id="2"/>\n  <n/>\n</r>');
    expect(written(original, '<r><a id="1"/><b id="2"/></r>', '<r><b id="2"/><a id="1"/><n/></r>')).toBe('<r>\n  <b id="2"/>\n  <a id="1"/>\n  <n/>\n</r>');
  });

  it('keeps a CDATA section one when its text changes', () => {
    expect(written('<r><a id="1"><![CDATA[x<y]]></a></r>', '<r><a id="1">x&lt;y</a></r>', '<r><a id="1">x&lt;z</a></r>')).toBe('<r><a id="1"><![CDATA[x<z]]></a></r>');
  });

  it('leaves text with the end of a CDATA section as moddle wrote it', () => {
    expect(written('<r><a id="1"><![CDATA[x]]></a></r>', '<r><a id="1">x</a></r>', '<r><a id="1">]]&gt;</a></r>')).toBe('<r><a id="1">]]&gt;</a></r>');
  });

  it('gives mixed content as moddle wrote it', () => {
    expect(written('<r><a id="1">x<b/></a></r>', '<r><a id="1">x<b/></a></r>', '<r><a id="1">y<b/></a></r>')).toBe('<r><a id="1">y<b/></a></r>');
  });

  it('empties an element and closes it short', () => {
    expect(written('<r><a id="1">\n  <b/>\n</a></r>', '<r><a id="1"><b/></a></r>', '<r><a id="1"/></r>')).toBe('<r><a id="1"/></r>');
    expect(written('<r><a id="1">x</a></r>', '<r><a id="1">x</a></r>', '<r><a id="1"></a></r>')).toBe('<r><a id="1" /></r>');
  });

  it('keeps an empty element open with its inner text when an attribute changes', () => {
    expect(written('<r><a id="1">  </a></r>', '<r><a id="1"/></r>', '<r><a id="1" x="2"/></r>')).toBe('<r><a id="1" x="2">  </a></r>');
  });

  it('refuses roots that differ', () => {
    expect(() => written('<r/>', '<r/>', '<s/>')).toThrow('the root elements differ');
  });
});
