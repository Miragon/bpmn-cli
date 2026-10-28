import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { sh, slotted } from '../../shell.js';
import { ZeebeExtensions } from '../tasks/ZeebeExtensions.js';

/** How `bpmn` addresses an element: its id, and the slot of a nested one (`loop.`, `definition.`). */
interface HintAddress {
  id: string;
  prefix: string;
}

/** The `bpmn ext` commands that fix a zeebe extension element, as bpmn-cli's hints write them. */
export class ZeebeFixHint {
  /**
   * The address of `el` through `owner`: `definition.` (or `definition[n].` among several),
   * `loop.` or `condition.` for a nested element, else the element's own id.
   */
  static addressOf(el: ModdleElement, owner: ModdleElement | undefined): HintAddress | undefined {
    const own = el.id ? { id: el.id, prefix: '' } : undefined;
    if (!owner || el === owner || !owner.id) {
      return own;
    }
    const definitions: ModdleElement[] = owner.eventDefinitions ?? [];
    if (definitions.includes(el)) {
      const prefix = definitions.length > 1 ? `definition[${definitions.indexOf(el)}].` : 'definition.';
      return { id: owner.id, prefix };
    }
    if (owner.loopCharacteristics === el) {
      return { id: owner.id, prefix: 'loop.' };
    }
    if (owner.conditionExpression === el) {
      return { id: owner.id, prefix: 'condition.' };
    }
    return own;
  }

  /** `bpmn ext add <file> <id> <args>` for the extension elements of `host`. */
  static extAdd(host: ModdleElement, owner: ModdleElement | undefined, args: string): string {
    const address = ZeebeFixHint.addressOf(host, owner);
    if (!address) {
      return 'edit the XML';
    }
    return `\`bpmn ext add <file> ${address.id} ${slotted(address.prefix, args)}\``;
  }

  /**
   * The command that rebuilds the flat `zeebeElement` with `fix` laid over its attributes
   * (`--replace` replaces it as a whole, so it carries every attribute), or the list-and-rebuild
   * hint when it has children.
   */
  static fix(
    host: ModdleElement,
    owner: ModdleElement | undefined,
    zeebeElement: ModdleElement,
    fix: Record<string, string>,
  ): string {
    if (ZeebeFixHint.hasChildren(zeebeElement)) {
      return ZeebeFixHint.rebuild(host, owner, ZeebeExtensions.elementName(zeebeElement));
    }
    const attributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(zeebeElement)) {
      if (!key.startsWith('$') && value !== undefined && value !== null && typeof value !== 'object') {
        attributes[key] = String(value);
      }
    }
    Object.assign(attributes, fix);
    const args = Object.entries(attributes).map(([key, value]) => sh(`${key}=${value}`));
    const type = ZeebeExtensions.elementName(zeebeElement);
    return `${ZeebeFixHint.extAdd(host, owner, [type, ...args, '--replace'].join(' '))}.`;
  }

  /** How to rebuild a zeebe element with its content: list it, then add it again with --replace. */
  static rebuild(host: ModdleElement, owner: ModdleElement | undefined, type: string): string {
    const address = ZeebeFixHint.addressOf(host, owner);
    if (!address) {
      return 'Fix it in the XML.';
    }
    return `See it with \`bpmn ext list <file> ${address.id} --json\`, then rebuild it: \`bpmn ext add <file> ${address.id} ${sh(`${address.prefix}${type}`)} --replace --xml '<${type} ...>...</${type}>'\`.`;
  }

  private static hasChildren(zeebeElement: ModdleElement): boolean {
    return Object.entries(zeebeElement).some(
      ([key, value]) =>
        !key.startsWith('$') &&
        value !== null &&
        typeof value === 'object' &&
        (!Array.isArray(value) || value.length > 0),
    );
  }
}
