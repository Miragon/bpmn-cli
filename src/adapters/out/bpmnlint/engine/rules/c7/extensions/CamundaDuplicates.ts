import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import type { C7Host, HostExtension } from './C7Host.js';

const SERVICE_LIKE = ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:BusinessRuleTask'];
const ASYNC_ATTRIBUTES = ['async', 'asyncBefore', 'asyncAfter'];

/** Two or more camunda extension elements of one type the engines look up as a single element. */
interface DuplicateGroup {
  local: string;
  extensions: HostExtension[];
  /** Whether the engines read the type on this host now (they refuse the file), or only once it runs asynchronously. */
  isRead: boolean;
}

/**
 * The camunda extension elements of a host the engines read with a single-element lookup and
 * refuse to deploy twice (ENGINE-01009): inputOutput on flow nodes, connector on service-like
 * tasks, formData on user tasks and start events, failedJobRetryTimeCycle on asynchronous
 * elements and timer events.
 */
export class CamundaDuplicates {
  constructor(private readonly host: C7Host) {}

  groups(): DuplicateGroup[] {
    const byLocal = new Map<string, HostExtension[]>();
    for (const extension of this.host.camundaExtensions()) {
      byLocal.set(extension.local, [...(byLocal.get(extension.local) ?? []), extension]);
    }
    const groups: DuplicateGroup[] = [];
    for (const [local, extensions] of byLocal) {
      const isRead = this.isRead(local);
      if (extensions.length >= 2 && isRead !== undefined) {
        groups.push({ local, extensions, isRead });
      }
    }
    return groups;
  }

  /** undefined for a type whose duplicates do not matter on this host. */
  private isRead(local: string): boolean | undefined {
    const node = this.host.node;
    switch (local) {
      case 'inputOutput':
        return is(node, 'bpmn:FlowNode') ? true : undefined;
      case 'connector':
        return SERVICE_LIKE.some((type) => is(node, type)) ? true : undefined;
      case 'formData':
        return is(node, 'bpmn:UserTask') || is(node, 'bpmn:StartEvent') ? true : undefined;
      case 'failedJobRetryTimeCycle':
        return this.isAsync(node) || this.hasTimer(node);
      default:
        return undefined;
    }
  }

  private isAsync(node: ModdleElement): boolean {
    return ASYNC_ATTRIBUTES.some((local) => {
      const value = node.get(`camunda:${local}`);
      return value === true || value === 'true';
    });
  }

  private hasTimer(node: ModdleElement): boolean {
    return (node.eventDefinitions ?? []).some((definition: ModdleElement) =>
      is(definition, 'bpmn:TimerEventDefinition'),
    );
  }
}
