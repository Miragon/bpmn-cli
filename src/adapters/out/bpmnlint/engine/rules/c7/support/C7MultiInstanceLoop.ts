import { is } from 'bpmnlint-utils';
import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { C7Diagram } from './C7Diagram.js';
import { CamundaAttributes } from './CamundaAttributes.js';

/** The multi-instance loop of an activity and what it iterates over. */
export class C7MultiInstanceLoop {
  readonly attributes: CamundaAttributes;

  private constructor(readonly loop: ModdleElement) {
    this.attributes = new CamundaAttributes(loop);
  }

  static of(activity: ModdleElement): C7MultiInstanceLoop | undefined {
    const loop = is(activity, 'bpmn:Activity') ? activity.get('loopCharacteristics') : undefined;
    return loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics') ? new C7MultiInstanceLoop(loop) : undefined;
  }

  get cardinality(): ModdleElement | undefined {
    return this.loop.get('loopCardinality');
  }

  /** A camunda:collection, or a `loopDataInputRef`, which the engines read as a variable name, also one that is no id of the file. */
  get hasCollection(): boolean {
    return this.attributes.defined('collection') !== undefined || !!this.loop.get('loopDataInputRef') || C7Diagram.unresolved(this.loop).has('loopDataInputRef');
  }
}
