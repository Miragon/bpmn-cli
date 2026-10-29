import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import type { EngineKit } from '../../../../engine-kit.js';
import { ZEEBE_URI } from '../../support/DiagramNamespaces.js';
import { EngineScope } from '../../support/EngineScope.js';
import { RuleKit } from '../../RuleKit.js';
import { VendorHost } from '../../support/VendorHost.js';
import { C8EventDefinitions } from './C8EventDefinitions.js';
import { ZeebeHint } from './ZeebeHint.js';

export type ZeebeType = NonNullable<ReturnType<EngineKit['ZEEBE']['type']>>;

/**
 * How Camunda 8 treats a zeebe extension element where it sits: `read`, `loose` (a child element
 * outside its container), `flowListeners` (execution listeners on a sequence flow, refused) or
 * `misplaced` (on a host that does not read it).
 */
type ZeebePlacement = 'read' | 'loose' | 'flowListeners' | 'misplaced';

/** A typed zeebe element in the extension elements of a BPMN element. */
export interface ZeebeValue {
  value: ModdleElement;
  /** Its index in `extensionElements.values`. */
  index: number;
  type: ZeebeType;
  placement: ZeebePlacement;
}

/**
 * A BPMN element whose vendor content Camunda 8 reads: an element of an executable process (not
 * inside a transaction, which Camunda 8 refuses as a whole) or a message that process uses, with
 * an id of its own or of an element around it to report on.
 */
export class C8Host extends VendorHost {
  static of(node: ModdleElement): C8Host | undefined {
    const type = String(node?.$type ?? '');
    if (!type.startsWith('bpmn:') || is(node, 'bpmn:Definitions') || node.$descriptor?.isGeneric || !C8Host.readsExtensionsOf(node)) return undefined;
    for (let ancestor = node; ancestor; ancestor = ancestor.$parent) if (is(ancestor, 'bpmn:ExtensionElements')) return undefined;
    const host = new C8Host(node);
    return node.id || host.owner ? host : undefined;
  }

  /** Whether Camunda 8 reads the extension elements of `host`: in the engine's scope, or a message it uses. */
  static readsExtensionsOf(host: ModdleElement): boolean {
    return EngineScope.C8.runs(host) || C8EventDefinitions.isUsedMessage(host);
  }

  /** The BPMN element whose extension elements hold `node` directly, when Camunda 8 reads it there: it reads the host's extensions and the type is allowed on it. */
  static readHostOf(node: ModdleElement): ModdleElement | undefined {
    if (!node.$parent || !is(node.$parent, 'bpmn:ExtensionElements')) return undefined;
    const host = node.$parent.$parent;
    const allowedIn: string[] | undefined = node.$model?.getTypeDescriptor(node.$type)?.meta?.allowedIn;
    return host && C8Host.readsExtensionsOf(host) && (!allowedIn || allowedIn.some((type) => is(host, type))) ? host : undefined;
  }

  /** The extension elements of `host` of one type (`zeebe:TaskDefinition`), in document order. */
  static valuesOf(host: ModdleElement, type: string): ModdleElement[] {
    return (host?.extensionElements?.values ?? []).filter((value: ModdleElement) => value.$type === type);
  }

  /** The commands a hint gives for this element; undefined when `bpmn` cannot address it. */
  hint(): ZeebeHint | undefined {
    return ZeebeHint.of(this.node);
  }

  /** A zeebe name (`zeebe:taskDefinition`) with the prefix the file declares for the zeebe namespace. */
  spell(name: string): string {
    return name.replace(/^zeebe:/, `${ZeebeHint.prefixOf(this.node)}:`);
  }

  /** The keys of the zeebe attributes the moddle left in `$attrs`. */
  zeebeAttributeKeys(): string[] {
    return this.foreignAttributes().filter(({ uri }) => uri === ZEEBE_URI).map(({ key }) => key);
  }

  extensionValues(): ModdleElement[] {
    return this.node.extensionElements?.values ?? [];
  }

  /** The typed zeebe elements in the extension elements, with how Camunda 8 treats each. */
  zeebeValues(): ZeebeValue[] {
    return this.extensionValues().flatMap((value, index) => {
      const type = value.$descriptor?.isGeneric || !String(value.$type).startsWith('zeebe:') ? undefined : RuleKit.kit.ZEEBE.type(value.$type);
      return type ? [{ value, index, type, placement: this.placementOf(type) }] : [];
    });
  }

  private placementOf(type: ZeebeType): ZeebePlacement {
    if (RuleKit.kit.ZEEBE.nestedOnly(type.name)) return 'loose';
    if (type.name === 'zeebe:executionListeners' && is(this.node, 'bpmn:SequenceFlow')) return 'flowListeners';
    return RuleKit.kit.ZEEBE.allowedOn(type.name, this.node) === false ? 'misplaced' : 'read';
  }
}
