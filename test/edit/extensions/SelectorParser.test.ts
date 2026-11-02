import { describe, expect, it } from 'vitest';
import { NestedHosts } from '../../../src/edit/extensions/NestedHosts.js';
import { SelectorParser } from '../../../src/edit/extensions/SelectorParser.js';
import { Fixtures } from '../../support/Fixtures.js';

async function parser() {
  const document = await Fixtures.read('edit/extensions-camunda.bpmn');
  return { selectors: new SelectorParser(NestedHosts.INSTANCE), call: document.tree.require('call') };
}

describe('SelectorParser', () => {
  it('reads a path of steps with a key and a position', async () => {
    const { selectors, call } = await parser();

    expect(selectors.parse(" camunda:connector[0]/camunda:inputParameter[name = 'url'] ", call)).toEqual([
      { name: 'camunda:connector', index: 0, text: 'camunda:connector[0]' },
      { name: 'camunda:inputParameter', attr: 'name', value: 'url', text: "camunda:inputParameter[name = 'url']" },
    ]);
  });

  it('keeps a closing bracket and an equals sign inside a quoted key', async () => {
    const { selectors, call } = await parser();

    expect(selectors.parse('camunda:property[name="a]=b"]', call)[0]).toMatchObject({ attr: 'name', value: 'a]=b' });
    expect(selectors.parse('camunda:property[name=plain]', call)[0]).toMatchObject({ value: 'plain' });
  });

  it.each([
    ['a step without a prefix', 'inputParameter', 'expected prefix:type at offset 0'],
    ['an empty step after a slash', 'camunda:inputOutput/', 'expected prefix:type at offset 20'],
    ['a bracket left open', 'camunda:property[name=a', 'unclosed ['],
    ['a quote left open', 'camunda:property[name="a]', 'unclosed ['],
    ['a selection that is neither key nor position', 'camunda:property[name]', 'expected [attr=value] or [index], got [name]'],
    ['a selection without a key', 'camunda:property[=x]', 'expected [attr=value] or [index]'],
    ['text after a step', 'camunda:property[0]x', 'unexpected "x" at offset 19'],
  ])('refuses %s as an invalid value of the task', async (_case, text, why) => {
    const { selectors, call } = await parser();

    expect(() => selectors.parse(text, call)).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE', message: expect.stringContaining(why), details: expect.objectContaining({ element: 'call' }) }));
  });
});
