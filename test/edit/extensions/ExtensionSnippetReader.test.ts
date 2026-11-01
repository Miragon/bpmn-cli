import { describe, expect, it } from 'vitest';
import { ExtensionSnippetReader } from '../../../src/edit/extensions/ExtensionSnippetReader.js';
import { NestedHosts } from '../../../src/edit/extensions/NestedHosts.js';
import { VendorElements } from '../../../src/edit/extensions/VendorElements.js';
import { Fixtures } from '../../support/Fixtures.js';

async function reader() {
  const document = await Fixtures.readForWrite('edit/extensions-camunda.bpmn');
  const names = new VendorElements(document, NestedHosts.INSTANCE);
  return { document, names, snippets: new ExtensionSnippetReader(names, NestedHosts.INSTANCE), call: document.tree.require('call') };
}

describe('ExtensionSnippetReader', () => {
  it('builds one element per root, with attributes, text and children', async () => {
    const { snippets, names, call } = await reader();

    const [io, retry] = snippets.parse(call, `<?xml version="1.0"?><!-- two roots -->
      <camunda:inputOutput><camunda:inputParameter name='a&amp;b'>1 &lt; 2</camunda:inputParameter><camunda:outputParameter name="r" /></camunda:inputOutput>
      <camunda:failedJobRetryTimeCycle>R1/PT1M</camunda:failedJobRetryTimeCycle>`);

    const [input, output] = names.kidsOf(io!);
    expect(names.attrsOf(input!)).toEqual({ name: 'a&b' });
    expect(names.bodyOf(input!)).toBe('1 < 2');
    expect(output!.parent).toBe(io);
    expect(names.bodyOf(retry!)).toBe('R1/PT1M');
  });

  it('keeps CDATA as text and drops the white space around children', async () => {
    const { snippets, names, call } = await reader();

    const [script, wrapper] = snippets.parse(call, '<camunda:script><![CDATA[a < b]]></camunda:script><camunda:inputOutput>\n  <camunda:inputParameter name="x" />\n</camunda:inputOutput>');

    expect(names.bodyOf(script!)).toBe('a < b');
    expect(names.bodyOf(wrapper!)).toBeUndefined();
  });

  it('resolves a prefix the snippet binds itself, on its children too', async () => {
    const { snippets, document, call } = await reader();

    const [root] = snippets.parse(call, '<c:inputOutput xmlns:c="http://camunda.org/schema/1.0/bpmn"><c:inputParameter name="x" /></c:inputOutput>');

    expect(root!.type).toBe('camunda:inputOutput');
    expect(new VendorElements(document, NestedHosts.INSTANCE).kidsOf(root!)[0]!.type).toBe('camunda:inputParameter');
  });

  it.each([
    ['text outside of an element', 'hello <camunda:script />', 'text "hello" outside of an element'],
    ['an element left open', '<camunda:script>', 'unclosed element <camunda:script>'],
    ['a comment left open', '<!-- nothing', 'unterminated comment'],
    ['CDATA left open', '<camunda:script><![CDATA[x', 'unterminated CDATA section'],
    ['CDATA outside of an element', '<![CDATA[x]]>', 'CDATA outside of an element'],
    ['a processing instruction left open', '<?xml', 'unterminated processing instruction'],
    ['a doctype', '<!DOCTYPE x>', 'declarations (<!DOCTYPE ...>) are not allowed'],
    ['a closing tag left open', '<camunda:script></camunda:script', 'unterminated closing tag'],
    ['a closing tag without an opening tag', '</camunda:script>', 'unexpected closing tag </camunda:script>'],
    ['a closing tag of another element', '<camunda:a></camunda:b>', 'unexpected closing tag </camunda:b>, expected </camunda:a>'],
    ['a tag without a name', '< camunda:a/>', 'invalid tag at offset 0'],
    ['an attribute without quotes', '<camunda:a name=x />', 'invalid attribute syntax in <camunda:a>'],
  ])('refuses %s as invalid XML, on the task', async (_case, xml, why) => {
    const { snippets, call } = await reader();

    expect(() => snippets.parse(call, xml)).toThrow(expect.objectContaining({ code: 'E_INVALID_XML', message: expect.stringContaining(why), details: expect.objectContaining({ element: 'call' }) }));
  });

  it('refuses a snippet without an element', async () => {
    const { snippets, call } = await reader();

    expect(() => snippets.parse(call, '<!-- only this -->')).toThrow(expect.objectContaining({ code: 'E_INVALID_XML', message: 'The extension snippet contains no elements' }));
  });

  it('refuses a default namespace, which extension elements cannot use', async () => {
    const { snippets, call } = await reader();

    expect(() => snippets.parse(call, '<camunda:a xmlns="http://x" />')).toThrow(expect.objectContaining({ code: 'E_INVALID_XML', message: expect.stringContaining('declares a default namespace') }));
  });

  it('accepts a bpmn: root only where it nests inside a vendor element', async () => {
    const { snippets, call } = await reader();
    const timer = '<bpmn:timerEventDefinition />';

    expect(snippets.parse(call, timer, true)[0]!.type).toBe('bpmn:timerEventDefinition');
    expect(() => snippets.parse(call, timer)).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE' }));
  });
});
