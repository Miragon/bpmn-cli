import { describe, expect, it } from 'vitest';
import { ElementLine } from '../../../src/views/lines/ElementLine.js';

describe('ElementLine', () => {
  it('names an element by kind, id and name', () => {
    const line = new ElementLine({ id: 'Activity_Pay', kind: 'serviceTask', name: 'Pay claim' });

    expect(line.named).toBe('Activity_Pay "Pay claim"');
    expect(line.ref).toBe('serviceTask Activity_Pay "Pay claim"');
    expect(new ElementLine({ id: 'Gateway_1', kind: 'exclusiveGateway' }).ref).toBe('exclusiveGateway Gateway_1');
  });

  it('brackets flags behind the element', () => {
    const line = new ElementLine({ id: 'End', kind: 'endEvent' });

    expect(line.flagged([])).toBe('endEvent End');
    expect(line.flagged(['lane=Lane_1', 'terminate'])).toBe('endEvent End [lane=Lane_1, terminate]');
  });

  it('prints flags in one order: leading, lane, trigger, state, props, vendor, documentation', () => {
    const flags = ElementLine.flagsOf(
      { lane: { id: 'Lane_1', kind: 'lane' }, trigger: 'PT1H', nonInterrupting: true, expanded: false, props: { loop: 'parallel' }, documentation: 'Waits for one hour' },
      { leading: ['on Task_1'], afterState: ['content: 2 nodes'], vendor: ['camunda:topic=pay'] },
    );

    expect(flags).toEqual(['on Task_1', 'lane=Lane_1', 'PT1H', 'non-interrupting', 'collapsed', 'content: 2 nodes', 'loop=parallel', 'camunda:topic=pay', 'doc: "Waits for one hour"']);
    expect(ElementLine.flagsOf({ expanded: true }, {})).toEqual(['expanded']);
  });

  it('counts repeated extension types behind the vendor attributes', () => {
    expect(ElementLine.vendorFlags({ attrs: { 'camunda:topic': 'two words' }, extensionElements: ['camunda:in', 'camunda:in', 'camunda:out'] })).toEqual(['camunda:topic="two words"', 'ext: camunda:in x2, camunda:out']);
    expect(ElementLine.vendorFlags({})).toEqual([]);
  });

  it('prints a value by its type', () => {
    expect(ElementLine.scalar('text')).toBe('text');
    expect(ElementLine.scalar(3)).toBe('3');
    expect(ElementLine.scalar(['a', 'b'])).toBe('a, b');
    expect(ElementLine.scalar({ a: 1 })).toBe('{"a":1}');
  });
});
