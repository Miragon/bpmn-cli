import { is } from 'bpmnlint-utils';

import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { ZEEBE_URI } from './namespaces.js';
import { sh } from '../../shell.js';

/** How `bpmn set` and `bpmn ext` address an element nested in a flow node or flow. */
const SLOTS: Record<string, string> = {
  eventDefinitions: 'definition',
  loopCharacteristics: 'loop',
  conditionExpression: 'condition',
};

/**
 * The `bpmn` commands a Camunda 8 hint gives for one BPMN element: addressed by its id, or by the
 * id of its flow node or flow and a slot (`definition.`, `loop.`) for a nested one, with zeebe
 * elements spelled with the prefix the file declares.
 */
export class ZeebeHint {
  private constructor(
    readonly target: string,
    private readonly slot: string,
    private readonly prefix: string,
  ) {}

  /** The hint commands for `el`; undefined when `bpmn` cannot address it (no id, not nested). */
  static of(el: ModdleElement): ZeebeHint | undefined {
    const prefix = ZeebeHint.prefixOf(el);
    const parent = el.$parent;
    const slot = parent?.id ? ZeebeHint.slotIn(parent, el) : undefined;
    if (slot !== undefined) {
      return new ZeebeHint(parent.id, slot, prefix);
    }
    return el.id ? new ZeebeHint(el.id, '', prefix) : undefined;
  }

  /** `zeebe:taskDefinition` for `taskDefinition`, in the file's spelling. */
  name(local: string): string {
    return `${this.prefix}:${local}`;
  }

  /** The element name of a typed zeebe element, `zeebe:taskDefinition` for `zeebe:TaskDefinition`. */
  nameOf(element: ModdleElement): string {
    const type = String(element.$type);
    const local = type.slice(type.indexOf(':') + 1);
    return this.name(`${local.charAt(0).toLowerCase()}${local.slice(1)}`);
  }

  /** `` `bpmn ext add <file> <id> <slot><args>` `` */
  extAdd(args: string): string {
    const space = args.indexOf(' ');
    const first = space === -1 ? args : args.slice(0, space);
    const rest = space === -1 ? '' : args.slice(space);
    return `\`bpmn ext add <file> ${this.target} ${sh(`${this.slot}${first}`)}${rest}\``;
  }

  /** `` `bpmn ext remove <file> <id> <slot><selector>` `` */
  extRemove(selector: string | number): string {
    return `\`bpmn ext remove <file> ${this.target} ${sh(`${this.slot}${selector}`)}\``;
  }

  /** `` `bpmn set <file> <id> <slot><key>=` ``, which removes an attribute. */
  unset(key: string): string {
    return `\`bpmn set <file> ${this.target} ${sh(`${this.slot}${key}=`)}\``;
  }

  /** How to rebuild a zeebe element with its content (`zeebe:taskListeners`): list it, then add it again. */
  rebuild(name: string): string {
    return `See it with \`bpmn ext list <file> ${this.target} --json\`, then rebuild it: \`bpmn ext add <file> ${this.target} ${sh(`${this.slot}${name}`)} --replace --xml '<${name} ...>...</${name}>'\`.`;
  }

  /**
   * `bpmn ext add --replace` that writes the zeebe element anew with `fix` laid over its
   * attributes (it replaces the element as a whole); the rebuild hint when it has child elements.
   */
  replace(element: ModdleElement, fix: Record<string, string>): string {
    if (ZeebeHint.hasChildren(element)) {
      return this.rebuild(this.nameOf(element));
    }
    const attributes = { ...ZeebeHint.attributesOf(element), ...fix };
    const args = Object.entries(attributes).map(([key, value]) => sh(`${key}=${value}`));
    return `${this.extAdd([this.nameOf(element), ...args, '--replace'].join(' '))}.`;
  }

  private static attributesOf(element: ModdleElement): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (const property of element.$descriptor?.properties ?? []) {
      const value = element[property.name];
      const isWritten = Object.hasOwn(element, property.name);
      if (property.isAttr && isWritten && value !== undefined && value !== null && typeof value !== 'object') {
        attributes[property.name] = String(value);
      }
    }
    for (const [key, value] of Object.entries(element.$attrs ?? {})) {
      if (!key.startsWith('xmlns') && value !== undefined && value !== null) {
        attributes[key] = String(value);
      }
    }
    return attributes;
  }

  private static hasChildren(element: ModdleElement): boolean {
    return (element.$descriptor?.properties ?? []).some((property: { name: string; isAttr?: boolean }) => {
      const value = element[property.name];
      return !property.isAttr && (Array.isArray(value) ? value.length > 0 : value !== undefined && typeof value === 'object');
    });
  }

  /** The slot of `el` in `parent` (`definition[1].` when there are several definitions), if it is nested there. */
  private static slotIn(parent: ModdleElement, el: ModdleElement): string | undefined {
    for (const [property, slot] of Object.entries(SLOTS)) {
      const value = parent[property];
      if (value === el) {
        return `${slot}.`;
      }
      if (Array.isArray(value) && value.includes(el)) {
        return value.length > 1 ? `${slot}[${value.indexOf(el)}].` : `${slot}.`;
      }
    }
    return undefined;
  }

  /** The prefix the diagram of `el` declares for the zeebe namespace, `zeebe` when it declares none. */
  static prefixOf(el: ModdleElement): string {
    let definitions = el;
    while (definitions && !is(definitions, 'bpmn:Definitions')) {
      definitions = definitions.$parent;
    }
    const declaration = Object.entries(definitions?.$attrs ?? {}).find(
      ([name, uri]) => name.startsWith('xmlns:') && uri === ZEEBE_URI,
    );
    return declaration ? declaration[0].slice('xmlns:'.length) : 'zeebe';
  }
}
