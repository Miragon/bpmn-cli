import { type BpmnElement, BpmnError, CAMUNDA, type ChangeSet, ZEEBE } from '../../model/index.js';
import { ExtensionStructure } from './ExtensionStructure.js';
import { NestedHosts } from './NestedHosts.js';
import type { VendorElements } from './VendorElements.js';
import { VendorFamily } from './VendorFamily.js';

export class ExtensionChecks {
  private readonly structure = ExtensionStructure.INSTANCE;
  private readonly hosts = NestedHosts.INSTANCE;

  constructor(private readonly names: VendorElements) {}

  assertCanHoldExtensions(el: BpmnElement): void {
    if (el.is('bpmn:Definitions')) {
      throw BpmnError.model('E_WRONG_KIND', `${this.hosts.labelOf(el)} is the bpmn:definitions element, which cannot hold extension elements (BPMN 2.0 XSD; the engines reject such a file)`, {
        element: this.hosts.idOf(el),
        hint: 'Put process-level extensions on the process: `bpmn ext add <file> <processId> camunda:properties ...` (`bpmn show <file>` lists the process id).',
      });
    }
    if (!el.is('bpmn:BaseElement')) {
      throw BpmnError.model('E_WRONG_KIND', `${this.hosts.labelOf(el) || el.type} (${el.type}) cannot hold bpmn:extensionElements`, {
        element: this.hosts.idOf(el),
        hint: 'Extension elements belong to BPMN elements: processes, flow nodes, flows, event definitions, ...',
      });
    }
  }

  checkInsert(host: BpmnElement, items: BpmnElement[], levelType: string | undefined, value: BpmnElement, replace: boolean): void {
    const typeName = this.names.typeOf(value);
    const home = this.structure.homeAt(typeName, levelType);
    if (home) {
      const homes = items.filter((item) => this.names.typeOf(item) === home);
      if (homes.length > 1) {
        this.duplicate(host, `${this.hosts.labelOf(host)} already has ${homes.length} ${homes[0]!.type} elements; ${value.type} cannot be placed unambiguously (the engines reject more than one)`, homes[0]!.type);
      }
      if (homes.length === 1) {
        this.checkInsert(host, this.names.kidsOf(homes[0]!), home, value, replace);
      }
      return;
    }
    if (replace || this.names.keyOf(value) || !this.structure.isSingle(typeName, levelType)) {
      return;
    }
    const same = items.filter((item) => this.names.typeOf(item) === typeName);
    if (same.length > 1) {
      this.duplicate(host, `${this.hosts.labelOf(host)} already has ${same.length} ${same[0]!.type} elements (only one is allowed); merging into them is ambiguous`, value.type);
    }
    if (same.length === 1) {
      this.checkMerge(host, same[0]!, value);
    }
  }

  private checkMerge(host: BpmnElement, existing: BpmnElement, incoming: BpmnElement): void {
    const have = this.names.attrsOf(existing);
    for (const [attrName, attrValue] of Object.entries(this.names.attrsOf(incoming))) {
      if (have[attrName] !== undefined && have[attrName] !== attrValue) {
        this.duplicate(host, `${this.hosts.labelOf(host)} already has a ${existing.type} with ${attrName}="${have[attrName]}"; the new one says ${attrName}="${attrValue}" (only one ${existing.type} is allowed)`, incoming.type);
      }
    }
    const hb = this.names.bodyOf(existing);
    const ib = this.names.bodyOf(incoming);
    if (hb !== undefined && ib !== undefined && hb.trim() !== ib.trim()) {
      this.duplicate(host, `${this.hosts.labelOf(host)} already has a ${existing.type} with the value "${hb.trim()}"; the new one is "${ib.trim()}" (only one ${existing.type} is allowed)`, incoming.type);
    }
    for (const kid of this.names.kidsOf(incoming)) {
      this.checkInsert(host, this.names.kidsOf(existing), this.names.typeOf(existing), kid, false);
    }
  }

  warnMisplaced(host: BpmnElement, snippet: BpmnElement, changes: ChangeSet): void {
    if (snippet.parent !== host.get<BpmnElement | undefined>('extensionElements')) {
      return;
    }
    const typeName = this.names.typeOf(snippet);
    if (typeName.startsWith('zeebe:')) {
      const local = typeName.slice('zeebe:'.length);
      const zeebeType = ZEEBE.type(local);
      if (!zeebeType || ZEEBE.allowedOn(local, host) !== false) {
        return;
      }
      const hosts = zeebeType.allowedIn.filter((allowedType) => allowedType.startsWith('bpmn:')).map((allowedType) => allowedType.slice(5).replace(/^./, (firstChar) => firstChar.toLowerCase()));
      changes.warn({
        code: 'W_MISPLACED_EXTENSION',
        message: `${snippet.type} on ${this.hosts.labelOf(host)} (${host.type}) is not read by Camunda 8: it belongs on ${hosts.length > 5 ? `${hosts.slice(0, 5).join(', ')}, ...` : hosts.join(', ')}`,
        element: this.hosts.idOf(host),
        hint: `Remove it (\`bpmn ext remove <file> ${this.hosts.idOf(host)} ${this.hosts.slotPrefix(host)}${snippet.type}\`) and add it where it is read (\`bpmn guide zeebe-elements\` lists the zeebe elements).`,
      });
      return;
    }
    if (!new VendorFamily(typeName).isCamunda()) {
      return;
    }
    if (this.structure.isNestedOnly(typeName)) {
      const containers = this.structure.containersOf(typeName);
      changes.warn({
        code: 'W_MISPLACED_EXTENSION',
        message: `${snippet.type} was added at the top level of the extensionElements of ${this.hosts.labelOf(host)}, where the engines do not read it; it belongs inside ${containers.join(' / ')}`,
        element: this.hosts.idOf(host),
        hint: `Add it with a path to its container, e.g. \`bpmn ext add <file> ${this.hosts.idOf(host)} '${this.hosts.slotPrefix(host)}${new VendorFamily(typeName).spellPath(this.structure.examplePath(typeName, containers))}' ...\`, and remove the loose one with \`bpmn ext remove <file> ${this.hosts.idOf(host)} ${this.hosts.slotPrefix(host)}${snippet.type}\`.`,
      });
      return;
    }
    if (new VendorFamily(typeName).ruleName() === 'camunda:field' && CAMUNDA.allowedOn(new VendorFamily(typeName).ruleName(), host) === false) {
      changes.warn({
        code: 'W_MISPLACED_EXTENSION',
        message: `${snippet.type} on ${this.hosts.labelOf(host)} (${host.type}) is not read by the engines: field injection belongs to service, send and business rule tasks, a message event definition or a listener`,
        element: this.hosts.idOf(host),
        hint: `Put it into a listener, e.g. \`bpmn ext add <file> ${this.hosts.idOf(host)} '${new VendorFamily(typeName).spellPath('camunda:executionListener[0]/camunda:field')}' name=... stringValue=...\`.`,
      });
    }
  }
  private duplicate(host: BpmnElement, message: string, related?: string): never {
    throw BpmnError.model('E_DUPLICATE_EXTENSION', message, {
      element: this.hosts.idOf(host),
      hint: `Pass --replace to replace it as a whole${related ? ` (ext add <file> ${this.hosts.idOf(host)} ${this.hosts.slotPrefix(host)}${related} ... --replace)` : ''}, or remove the old one first with \`bpmn ext remove <file> ${this.hosts.idOf(host)} ${this.hosts.slotPrefix(host)}<selector>\` (see \`bpmn show <file> ${this.hosts.idOf(host)}\`).`,
    });
  }
}
