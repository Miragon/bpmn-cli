import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { EngineScope } from '../../support/EngineScope.js';
import { LinkEvents } from '../../support/LinkEvents.js';
import { C7EventDefinitions } from './C7EventDefinitions.js';

/** The link events of a process the engines run, by the name of the link definition they act on. */
export class C7Links {
  static of(process: ModdleElement): LinkEvents {
    return new LinkEvents(process, (node) => (EngineScope.C7.contains(node) ? (new C7EventDefinitions(node).ofType('bpmn:LinkEventDefinition')?.name ?? undefined) : undefined));
  }

  static namePath(event: ModdleElement): (string | number)[] {
    const definitions = new C7EventDefinitions(event);
    return definitions.pathTo(definitions.ofType('bpmn:LinkEventDefinition'), 'name');
  }
}
