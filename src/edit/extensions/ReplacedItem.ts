import type { BpmnDocument, BpmnElement, Finding } from '../../model/index.js';
import type { ExtensionLevel } from './ExtensionLevel.js';
import { ExtensionStructure } from './ExtensionStructure.js';
import { NestedHosts } from './NestedHosts.js';
import type { VendorElements } from './VendorElements.js';

export class ReplacedItem {
  private static readonly SNIPPET_MAX = 800;

  private readonly structure = ExtensionStructure.INSTANCE;
  private readonly hosts = NestedHosts.INSTANCE;

  constructor(
    private readonly document: BpmnDocument,
    private readonly names: VendorElements,
  ) {}

  droppedContent(level: ExtensionLevel, match: BpmnElement[], value: BpmnElement): Finding | undefined {
    const old = match[0]!;
    const extra = match.length - 1;
    const lost = this.lostContent(old, value, extra);
    if (!lost.length) {
      return undefined;
    }
    const label = `${this.names.itemLabel(value)}${level.where}`;
    const id = this.hosts.idOf(level.host);
    const snippet = extra ? undefined : this.snippetOf(this.mergedCopy(old, value));
    const type = `${this.hosts.slotPrefix(level.host)}${this.addTypeFor(level, value)}`;
    const quotedType = /^[\w.:-]+$/.test(type) ? type : `'${type}'`;
    return {
      code: 'W_PROPERTY_DROPPED',
      message: `${lost.join(', ')} of the replaced ${label} of ${this.hosts.labelOf(level.host)} ${lost.length > 1 ? 'were' : 'was'} dropped: ext add replaces an item with the same ${this.names.keyOf(value)?.attr ?? 'key'} as a whole`,
      element: id,
      hint:
        snippet && snippet.length <= ReplacedItem.SNIPPET_MAX
          ? `To keep ${lost.length > 1 ? 'them' : 'it'}, add the item again with everything it should hold: \`bpmn ext add <file> ${id} ${quotedType} --xml '${snippet.replace(/'/g, "'\\''")}'\`.`
          : `To keep ${lost.length > 1 ? 'them' : 'it'}, add the item again with everything it should hold: \`bpmn ext add <file> ${id} ${quotedType} --xml '<${value.type} ...>...</${value.type}>'\`.`,
    };
  }

  private lostContent(old: BpmnElement, value: BpmnElement, extra: number): string[] {
    const lost: string[] = [];
    const now = this.names.attrsOf(value);
    for (const [attrName, attrValue] of Object.entries(this.names.attrsOf(old))) {
      if (now[attrName] === undefined) {
        lost.push(`${attrName}="${attrValue}"`);
      }
    }
    const oldBody = this.names.bodyOf(old);
    if (oldBody !== undefined && this.names.bodyOf(value) === undefined) {
      lost.push(`its value "${ReplacedItem.shortBody(oldBody)}"`);
    }
    const kept = new Set(this.names.kidsOf(value).map((kid) => this.names.itemLabel(kid)));
    for (const kid of this.names.kidsOf(old)) {
      if (!kept.has(this.names.itemLabel(kid))) {
        lost.push(this.contentLabel(kid));
      }
    }
    if (extra) {
      lost.push(`${extra} more ${this.names.itemLabel(old)} with the same ${this.names.keyOf(old)?.attr ?? 'key'}`);
    }
    return lost;
  }

  private static shortBody(body: string): string {
    const trimmed = body.trim();
    return trimmed.length > 40 ? `${trimmed.slice(0, 37)}...` : trimmed;
  }

  private static escapeXml(text: string, attr: boolean): string {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return attr ? escaped.replace(/"/g, '&quot;') : escaped;
  }

  private snippetOf(el: BpmnElement): string {
    const attrs = Object.entries(this.names.attrsOf(el))
      .map(([attrName, attrValue]) => ` ${attrName}="${ReplacedItem.escapeXml(attrValue, true)}"`)
      .join('');
    const kids = this.names.kidsOf(el).map((kid) => this.snippetOf(kid));
    const body = el.peek('$body');
    const text = typeof body === 'string' ? ReplacedItem.escapeXml(body, false) : '';
    if (!kids.length && !text) {
      return `<${el.type}${attrs} />`;
    }
    return `<${el.type}${attrs}>${text}${kids.join('')}</${el.type}>`;
  }

  private contentLabel(el: BpmnElement): string {
    const kids = this.names.kidsOf(el).map((kid) => this.names.itemLabel(kid));
    const body = this.names.bodyOf(el);
    const inside = [...kids, ...(body !== undefined ? [`"${ReplacedItem.shortBody(body)}"`] : [])];
    return `${this.names.itemLabel(el)}${inside.length ? ` (${inside.join(', ')})` : ''}`;
  }

  private mergedCopy(old: BpmnElement, value: BpmnElement): BpmnElement {
    const props: Record<string, unknown> = { ...this.names.attrsOf(old), ...this.names.attrsOf(value) };
    const body = this.names.bodyOf(value) ?? this.names.bodyOf(old);
    if (body !== undefined) {
      props['$body'] = body;
    }
    const copy = this.document.tree.buildAny(value.type, (value.descriptor as { ns?: { uri?: string } }).ns?.uri ?? '', props);
    const fresh = new Map(this.names.kidsOf(value).map((kid) => [this.names.itemLabel(kid), kid]));
    const kids: BpmnElement[] = [];
    for (const kid of this.names.kidsOf(old)) {
      const label = this.names.itemLabel(kid);
      kids.push(fresh.get(label) ?? kid);
      fresh.delete(label);
    }
    kids.push(...fresh.values());
    if (kids.length) {
      copy.set('$children', kids);
    }
    return copy;
  }

  private addTypeFor(level: ExtensionLevel, value: BpmnElement): string {
    if (!level.parent) {
      return value.type;
    }
    const filed = level.parent.parent?.is('bpmn:ExtensionElements') && this.structure.homeAt(this.names.typeOf(value), undefined) === this.names.typeOf(level.parent);
    return filed ? value.type : `${this.names.pathOf(level.parent)}/${value.type}`;
  }
}
