import { describe, expect, it } from 'vitest';
import { PlatformDetection } from '../../../src/model/vendor/PlatformDetection.js';
import { Fixtures } from '../../support/Fixtures.js';

const ZEEBE = 'http://camunda.org/schema/zeebe/1.0';
const CAMUNDA = 'http://camunda.org/schema/1.0/bpmn';
const OPERATON = 'http://operaton.org/schema/1.0/bpmn';
const MODELER = 'http://camunda.org/schema/modeler/1.0';
const OPERATON_NOTE = 'only Operaton reads the operaton namespace, Camunda 7 and CIB seven ignore it';

describe('PlatformDetection', () => {
  it('takes the platform the modeler declared before anything the file uses', async () => {
    const document = await Fixtures.read('model/c8-vendor.bpmn');

    expect(new PlatformDetection(document.tree.definitions).info()).toEqual({ platform: 'c8', source: 'executionPlatform', detail: 'modeler:executionPlatform "Camunda Cloud"' });
  });

  it('counts the vendor attributes and elements when nothing is declared, and the engine with more of them wins', async () => {
    const camunda = await Fixtures.read('model/c7-vendor.bpmn');
    const operaton = await Fixtures.read('model/operaton.bpmn');

    expect(new PlatformDetection(camunda.tree.definitions).info()).toEqual({ platform: 'c7', source: 'namespace-use', detail: '6 camunda attribute(s)/element(s)' });
    expect(new PlatformDetection(operaton.tree.definitions).info()).toEqual({ platform: 'c7', source: 'namespace-use', detail: `2 operaton attribute(s)/element(s); ${OPERATON_NOTE}`, operaton: true });
  });

  it('adds the operaton note to a platform that came from the declaration', async () => {
    const document = await Fixtures.read('model/operaton.bpmn');
    document.tree.definitions.attrs['xmlns:modeler'] = MODELER;
    document.tree.definitions.attrs['modeler:executionPlatform'] = 'Camunda Platform';

    expect(new PlatformDetection(document.tree.definitions).info()).toEqual({
      platform: 'c7',
      source: 'executionPlatform',
      detail: `modeler:executionPlatform "Camunda Platform"; 2 operaton attribute(s)/element(s): ${OPERATON_NOTE}`,
      operaton: true,
    });
  });

  it.each([
    ['declares a modeler platform of Camunda 7', { 'xmlns:modeler': MODELER, 'modeler:executionPlatform': 'CIB seven' }, 'c7', 'executionPlatform', 'modeler:executionPlatform "CIB seven"'],
    ['declares only the zeebe namespace', { 'xmlns:zeebe': ZEEBE }, 'c8', 'namespace-declaration', 'xmlns:zeebe declared (no vendor content yet)'],
    ['declares the camunda and operaton namespaces', { 'xmlns:camunda': CAMUNDA, 'xmlns:operaton': OPERATON }, 'c7', 'namespace-declaration', 'xmlns:camunda and xmlns:operaton declared (no vendor content yet)'],
    ['declares both engines without using either', { 'xmlns:camunda': CAMUNDA, 'xmlns:zeebe': ZEEBE }, 'none', 'none', 'xmlns:camunda and xmlns:zeebe declared, but no vendor content tells which engine'],
    ['declares a platform nobody knows', { 'xmlns:modeler': MODELER, 'modeler:executionPlatform': 'Nonsense' }, 'none', 'none', 'unknown modeler:executionPlatform "Nonsense", no vendor content'],
    ['declares nothing', {}, 'none', 'none', 'no executionPlatform and no vendor namespace'],
  ] as const)('tells a file that %s apart without vendor content', async (_what, attrs, platform, source, detail) => {
    const document = await Fixtures.read('model/events.bpmn');
    Object.assign(document.tree.definitions.attrs, attrs);

    expect(new PlatformDetection(document.tree.definitions).info()).toEqual({ platform, source, detail });
  });

  it('maps a deployment target to its platform, and no target to none', () => {
    expect(PlatformDetection.TARGETS.map((target) => PlatformDetection.platformOfTarget(target))).toEqual(['c8', 'c7', 'none']);
    expect(PlatformDetection.platformOfTarget(undefined)).toBe('none');
  });
});
