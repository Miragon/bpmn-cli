import { describe, expect, it } from 'vitest';
import { XmlTextError } from '../../../src/model/xml/XmlTextError.js';
import { XmlTextReader } from '../../../src/model/xml/XmlTextReader.js';

describe('XmlTextReader', () => {
  const text = `<?xml version="1.0"?>\n<a:root xmlns:a="urn:a" xmlns="urn:d" a:x='1' id="r&amp;1">\n  <!-- note -->\n  <child id="c"><![CDATA[<raw>]]></child>\n  <leaf/>\n</a:root>\n`;

  it('keeps the positions, namespaces and attributes of every element', () => {
    const document = XmlTextReader.read(text);
    const { root } = document;
    const [child, leaf] = XmlTextReader.elementChildren(root);

    expect([root.name, root.uri, root.local]).toEqual(['a:root', 'urn:a', 'root']);
    expect(XmlTextReader.rawOf(document, leaf!)).toBe('<leaf/>');
    expect([leaf!.selfClosing, leaf!.uri, child!.parent]).toEqual([true, 'urn:d', root]);
    expect(document.comments).toBe(1);
  });

  it('expands entities only where it reads an id', () => {
    const { root } = XmlTextReader.read(text);

    expect(root.attrs.at(-1)!.raw).toBe('r&amp;1');
    expect(XmlTextReader.idOf(root)).toBe('r&1');
    expect(XmlTextReader.idOf(XmlTextReader.read('<a/>').root)).toBeUndefined();
  });

  it('tells character data from whitespace between children', () => {
    const document = XmlTextReader.read(text);
    const [child, leaf] = XmlTextReader.elementChildren(document.root);

    expect(XmlTextReader.hasCharacterData(document, child!)).toBe(true);
    expect(XmlTextReader.hasCharacterData(document, document.root)).toBe(false);
    expect(XmlTextReader.hasCharacterData(document, leaf!)).toBe(false);
  });

  it('keys a prefixed attribute by its namespace, so another prefix is the same attribute', () => {
    const { root } = XmlTextReader.read(text);
    const keys = root.attrs.map((attr) => XmlTextReader.attrKey(root, attr));

    expect(keys).toEqual(['xmlns:a', 'xmlns', '{urn:a}x', 'id']);
  });

  it('decodes the five named entities and numeric ones, and leaves unknown ones', () => {
    expect(XmlTextReader.decode('&lt;&gt;&amp;&quot;&apos;&#65;&#x42;&nope;')).toBe(`<>&"'AB&nope;`);
  });

  it.each([
    ['', 'no root element'],
    ['text', 'text outside the root element'],
    ['<![CDATA[x]]>', 'CDATA outside the root element'],
    ['<!DOCTYPE a><a/>', 'DOCTYPE and other declarations are not supported'],
    ['<a/><b/>', 'a second root element'],
    ['<a>', 'unclosed element <a>'],
    ['<a></b>', 'end tag </b> does not match <a>'],
    ['<a', 'unterminated start tag'],
    ['<a b="1"c="2"/>', 'missing whitespace before an attribute'],
    ['< a/>', 'malformed start tag'],
    ['<a =""/>', 'malformed attribute'],
    ['<a b/>', 'attribute b without a value'],
    ['<a b=1/>', 'unquoted value of b'],
    ['<a b="<"/>', '"<" in the value of b'],
    ['<a b="1" b="2"/>', 'duplicate attribute b'],
    ['<p:a/>', 'unbound prefix p'],
    ['<a p:b="1"/>', 'unbound prefix p'],
    ['<a><!-- x', 'unterminated comment'],
  ])('refuses %s', (broken, message) => {
    expect(() => XmlTextReader.read(broken)).toThrow(XmlTextError);
    expect(() => XmlTextReader.read(broken)).toThrow(message);
  });
});
