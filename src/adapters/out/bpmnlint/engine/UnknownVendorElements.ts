import type { Doc } from '../../../../domain/document/Doc.js';
import type { ProfileFinding } from '../../../../domain/document/Finding.js';


import type { El } from '../../../../domain/document/utils/moddle.js';
import type { CamundaElementType } from '../../../../domain/document/vendor/CamundaDescriptor.js';

import type { ZeebeElementType } from '../../../../domain/document/vendor/ZeebeDescriptor.js';

const ENGINE_NAME = { c7: 'the engines', c8: 'Camunda 8' };
import type { DocumentNamespaces } from '../../../../domain/document/vendor/DocumentNamespaces.js';
import type { EngineKit } from '../engine-kit.js';

/**
 * Extension elements of the engine's own namespace that its descriptor does not know. bpmnlint
 * parses with the engine's moddle extension, which drops them (an import warning without the
 * element), so no bpmnlint rule sees them; bpmn-cli's model keeps them as generic elements.
 * Like the engines, only executable processes count.
 */
export class UnknownVendorElements {
  private readonly code: string;
  private readonly prefix: string;

  constructor(
    private readonly kit: EngineKit,
    private readonly doc: Doc,
    private readonly platform: 'c7' | 'c8',
    private readonly ns: DocumentNamespaces,
  ) {
    this.code = platform === 'c8' ? 'W_C8_UNKNOWN_ELEMENT' : 'W_C7_UNKNOWN_ELEMENT';
    this.prefix = platform === 'c8' ? (this.ns.prefixOf(this.kit.ZEEBE.uri) ?? 'zeebe') : (this.ns.prefixOf(this.kit.CAMUNDA.uri) ?? 'camunda');
  }

  findings(): ProfileFinding[] {
    const out: ProfileFinding[] = [];
    for (const proc of this.doc.processes().filter((candidate) => this.kit.peek<boolean>(candidate, 'isExecutable') === true)) {
      for (const el of this.kit.walk(proc, { bpmnOnly: true })) this.checkHost(el, out);
    }
    return out;
  }

  private checkHost(host: El, out: ProfileFinding[]): void {
    const values = this.kit.list(this.kit.peek<El>(host, 'extensionElements'), 'values');
    values.forEach((value, index) => {
      if (!this.isOwnGeneric(value)) return;
      const local = this.localName(value.$type);
      const known = this.typeOf(local);
      if (known) {
        const misplaced = this.platform === 'c8' ? this.misplaced(host, local, index) : this.looseParameter(host, value, local, index);
        if (misplaced) out.push(misplaced);
        else this.checkChildren(host, value, known, `${this.prefix}:${local}`, out);
        return;
      }
      const guess = this.closest(local, this.typeNames());
      out.push(this.finding(host, `ext:${local}`, `${this.where(host)} has the unknown extension element ${this.prefix}:${local}${guess ? ` (did you mean ${this.prefix}:${guess}?)` : ''}; ${ENGINE_NAME[this.platform]} ignores it`, this.removeHint(host, index, guess)));
    });
  }

  /**
   * A known zeebe element the typed parse drops, so no rule sees where it sits: one that belongs
   * inside a container (a loose zeebe:input), or zeebe:publishMessage where Camunda 8 does not read
   * it (on an end event instead of its message event definition).
   */
  private misplaced(host: El, local: string, index: number): ProfileFinding | undefined {
    const id = this.kit.peek<string>(host, 'id');
    const remove = id ? `\`bpmn ext remove <file> ${id} ${index}\`` : 'remove it from the XML';
    const name = `${this.prefix}:${local}`;
    if (this.kit.ZEEBE.nestedOnly(local)) {
      const container = this.kit.ZEEBE.containersOf(local)[0]!;
      const add = id ? `: \`bpmn ext add <file> ${id} ${name} ...\`` : '';
      return this.misplacedFinding(host, local, `${name} sits directly in the extension elements of ${this.describe(host)}, but belongs inside ${this.prefix}:${this.localName(container)}; Camunda 8 ignores it`, `Remove it (${remove}) and add it again, \`bpmn ext add\` files it into its container${add}.`);
    }
    if (this.typedParseKnows(local) || this.kit.ZEEBE.allowedOn(local, host) !== false) return undefined;
    const hosts = (this.kit.ZEEBE.type(local)?.allowedIn ?? []).filter((allowed) => allowed.startsWith('bpmn:')).map((allowed) => `${allowed.charAt(5).toLowerCase()}${allowed.slice(6)}`);
    return this.misplacedFinding(host, local, `${name} on ${this.describe(host)} has no effect: Camunda 8 reads it on ${hosts.length > 5 ? `${hosts.slice(0, 5).join(', ')}, ...` : hosts.join(', ')} only`, `Remove it: ${remove}.`);
  }

  /** A camunda:inputParameter or outputParameter outside camunda:inputOutput, which the typed parse drops. */
  private looseParameter(host: El, parameter: El, local: string, index: number): ProfileFinding | undefined {
    if (local !== 'inputParameter' && local !== 'outputParameter') return undefined;
    const { id, slot } = this.address(host);
    const name = this.kit.peek<string>(parameter, 'name') ?? (parameter.$attrs as Record<string, string> | undefined)?.['name'];
    const body = this.kit.peek<string>(parameter, '$body');
    const add = id ? `: \`bpmn ext add <file> ${id} ${slot}camunda:${local}${name ? ` name=${name}` : ''}${body ? ` --body ${body}` : ''}\`` : '';
    const remove = id ? `\`bpmn ext remove <file> ${id} ${slot}${index}\`` : 'remove it from the XML';
    return this.kit.makeFinding('runtime', 'W_C7_MISPLACED_EXTENSION', `${this.prefix}:${local} sits directly in the extension elements of ${this.where(host)}, but belongs inside ${this.prefix}:inputOutput; the engines ignore it`, id, { hint: `Remove it (${remove}) and add it again, \`bpmn ext add\` files it into its container${add}.`, subject: `ext:${local}` });
  }

  /**
   * How `bpmn` addresses the extension elements of `host`: an event definition or a loop through
   * its flow node and slot (`W definition.`, `SP loop.`), any other element by its id.
   */
  private address(host: El): { id: string | undefined; slot: string } {
    const owner = host.$parent as El | undefined;
    const ownerId = owner ? this.kit.peek<string>(owner, 'id') : undefined;
    if (ownerId && this.kit.is(host, 'bpmn:EventDefinition')) {
      const definitions = this.kit.list(owner, 'eventDefinitions');
      return { id: ownerId, slot: definitions.length > 1 ? `definition[${definitions.indexOf(host)}].` : 'definition.' };
    }
    if (ownerId && this.kit.is(host, 'bpmn:LoopCharacteristics')) return { id: ownerId, slot: 'loop.' };
    return { id: this.kit.peek<string>(host, 'id'), slot: '' };
  }

  /** `timerEventDefinition Def_T`, or `the timerEventDefinition of intermediateCatchEvent:timer W` */
  private where(host: El): string {
    const owner = host.$parent as El | undefined;
    if (this.kit.peek<string>(host, 'id') || !owner || !(this.kit.is(host, 'bpmn:EventDefinition') || this.kit.is(host, 'bpmn:LoopCharacteristics'))) return this.describe(host);
    const local = this.localName(host.$type);
    return `the ${local.charAt(0).toLowerCase()}${local.slice(1)} of ${this.describe(owner)}`;
  }

  /** The rules see a placement of a type the engine's moddle extension knows; zeebe:publishMessage is bpmn-cli's own. */
  private typedParseKnows(local: string): boolean {
    return (this.kit.ZEEBE_DESCRIPTOR.types as Array<{ name?: string }>).some((type) => type.name?.toLowerCase() === local.toLowerCase());
  }

  private misplacedFinding(host: El, local: string, message: string, hint: string): ProfileFinding {
    return this.kit.makeFinding('runtime', 'W_C8_MISPLACED_EXTENSION', message, this.kit.peek<string>(host, 'id'), { hint, subject: `ext:${local}` });
  }

  private checkChildren(host: El, parent: El, parentType: ZeebeElementType | CamundaElementType, path: string, out: ProfileFinding[]): void {
    for (const child of this.kit.list(parent, '$children')) {
      if (!this.isOwnGeneric(child)) continue;
      const local = this.localName(child.$type);
      if (this.isTextChild(parentType, local)) continue;
      const known = this.typeOf(local);
      if (known) {
        this.checkChildren(host, child, known, `${path} > ${this.prefix}:${local}`, out);
        continue;
      }
      out.push(this.finding(host, `ext:${path}/${local}`, `${this.where(host)} contains the unknown element ${this.prefix}:${local}${path ? ` (in ${path})` : ''}; ${ENGINE_NAME[this.platform]} ignores it`, this.rebuildHint(host, path.split(' > ')[0]!)));
    }
  }

  private isOwnGeneric(el: El): boolean {
    const generic = (el?.$descriptor as { isGeneric?: boolean } | undefined)?.isGeneric;
    const descriptor = this.platform === 'c8' ? this.kit.ZEEBE : this.kit.CAMUNDA;
    return !!generic && descriptor.reads(this.ns.uriOfElement(el));
  }

  private typeOf(local: string): ZeebeElementType | CamundaElementType | undefined {
    return this.platform === 'c8' ? this.kit.ZEEBE.type(local) : this.kit.CAMUNDA.type(local);
  }

  private typeNames(): string[] {
    return (this.platform === 'c8' ? this.kit.ZEEBE.typeNames() : this.kit.CAMUNDA.typeNames()).map((name) => this.localName(name));
  }

  /** Children a camunda type takes as plain text (connectorId, expression, string). */
  private isTextChild(parentType: ZeebeElementType | CamundaElementType, local: string): boolean {
    return this.platform === 'c7' && (parentType as CamundaElementType).properties.some((property) => property.name === local && !property.isAttr && !property.isBody && !property.type.includes(':'));
  }

  private removeHint(host: El, index: number, guess: string | undefined): string {
    const { id, slot } = this.address(host);
    if (!id) return 'Fix it in the XML.';
    return `Remove it (\`bpmn ext remove <file> ${id} ${slot}${index}\`)${guess ? ` and add the right one: \`bpmn ext add <file> ${id} ${slot}${this.prefix}:${guess} ...\`` : ''}.`;
  }

  private rebuildHint(host: El, type: string): string {
    const { id, slot } = this.address(host);
    if (!id) return 'Fix it in the XML.';
    return `See it with \`bpmn ext list <file> ${id} --json\`, then rebuild it: \`bpmn ext add <file> ${id} ${slot}${type} --replace --xml '<${type} ...>...</${type}>'\`.`;
  }

  /** The closest name within a small edit distance. */
  private closest(name: string, candidates: string[]): string | undefined {
    const limit = Math.max(1, Math.floor(name.length / 4));
    let best: { candidate: string; distance: number } | undefined;
    for (const candidate of candidates) {
      const distance = this.kit.editDistance(name.toLowerCase(), candidate.toLowerCase());
      if (distance <= limit && (!best || distance < best.distance)) best = { candidate, distance };
    }
    return best?.candidate;
  }

  private describe(el: El): string {
    const id = this.kit.peek<string>(el, 'id');
    if (!id) return el.$type;
    const kind = this.kit.isBpmnElement(el) ? this.kit.kindLabel(el).replace(/^bpmn:/, '') : this.localName(el.$type);
    return `${kind.charAt(0).toLowerCase()}${kind.slice(1)} ${id}`;
  }

  private finding(host: El, subject: string, message: string, hint: string): ProfileFinding {
    let reported: El | undefined = this.address(host).id === this.kit.peek<string>(host, 'id') ? host : (host.$parent as El | undefined);
    while (reported && !this.kit.peek<string>(reported, 'id')) reported = reported.$parent as El | undefined;
    return this.kit.makeFinding('runtime', this.code, message, reported ? this.kit.peek<string>(reported, 'id') : undefined, { hint, subject });
  }

  private localName(type: string): string {
    return type.slice(type.indexOf(':') + 1);
  }
}
