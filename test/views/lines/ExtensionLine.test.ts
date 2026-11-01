import { describe, expect, it } from 'vitest';
import { ExtensionLine } from '../../../src/views/lines/ExtensionLine.js';

describe('ExtensionLine', () => {
  it('prints an input and output mapping on one line with its values', () => {
    const inputOutput = {
      type: 'camunda:inputOutput',
      attrs: {},
      children: [
        { type: 'camunda:inputParameter', attrs: { name: 'policyId' }, body: '${policyId}' },
        { type: 'camunda:outputParameter', attrs: { name: 'covered' }, body: '${covered}' },
      ],
    };

    expect(new ExtensionLine(inputOutput).lines('ext 0: ')).toEqual(['ext 0: camunda:inputOutput  in policyId=${policyId}  out covered=${covered}']);
  });

  it('prints a Zeebe mapping by its target and source', () => {
    const mapping = { type: 'zeebe:ioMapping', attrs: {}, children: [{ type: 'zeebe:input', attrs: { source: '=order.total', target: 'amount' } }] };

    expect(new ExtensionLine(mapping).lines()).toEqual(['zeebe:ioMapping  in amount==order.total']);
  });

  it('falls back to one line per element when a parameter holds a script', () => {
    const inputOutput = { type: 'camunda:inputOutput', attrs: {}, children: [{ type: 'camunda:inputParameter', attrs: { name: 'x' }, children: [{ type: 'camunda:script', attrs: { scriptFormat: 'js' }, body: 'one' }] }] };

    expect(new ExtensionLine(inputOutput).lines('ext 0: ')).toEqual(['ext 0: camunda:inputOutput', '         camunda:inputParameter name="x"', '           camunda:script scriptFormat="js" body="one"']);
  });

  it('keeps a multi-line body line by line, a blank line included', () => {
    const script = { type: 'camunda:script', attrs: {}, body: '\n first\n\n second  \n' };

    expect(new ExtensionLine(script).lines()).toEqual(['camunda:script body:', '  |  first', '  |', '  |  second']);
  });
});
