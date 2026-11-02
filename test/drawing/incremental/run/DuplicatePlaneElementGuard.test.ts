import { describe, expect, it } from 'vitest';
import { DuplicatePlaneElementGuard } from '../../../../src/drawing/incremental/run/DuplicatePlaneElementGuard.js';
import type { BpmnElement } from '../../../support/ModelValues.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('DuplicatePlaneElementGuard', () => {
  const planeOf = (definitions: BpmnElement): BpmnElement => definitions.list('diagrams')[0]!.peek<BpmnElement>('plane')!;

  it('passes a drawing that keeps one DI per element', async () => {
    const { tree } = await Fixtures.read('models/incremental/pool.bpmn');

    expect(() => new DuplicatePlaneElementGuard(tree.definitions).assertNone(tree.definitions)).not.toThrow();
  });

  it('refuses a second DI element on one plane', async () => {
    const { tree } = await Fixtures.read('models/incremental/pool.bpmn');
    const guard = new DuplicatePlaneElementGuard(tree.definitions);
    const plane = planeOf(tree.definitions);

    plane.add('planeElement', tree.build('bpmndi:BPMNShape', { id: 'Twice_di', bpmnElement: tree.require('A') }));

    expect(() => guard.assertNone(tree.definitions)).toThrow(/drew A twice/);
  });

  it('leaves a duplicate the file already had alone', async () => {
    const { tree } = await Fixtures.read('models/incremental/pool.bpmn');
    const plane = planeOf(tree.definitions);
    plane.add('planeElement', tree.build('bpmndi:BPMNShape', { id: 'Twice_di', bpmnElement: tree.require('A') }));

    expect(() => new DuplicatePlaneElementGuard(tree.definitions).assertNone(tree.definitions)).not.toThrow();
  });
});
