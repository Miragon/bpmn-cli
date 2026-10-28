import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { ExecutableScope } from './ExecutableScope.js';

/** The zeebe extension elements of a BPMN element, as Camunda 8 reads them. */
export class ZeebeExtensions {
  /** The extension elements of `host` of one type (`zeebe:TaskDefinition`), in document order. */
  static valuesOf(host: ModdleElement, type: string): ModdleElement[] {
    return (host?.extensionElements?.values ?? []).filter(
      (value: ModdleElement) => value.$type === type,
    );
  }

  /**
   * The BPMN element whose extension elements hold `node` directly, when Camunda 8 reads it there:
   * the host is checked (see {@link ExecutableScope}) and the type is allowed on it.
   */
  static readHostOf(node: ModdleElement): ModdleElement | undefined {
    if (!node.$parent || !is(node.$parent, 'bpmn:ExtensionElements')) {
      return undefined;
    }
    const host = node.$parent.$parent;
    if (!host || !ExecutableScope.coversHost(host) || !ZeebeExtensions.isAllowedOn(node, host)) {
      return undefined;
    }
    return host;
  }

  /** `zeebe:TaskDefinition` -> `zeebe:taskDefinition`, the element name a message shows. */
  static elementName(node: ModdleElement): string {
    const [prefix, local = ''] = String(node.$type).split(':');
    return `${prefix}:${local.charAt(0).toLowerCase()}${local.slice(1)}`;
  }

  private static isAllowedOn(node: ModdleElement, host: ModdleElement): boolean {
    const allowedIn: string[] | undefined = node.$model?.getTypeDescriptor(node.$type)?.meta
      ?.allowedIn;
    return !allowedIn || allowedIn.some((type) => is(host, type));
  }
}
