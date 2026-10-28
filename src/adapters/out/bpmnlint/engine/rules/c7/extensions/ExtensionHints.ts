import type { C7Host, HostAddress, HostExtension } from './C7Host.js';
import { attributeValue } from './utils/attributeValue.js';
import { extAddArguments } from './utils/extAddArguments.js';
import { sh, slotted } from '../../shell.js';
import { C7Diagram } from '../C7Diagram.js';

/** The camunda types the engines read as one element, which `bpmn ext add --replace` rebuilds as a whole. */
const SINGLE_TYPES = ['inputOutput', 'formData', 'connector', 'failedJobRetryTimeCycle', 'properties'];

/** Attributes that pick one item of a repeatable type, in the order a selector prefers them. */
const SELECTOR_KEYS = ['id', 'name', 'event', 'target', 'source', 'errorRef'];

/**
 * The `bpmn` commands of the hints on a host's camunda content: how to rebuild, remove or merge
 * its extension elements and unset its attributes, through the flow node's slot for an event
 * definition or loop, with the camunda prefix the file declares.
 */
export class ExtensionHints {
  readonly prefix: string;
  readonly address: HostAddress | undefined;

  constructor(private readonly host: C7Host) {
    this.prefix = C7Diagram.of(host.node).prefix;
    this.address = host.address();
  }

  /** `camunda:inputOutput`, with the file's prefix. */
  typeName(local: string): string {
    return `${this.prefix}:${local}`;
  }

  /** `` `bpmn set <file> X camunda:asignee=` `` for the attribute `key` as the file spells it; undefined without an address. */
  unset(key: string): string | undefined {
    const address = this.address;
    return address ? `\`bpmn set <file> ${address.id} ${sh(`${address.slot}${key}=`)}\`` : undefined;
  }

  /**
   * How to rebuild one top-level extension element. A single-instance type is replaced as a whole
   * (`--replace`); a repeatable one is removed by its own selector and added again, as `--replace`
   * would remove its siblings. `fix` puts placeholders in for attributes.
   */
  rebuild(extension: HostExtension, fix: Record<string, string> = {}): string {
    const address = this.address;
    if (!address) {
      return 'Fix it in the XML.';
    }
    const { id, slot } = address;
    const type = this.typeName(extension.local);
    if (SINGLE_TYPES.includes(extension.local)) {
      return `See it with \`bpmn ext list <file> ${id} --json\`, then rebuild it: \`bpmn ext add <file> ${id} ${slotted(slot, type)} --replace --xml '<${type}>...</${type}>'\`.`;
    }
    const flat = extAddArguments(extension.value, type, fix);
    const again = flat
      ? `\`bpmn ext add <file> ${id} ${slotted(slot, flat)}\``
      : `\`bpmn ext add <file> ${id} ${slotted(slot, type)} --xml '<${type} ...>...</${type}>'\` (\`bpmn ext list <file> ${id} --json\` shows it)`;
    return `Replace just this one (--replace would remove every ${type}): \`bpmn ext remove <file> ${id} ${sh(`${slot}${this.selector(extension)}`)}\`, then ${again}.`;
  }

  /** `Merge them into one: ...` for duplicates of a single-instance type. */
  merge(local: string): string {
    const address = this.address;
    if (!address) {
      return 'Merge them in the XML.';
    }
    const type = this.typeName(local);
    return `Merge them into one: \`bpmn ext list <file> ${address.id} --json\`, then \`bpmn ext add <file> ${address.id} ${slotted(address.slot, type)} --replace --xml '<${type}>...</${type}>'\`.`;
  }

  /** `bpmn ext remove` of an extension element by its position. */
  removeAt(extension: HostExtension): string | undefined {
    const address = this.address;
    return address
      ? `\`bpmn ext remove <file> ${address.id} ${slotted(address.slot, String(extension.index))}\``
      : undefined;
  }

  /** `bpmn ext remove` of an extension element by its selector (`camunda:field[name=a]`). */
  removeBySelector(extension: HostExtension): string | undefined {
    const address = this.address;
    return address
      ? `\`bpmn ext remove <file> ${address.id} ${sh(`${address.slot}${this.selector(extension)}`)}\``
      : undefined;
  }

  /** `ext remove` selector of a top-level extension element: a unique attribute, else its index among its type. */
  selector(extension: HostExtension): string {
    const type = this.typeName(extension.local);
    const siblings = this.host
      .extensions()
      .filter((sibling) => sibling.value.$type === extension.value.$type)
      .map((sibling) => sibling.value);
    for (const key of SELECTOR_KEYS) {
      const value = attributeValue(extension.value, key);
      const unique =
        value !== undefined &&
        value !== '' &&
        siblings.filter((sibling) => attributeValue(sibling, key) === value).length === 1;
      if (unique) {
        return `${type}[${key}=${/^[\w.:-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`}]`;
      }
    }
    return `${type}[${Math.max(0, siblings.indexOf(extension.value))}]`;
  }
}
