import type { Doc } from '../../document/Doc.js';
import type { DocumentNamespaces } from '../../document/vendor/DocumentNamespaces.js';
import type { El } from '../../document/utils/moddle.js';
import type { ProfileFinding, Severity } from '../../document/utils/finding.js';
import type { RuleKit } from './rule-kit.js';
import type { RuleRun } from './RuleRun.js';
import { idOf, isGeneric, list, localName, peek } from '../utils/element.js';

export interface ExtValue {
  el: El;
  uri: string | undefined;
  local: string;
  index: number;
}

export interface Address {
  id: string;
  prefix: string;
}

/**
 * The attributes without namespace prefix of one element, with the element that reports them
 * and the `set` address that removes them.
 */
export interface UnprefixedAttributes {
  el: El;
  owner: El | undefined;
  id: string | undefined;
  /** on a diagram element: no `set` address */
  di: boolean;
  addr: Address | undefined;
  keys: string[];
}

/** Base of the rule classes of an engine profile: the run they check and how they report. */
export abstract class EngineRules {
  protected readonly kit: RuleKit;
  protected readonly doc: Doc;
  protected readonly ns: DocumentNamespaces;
  protected readonly outgoing: Map<El, El[]>;
  protected readonly incoming: Map<El, El[]>;
  private readonly out: ProfileFinding[];

  /** `prefix`: the prefix of the engine's namespace in this file, for messages and hints */
  constructor(
    run: RuleRun,
    protected readonly prefix: string,
  ) {
    this.kit = run.kit;
    this.doc = run.doc;
    this.ns = run.ns;
    this.outgoing = run.outgoing;
    this.incoming = run.incoming;
    this.out = run.out;
  }

  /** Reports a finding; a nested element (event definition, loop, condition) is reported on its flow node / flow. */
  protected push(severity: Severity, code: string, element: El | undefined, owner: El | undefined, subject: string, message: string, hint: string, related: string[] = []): void {
    const addr = element ? this.addressOf(element, owner) : undefined;
    const target = addr?.prefix ? addr.id : (idOf(element) ?? idOf(owner));
    this.out.push(this.kit.makeFinding(severity, code, message, target, { hint, related, subject }));
  }

  /**
   * The `set` / `ext` address of `el` through `owner` (`definition.`, `loop.`, `condition.`).
   * One of several event definitions is `definition[n].`, as `definition.` would be ambiguous (E_AMBIGUOUS_NESTED).
   */
  protected addressOf(el: El, owner: El | undefined): Address | undefined {
    const id = idOf(el);
    const own = id ? { id, prefix: '' } : undefined;
    const oid = idOf(owner);
    if (!owner || el === owner || !oid) return own;
    const defs = list(owner, 'eventDefinitions');
    if (defs.includes(el)) return { id: oid, prefix: defs.length > 1 ? `definition[${defs.indexOf(el)}].` : 'definition.' };
    if (peek<El>(owner, 'loopCharacteristics') === el) return { id: oid, prefix: 'loop.' };
    if (peek<El>(owner, 'conditionExpression') === el) return { id: oid, prefix: 'condition.' };
    return own;
  }

  /** The generic extension elements of a BPMN element, with their namespace. */
  protected extensionValues(el: El | undefined): ExtValue[] {
    const ext = peek<El>(el, 'extensionElements');
    return list(ext, 'values').map((extension, index) => ({ el: extension, uri: isGeneric(extension) ? this.ns.uriOfElement(extension) : undefined, local: localName(extension.$type), index }));
  }

  /**
   * The attributes without namespace prefix of every BPMN element (refused by the schema).
   * A nested element is reported on and addressed through its flow node / flow; outside the
   * diagram the hint `bpmn set <id> <key>=` removes it, through a nested key if needed.
   */
  protected unprefixedAttributes(): UnprefixedAttributes[] {
    const found: UnprefixedAttributes[] = [];
    for (const el of this.kit.walk(this.doc.definitions, { bpmnOnly: true })) {
      const keys = Object.keys(el.$attrs ?? {}).filter((key) => !key.includes(':') && key !== 'xmlns');
      if (!keys.length) continue;
      const parent = el.$parent as El | undefined;
      const nested = parent && idOf(parent) && this.addressOf(el, parent)?.prefix ? parent : undefined;
      let owner: El | undefined = nested ?? el;
      while (owner && !idOf(owner)) owner = owner.$parent as El | undefined;
      const id = idOf(owner);
      const di = this.kit.isDiElement(el) || (!!owner && this.kit.isDiElement(owner));
      const addr = di ? undefined : el === owner ? (id ? { id, prefix: '' } : undefined) : owner ? this.addressOf(el, owner) : undefined;
      found.push({ el, owner, id, di, addr, keys });
    }
    return found;
  }
}
