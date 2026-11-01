import { describe, expect, it } from 'vitest';
import { ModdleParser } from '../../../src/model/xml/ModdleParser.js';
import { OverwriteWatch } from '../../../src/model/xml/OverwriteWatch.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('OverwriteWatch', () => {
  it('records which of two elements the reader kept', async () => {
    const moddle = ModdleParser.moddle();
    const watch = new OverwriteWatch(moddle);

    await moddle.fromXML(Fixtures.text('model/lossy.bpmn'));
    watch.stop();

    expect(watch.warnings().map(({ message }) => message)).toEqual([
      'duplicate element: <bpmn:task id="task_twice"> has more than one loopCharacteristics (the schema allows one); only the last one, multiInstanceLoopCharacteristics loop_second, can be kept, standardLoopCharacteristics loop_first would be dropped',
    ]);
  });

  it('stays out of the way of reads that overwrite nothing, and leaves no trace on stop', async () => {
    const moddle = ModdleParser.moddle();
    const before = Object.getOwnPropertyDescriptor(moddle, 'properties');
    const watch = new OverwriteWatch(moddle);

    await moddle.fromXML(Fixtures.text('model/c7-vendor.bpmn'));
    watch.stop();

    expect(watch.warnings()).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(moddle, 'properties')).toEqual(before);
    expect(Object.hasOwn((moddle as unknown as { properties: object }).properties, 'set')).toBe(false);
  });
});
