import type { El } from '../../../document/utils/moddle.js';
import { EngineRules } from '../EngineRules.js';
import { FeelExpression } from '../FeelExpression.js';
import { idOf, isGeneric, list, localName, peek } from '../../utils/element.js';
import { lowerFirst, sh, slotted } from '../../utils/hint.js';
import { isFeel } from '../../utils/c8-value.js';

/** Base of the Camunda 8 rule classes: how Zeebe reads zeebe content, and how hints rebuild it. */
export abstract class C8Rules extends EngineRules {
  /** `userTask Activity_X`, `the multiInstanceLoopCharacteristics of userTask Activity_X` */
  protected describe(el: El, owner?: El): string {
    const id = idOf(el);
    const kind = this.kit.isBpmnElement(el) ? lowerFirst(this.kit.kindLabel(el).replace(/^bpmn:/, '')) : el.$type;
    if (id) return `${kind} ${id}`;
    return owner ? `the ${lowerFirst(localName(el.$type))} of ${this.describe(owner)}` : kind;
  }

  /** Top-level zeebe extension elements of type `local`. */
  protected zeebe(el: El | undefined, local: string): El[] {
    return this.extensionValues(el)
      .filter((extValue) => extValue.uri === this.kit.zeebe.uri && extValue.local === local)
      .map((extValue) => extValue.el);
  }

  /** Zeebe children of a generic element (all, or of type `local`). */
  protected kids(el: El, local?: string): El[] {
    const raw = peek<unknown[]>(el, '$children');
    if (!Array.isArray(raw)) return [];
    return (raw as El[]).filter((child) => child && typeof child.$type === 'string' && isGeneric(child) && this.ns.uriOfElement(child) === this.kit.zeebe.uri && (local === undefined || localName(child.$type) === local));
  }

  /** `<prefix>:taskDefinition` in the file's spelling. */
  protected zeebeName(local: string): string {
    return `${this.prefix}:${local}`;
  }

  protected messageOf(el: El): El | undefined {
    if (this.kit.is(el, 'bpmn:ReceiveTask') || this.kit.is(el, 'bpmn:SendTask')) return peek<El>(el, 'messageRef');
    const def = list(el, 'eventDefinitions').find((definition) => this.kit.is(definition, 'bpmn:MessageEventDefinition'));
    return peek<El>(def, 'messageRef');
  }

  /** `bpmn ext add <file> <id> <args>` for an element (with its slot prefix for a nested one). */
  protected extAdd(el: El, owner: El | undefined, args: string): string {
    const addr = this.addressOf(el, owner);
    if (!addr) return 'edit the XML';
    return `\`bpmn ext add <file> ${addr.id} ${slotted(addr.prefix, args)}\``;
  }

  /**
   * `bpmn ext add` that rebuilds the flat zeebe element `v` with `fix` laid over its attributes
   * (`--replace` replaces it as a whole, so it carries every attribute); undefined with children.
   */
  private replaceCommand(host: El, owner: El | undefined, zeebeElement: El, fix: Record<string, string>): string | undefined {
    if (this.kids(zeebeElement).length) return undefined;
    const attrs: Record<string, string> = {};
    for (const [key, val] of Object.entries(zeebeElement as unknown as Record<string, unknown>)) {
      if (key.startsWith('$') || key.startsWith('xmlns') || val === undefined || val === null || typeof val === 'object') continue;
      attrs[key] = String(val);
    }
    Object.assign(attrs, fix);
    const args = Object.entries(attrs).map(([key, val]) => sh(`${key}=${val}`));
    return this.extAdd(host, owner, [zeebeElement.$type, ...args, '--replace'].join(' '));
  }

  /** The replace command for `v`, or the list-and-rebuild hint when it has children. */
  protected fixHint(host: El, owner: El | undefined, zeebeElement: El, fix: Record<string, string>): string {
    const cmd = this.replaceCommand(host, owner, zeebeElement, fix);
    return cmd ? `${cmd}.` : this.rebuildHint(host, owner, zeebeElement.$type);
  }

  /** How to rebuild a zeebe element with its content: list it, then add it again with --replace. */
  protected rebuildHint(host: El, owner: El | undefined, type: string): string {
    const addr = this.addressOf(host, owner);
    if (!addr) return 'Fix it in the XML.';
    return `See it with \`bpmn ext list <file> ${addr.id} --json\`, then rebuild it: \`bpmn ext add <file> ${addr.id} ${sh(`${addr.prefix}${type}`)} --replace --xml '<${type} ...>...</${type}>'\`.`;
  }

  /** Reports a FEEL value (=...) with a slip FeelExpression finds; true when it reported one. */
  protected checkFeel(el: El, owner: El | undefined, subject: string, what: string, value: string | undefined, fix: string): boolean {
    if (!isFeel(value)) return false;
    const problem = new FeelExpression(value!.trim().slice(1)).problem();
    if (!problem) return false;
    this.push('deploy', 'W_C8_DEPLOY_EXPRESSION', el, owner, `feel:${subject}`, `${what} "${value!.trim()}" is no valid FEEL: ${problem}; Camunda 8 parses it at deploy and refuses the file`, fix);
    return true;
  }
}
