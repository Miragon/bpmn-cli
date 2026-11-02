import { describe, expect, it } from 'vitest';
import { ElementAligner } from '../../../src/model/xml/ElementAligner.js';
import { XmlTextReader, type XElement } from '../../../src/model/xml/XmlTextReader.js';

describe('ElementAligner', () => {
  function pairs(left: string, right: string, byText: boolean): Array<[string, string]> {
    const [leftDocument, rightDocument] = [XmlTextReader.read(left), XmlTextReader.read(right)];
    const raw = (text: string, element: XElement): string => text.slice(element.start, element.end);
    return [...new ElementAligner(leftDocument, rightDocument, byText).counterparts()].filter(([element]) => element.parent).map(([from, to]) => [raw(left, from), raw(right, to)]);
  }

  it('pairs siblings by unique id, across a retype and a move in order', () => {
    expect(pairs('<r><a id="1"/><b id="2"/></r>', '<r><b id="2"/><c id="1"/></r>', false)).toEqual(
      expect.arrayContaining([
        ['<a id="1"/>', '<c id="1"/>'],
        ['<b id="2"/>', '<b id="2"/>'],
      ]),
    );
  });

  it('leaves an id it finds twice unpaired', () => {
    expect(pairs('<r><a id="1"/><a id="1"/></r>', '<r><a id="1"/></r>', false)).toEqual([]);
  });

  it('pairs elements without id by name and order', () => {
    expect(pairs('<r><a x="1"/><a x="2"/><b/></r>', '<r><a x="3"/></r>', false)).toEqual([['<a x="1"/>', '<a x="3"/>']]);
  });

  it('pairs equal texts first when asked to go by text, then the rest in order', () => {
    expect(pairs('<r><a x="1"/><a x="2"/><a x="3"/></r>', '<r><a x="2"/><a x="9"/></r>', true)).toEqual(
      expect.arrayContaining([
        ['<a x="2"/>', '<a x="2"/>'],
        ['<a x="1"/>', '<a x="9"/>'],
      ]),
    );
  });

  it('finds no counterparts when the roots differ', () => {
    expect(new ElementAligner(XmlTextReader.read('<a/>'), XmlTextReader.read('<b/>'), false).counterparts().size).toBe(0);
  });
});
