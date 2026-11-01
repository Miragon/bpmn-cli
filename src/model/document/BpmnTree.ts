import { BpmnError } from '../errors/BpmnError.js';
import { IdSuggestions, type BatchContext } from '../ids/IdSuggestions.js';
import type { IdRegistry } from '../ids/IdRegistry.js';
import { Kinds } from '../kinds/Kinds.js';
import type { BpmnModdle } from '../xml/ModdleParser.js';
import { BpmnElement } from './BpmnElement.js';
import { ElementWalk, type WalkOptions } from './ElementWalk.js';

export class BpmnTree {
  private index: Map<string, BpmnElement> | null = null;

  constructor(
    readonly moddle: BpmnModdle,
    readonly definitions: BpmnElement,
    private readonly registry: IdRegistry,
  ) {}

  private static isInsideExtension(element: BpmnElement): boolean {
    for (let ancestor = element.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.is('bpmn:ExtensionElements')) {
        return true;
      }
    }
    return false;
  }

  private static ownerOf(element: BpmnElement): BpmnElement | undefined {
    let owner = element.parent;
    while (owner && (!owner.isBpmn || owner.is('bpmn:ExtensionElements') || !owner.get<string | undefined>('id'))) {
      owner = owner.parent;
    }
    return owner;
  }

  walk(root: BpmnElement = this.definitions, options: WalkOptions = {}): Generator<BpmnElement> {
    return new ElementWalk(root).depthFirst(options);
  }

  all(): Map<string, BpmnElement> {
    if (!this.index) {
      this.index = new Map();
      for (const element of this.walk(this.definitions, { bpmnOnly: true })) {
        const id = element.isDi ? undefined : element.get<string | undefined>('id');
        if (id) {
          this.index.set(id, element);
        }
      }
    }
    return this.index;
  }

  byId(id: string): BpmnElement | undefined {
    return this.all().get(id);
  }

  has(id: string): boolean {
    return this.all().has(id);
  }

  require(id: string, expect?: string | string[], what = 'element', batch?: BatchContext): BpmnElement {
    const element = this.byId(id);
    if (!element) {
      throw this.notFound(id, what, batch);
    }
    const types = expect === undefined ? [] : [expect].flat();
    if (types.length && !types.some((type) => element.is(type))) {
      throw BpmnError.model('E_WRONG_KIND', `"${id}" is a ${Kinds.label(element)}, expected ${types.map((type) => type.replace('bpmn:', '')).join(' or ')}`, { element: id });
    }
    return element;
  }

  processes(): BpmnElement[] {
    return this.rootElementsOfType('bpmn:Process');
  }

  collaboration(): BpmnElement | undefined {
    return this.rootElementsOfType('bpmn:Collaboration')[0];
  }

  rootElementsOfType(type: string): BpmnElement[] {
    return this.definitions.list('rootElements').filter((element) => element.is(type));
  }

  create(type: string, attrs: Record<string, unknown> = {}): BpmnElement {
    const element = this.build(type, attrs);
    const id = attrs['id'];
    if (typeof id === 'string') {
      this.registry.claim(id);
    }
    this.invalidate();
    return element;
  }

  build(type: string, attrs: Record<string, unknown> = {}): BpmnElement {
    const element = BpmnElement.of(this.moddle.create(type));
    for (const [property, value] of Object.entries(attrs)) {
      element.set(property, value);
    }
    return element;
  }

  buildAny(name: string, uri: string, properties: Record<string, unknown> = {}): BpmnElement {
    const element = BpmnElement.of(this.moddle.createAny(name, uri, {}));
    for (const [property, value] of Object.entries(properties)) {
      element.set(property, value);
    }
    return element;
  }

  invalidate(): void {
    this.index = null;
  }

  private notFound(id: string, what: string, batch: BatchContext | undefined): BpmnError {
    const vendor = this.vendorUses(id);
    if (vendor.length) {
      const owners = [...new Set(vendor.map(({ owner }) => owner))];
      return BpmnError.model('E_NOT_FOUND', `"${id}" is not a BPMN element: it is the id of ${[...new Set(vendor.map(({ type }) => type))].join(', ')} vendor extension data inside ${owners.join(', ')}`, {
        element: id,
        candidates: owners,
        hint: `Vendor extension elements are edited through their BPMN element: \`bpmn show <file> ${owners[0]}\`, then \`bpmn ext add|remove <file> ${owners[0]} ...\`.`,
      });
    }
    const candidates = new IdSuggestions(this.all(), batch).for(id, 5);
    return BpmnError.model('E_NOT_FOUND', `No ${what} with id "${id}"${this.whyNotFound(id, candidates, batch)}`, { element: id, candidates, hint: this.notFoundHint(id, batch) });
  }

  private whyNotFound(id: string, candidates: string[], batch: BatchContext | undefined): string {
    const renamed = batch?.renamed.get(id);
    if (renamed) {
      const because = batch?.retyped?.has(id) ? 'a retype or a trigger change gave it the prefix of its new kind' : 'its id named its old ends';
      return `: an op before this one renamed it to ${renamed} (${because})`;
    }
    return candidates.length ? ` (did you mean: ${candidates.join(', ')}?)` : '';
  }

  private notFoundHint(id: string, batch: BatchContext | undefined): string {
    const alias = batch && Object.keys(batch.aliases()).find((aliasKey) => aliasKey.slice(1).toLowerCase() === id.toLowerCase());
    const recent = (batch?.created ?? []).filter((createdId) => this.has(createdId));
    const more = recent.length > 8 ? ` (and ${recent.length - 8} more)` : '';
    return [
      alias ? `In this batch ${alias} is an alias: write "${alias}".` : '',
      recent.length ? `Created earlier in this batch: ${recent.slice(-8).join(', ')}${more}; name them with "as": "$name" to refer to them.` : '',
      'Run `bpmn show <file>` or `bpmn find <file> <text>` to list ids.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  private vendorUses(id: string): Array<{ type: string; owner: string }> {
    const uses: Array<{ type: string; owner: string }> = [];
    for (const element of this.walk()) {
      if (element.peek('id') === id && (!element.isBpmn || BpmnTree.isInsideExtension(element))) {
        uses.push({ type: element.type, owner: BpmnTree.ownerOf(element)?.get<string>('id') ?? '?' });
      }
    }
    return uses;
  }
}
