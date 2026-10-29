import { is } from 'bpmnlint-utils';
import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { ElementKinds } from '../../support/ElementKinds.js';
import { C7EventDefinitions } from './C7EventDefinitions.js';
import { C7FlowGraph } from './C7FlowGraph.js';

const WAITING_TRIGGERS = ['message', 'timer', 'signal', 'conditional'];

/** A branch of an event-based gateway: its flow, the target, and the definitions the engines act on when the target is an intermediate catch event. */
interface Branch {
  flow: ModdleElement;
  target: ModdleElement;
  definitions: ModdleElement[] | undefined;
}

/** The branches of an event-based gateway as the engines read them. */
export class C7EventGateway {
  static branches(gateway: ModdleElement): Branch[] {
    return C7FlowGraph.forElement(gateway).outgoing(gateway).filter((flow) => flow.targetRef).map((flow) => ({ flow, target: flow.targetRef, definitions: is(flow.targetRef, 'bpmn:IntermediateCatchEvent') ? new C7EventDefinitions(flow.targetRef).actedOn() : undefined }));
  }

  /** Whether a catch event with these definitions waits for one message, timer, signal or condition. */
  static waits(definitions: ModdleElement[]): boolean {
    return definitions.length === 1 && WAITING_TRIGGERS.includes(ElementKinds.trigger(definitions[0]));
  }
}
