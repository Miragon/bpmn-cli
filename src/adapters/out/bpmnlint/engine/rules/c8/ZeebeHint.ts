import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { DiagramNamespaces, ZEEBE_URI } from '../DiagramNamespaces.js';
import { ElementKinds } from '../ElementKinds.js';
import { SetCommand } from '../SetCommand.js';
import { Shell } from '../Shell.js';

/**
 * The `bpmn` commands a Camunda 8 hint gives for one BPMN element: addressed by its id, or by the
 * id of its flow node or flow and a slot (`definition.`, `loop.`) for a nested one, with zeebe
 * elements spelled with the prefix the file declares.
 */
export class ZeebeHint extends SetCommand {
  private constructor(address: SetCommand, private readonly prefix: string) {
    super(address.id, address.slot);
  }

  /** The hint commands for `el`; undefined when `bpmn` cannot address it (no id, not nested). */
  static of(el: ModdleElement): ZeebeHint | undefined {
    const address = SetCommand.at(el);
    return address && new ZeebeHint(address, ZeebeHint.prefixOf(el));
  }

  /** `zeebe:taskDefinition` for `taskDefinition`, in the file's spelling. */
  name(local: string): string {
    return `${this.prefix}:${local}`;
  }

  /** The element name of a typed zeebe element, `zeebe:taskDefinition` for `zeebe:TaskDefinition`, in the file's spelling. */
  nameOf(element: ModdleElement): string {
    return ZeebeHint.typeName(element).replace(/^[^:]*:/, `${this.prefix}:`);
  }

  /** `bpmn ext add --replace` that writes the zeebe element anew with `fix` laid over its attributes, those the descriptor knows and the unknown ones; the rebuild hint when it has child elements. */
  replace(element: ModdleElement, fix: Record<string, string>): string {
    const properties: Array<{ name: string; isAttr?: boolean }> = element.$descriptor?.properties ?? [];
    if (properties.some(({ name, isAttr }) => !isAttr && (Array.isArray(element[name]) ? element[name].length > 0 : element[name] !== undefined && typeof element[name] === 'object'))) return this.rebuild(this.nameOf(element));
    const attributes: Record<string, string> = {};
    for (const { name, isAttr } of properties) if (isAttr && Object.hasOwn(element, name) && element[name] !== undefined && element[name] !== null && typeof element[name] !== 'object') attributes[name] = String(element[name]);
    for (const [key, value] of Object.entries(element.$attrs ?? {})) if (!key.startsWith('xmlns') && value !== undefined && value !== null) attributes[key] = String(value);
    return this.replaceWith(this.nameOf(element), attributes, fix);
  }

  /** `replace` for the attributes as the typed element holds them, the element named by its type; without an address, the XML. */
  static fix(host: ModdleElement, element: ModdleElement, fix: Record<string, string>): string {
    const hint = ZeebeHint.of(host);
    const written = Object.entries(element).filter(([key]) => !key.startsWith('$'));
    if (written.some(([, value]) => value !== null && typeof value === 'object' && (!Array.isArray(value) || value.length > 0))) return hint ? hint.rebuild(ZeebeHint.typeName(element)) : 'Fix it in the XML.';
    const attributes = Object.fromEntries(written.filter(([, value]) => value !== undefined && value !== null && typeof value !== 'object').map(([key, value]) => [key, String(value)]));
    return hint ? hint.replaceWith(ZeebeHint.typeName(element), attributes, fix) : 'edit the XML.';
  }

  /** `zeebe:TaskDefinition` -> `zeebe:taskDefinition`, the element name a message shows. */
  static typeName(element: ModdleElement): string {
    return ElementKinds.xmlName(String(element.$type));
  }

  /** The prefix the diagram of `el` declares for the zeebe namespace, `zeebe` when it declares none. */
  static prefixOf(el: ModdleElement): string {
    return DiagramNamespaces.forElement(el).prefixOf(ZEEBE_URI) ?? 'zeebe';
  }

  private replaceWith(name: string, attributes: Record<string, string>, fix: Record<string, string>): string {
    const args = Object.entries({ ...attributes, ...fix }).map(([key, value]) => Shell.quote(`${key}=${value}`));
    return `${this.extAdd([name, ...args, '--replace'].join(' '))}.`;
  }
}
