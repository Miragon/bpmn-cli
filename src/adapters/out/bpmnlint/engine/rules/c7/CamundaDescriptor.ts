import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';

interface RawProperty {
  name: string;
  type?: string;
  isAttr?: boolean;
  isReference?: boolean;
}

interface RawType {
  name: string;
  superClass?: string[];
  extends?: string[];
  properties?: RawProperty[];
  meta?: { allowedIn?: string[] };
}

/**
 * Where the descriptor's `meta.allowedIn` is narrower than what the Camunda 7 engines accept: it
 * lacks sendTask, transaction and adHocSubProcess for listeners, and has none for starters.
 */
const ALLOWED_IN_OVERRIDES: Record<string, string[]> = {
  ExecutionListener: ['bpmn:FlowNode', 'bpmn:SequenceFlow', 'bpmn:Process'],
  PotentialStarter: ['bpmn:Process', 'bpmn:StartEvent'],
};

/** Hosts the descriptor misses but the engines read. */
const EXTRA_HOSTS: Record<string, string[]> = {
  potentialStarter: ['bpmn:Process'],
  errorEventDefinition: [
    'bpmn:ServiceTask',
    'bpmn:SendTask',
    'bpmn:BusinessRuleTask',
    'bpmn:MessageEventDefinition',
    'bpmn:IntermediateThrowEvent',
    'bpmn:EndEvent',
  ],
};

/**
 * What the camunda descriptor (camunda-bpmn-moddle) says about placement, by local name: the
 * element types each camunda attribute applies to, and the hosts each camunda extension element is
 * read on. Built once from the descriptor, as the typed moddle keeps a misplaced attribute in
 * `$attrs` and accepts any extension element anywhere.
 */
export class CamundaDescriptor {
  private static instance: CamundaDescriptor | undefined;
  private static descriptor: { types: unknown[] } | undefined;

  private readonly types = new Map<string, RawType>();
  private readonly subTypes = new Map<string, string[]>();
  private readonly hostsByType = new Map<string, string[]>();
  private readonly attributeOwners = new Map<string, string[]>();
  private readonly allowedInByLocal = new Map<string, string[]>();

  private constructor(rawTypes: RawType[]) {
    for (const rawType of rawTypes) {
      this.types.set(rawType.name, rawType);
    }
    for (const [name, rawType] of this.types) {
      for (const superName of this.camundaNames(rawType.superClass)) {
        this.subTypes.set(superName, [...(this.subTypes.get(superName) ?? []), name]);
      }
    }
    this.indexAttributes();
    this.indexElements();
  }

  /** The camunda descriptor (camunda-bpmn-moddle) the engine run hands over before it lints. */
  static use(descriptor: { types: unknown[] }): void {
    if (CamundaDescriptor.descriptor === descriptor) return;
    CamundaDescriptor.descriptor = descriptor;
    CamundaDescriptor.instance = undefined;
  }

  static get(): CamundaDescriptor {
    if (!CamundaDescriptor.descriptor) throw new Error('CamundaDescriptor.use(descriptor) runs before the Camunda 7 rules');
    CamundaDescriptor.instance ??= new CamundaDescriptor(CamundaDescriptor.descriptor.types as RawType[]);
    return CamundaDescriptor.instance;
  }

  /** `userTask`, `activity, gateway, event, multiInstanceLoopCharacteristics`: element types as a message names them, the first four only. */
  static kinds(types: string[]): string {
    const names = types.map((type) => type.replace(/^bpmn:/, '')).map((local) => local.charAt(0).toLowerCase() + local.slice(1));
    return names.length > 4 ? `${names.slice(0, 4).join(', ')}, ...` : names.join(', ');
  }

  /** Every camunda attribute name, in descriptor order. */
  attributeNames(): string[] {
    return [...this.attributeOwners.keys()];
  }

  /** The element types `local` applies to; undefined for an attribute the descriptor does not know. */
  ownersOf(local: string): string[] | undefined {
    return this.attributeOwners.get(local);
  }

  /** The camunda attribute names that apply to `el`. */
  attributeNamesFor(el: ModdleElement): string[] {
    return this.attributeNames().filter((local) => this.appliesTo(local, el));
  }

  appliesTo(local: string, el: ModdleElement): boolean {
    return (this.ownersOf(local) ?? []).some((owner) => el.$instanceOf(owner));
  }

  /** The hosts the engines read the extension element `local` on, the descriptor's and the extra ones. */
  hostsOf(local: string): string[] {
    return [...(this.allowedInByLocal.get(local) ?? []), ...(EXTRA_HOSTS[local] ?? [])];
  }

  /** Whether the engines read the extension element `local` directly in the extension elements of `host`. */
  isReadOn(local: string, host: ModdleElement): boolean {
    return this.hostsOf(local).some(
      (allowed) => allowed === '*' || (allowed.startsWith('bpmn:') && host.$instanceOf(allowed)),
    );
  }

  /** Whether `local` only appears nested in another camunda element (no host of its own). */
  isNestedOnly(local: string): boolean {
    return (this.allowedInByLocal.get(local) ?? []).length === 0;
  }

  /** The camunda elements (`camunda:formData`) that hold `local`; a slot typed with a super type accepts it too. */
  containersOf(local: string): string[] {
    const accepted = new Set<string>();
    this.addWithSupers(this.typeName(local), accepted);
    const containers: string[] = [];
    for (const [name, rawType] of this.types) {
      if (rawType.extends?.length) {
        continue;
      }
      const holds = this.propertiesOf(name, new Set()).some(
        (property) =>
          !property.isAttr && !property.isReference && accepted.has(this.localType(property.type)),
      );
      if (holds) {
        containers.push(`camunda:${this.lowerFirst(name)}`);
      }
    }
    return containers;
  }

  private indexAttributes(): void {
    for (const [name, rawType] of this.types) {
      const owners = this.hosts(name, new Set());
      if (!owners.length) {
        continue;
      }
      for (const property of rawType.properties ?? []) {
        if (!property.isAttr) {
          continue;
        }
        const local = property.name.replace(/^camunda:/, '');
        const known = this.attributeOwners.get(local);
        if (known) {
          known.push(...owners.filter((owner) => !known.includes(owner)));
        } else {
          this.attributeOwners.set(local, [...owners]);
        }
      }
    }
  }

  private indexElements(): void {
    for (const [name, rawType] of this.types) {
      if (rawType.extends?.length) {
        continue;
      }
      const allowedIn: string[] = [];
      for (const allowed of ALLOWED_IN_OVERRIDES[name] ?? rawType.meta?.allowedIn ?? []) {
        if (allowed === '*' || allowed.startsWith('bpmn:')) {
          allowedIn.push(allowed);
          continue;
        }
        const allowedName = allowed.replace(/^camunda:/, '');
        const allowedHosts = this.hosts(allowedName, new Set());
        allowedIn.push(
          ...(allowedHosts.length ? allowedHosts : [`camunda:${this.lowerFirst(allowedName)}`]),
        );
      }
      this.allowedInByLocal.set(this.lowerFirst(name), [...new Set(allowedIn)]);
    }
  }

  /** The BPMN types a camunda type extends, directly, through the camunda types it extends, or through its sub types. */
  private hosts(name: string, seen: Set<string>): string[] {
    const known = this.hostsByType.get(name);
    if (known) {
      return known;
    }
    if (seen.has(name)) {
      return [];
    }
    seen.add(name);
    const found = new Set<string>();
    for (const extended of this.types.get(name)?.extends ?? []) {
      if (extended.startsWith('bpmn:')) {
        found.add(extended);
      } else {
        this.hosts(extended.replace(/^camunda:/, ''), seen).forEach((host) => found.add(host));
      }
    }
    for (const sub of this.subTypes.get(name) ?? []) {
      this.hosts(sub, seen).forEach((host) => found.add(host));
    }
    const hosts = [...found];
    this.hostsByType.set(name, hosts);
    return hosts;
  }

  private propertiesOf(name: string, seen: Set<string>): RawProperty[] {
    if (seen.has(name)) {
      return [];
    }
    seen.add(name);
    const rawType = this.types.get(name);
    const inherited = this.camundaNames(rawType?.superClass).flatMap((superName) =>
      this.propertiesOf(superName, seen),
    );
    return [...inherited, ...(rawType?.properties ?? [])];
  }

  private addWithSupers(name: string, accepted: Set<string>): void {
    if (accepted.has(name)) {
      return;
    }
    accepted.add(name);
    for (const superName of this.camundaNames(this.types.get(name)?.superClass)) {
      this.addWithSupers(superName, accepted);
    }
  }

  /** The camunda type names of a `superClass` list (`Element`, `camunda:AsyncCapable`), without the BPMN ones. */
  private camundaNames(names: string[] | undefined): string[] {
    return (names ?? [])
      .filter((name) => !name.includes(':') || name.startsWith('camunda:'))
      .map((name) => name.replace(/^camunda:/, ''));
  }

  private localType(type: string | undefined): string {
    return (type ?? '').startsWith('bpmn:') ? '' : (type ?? '').replace(/^camunda:/, '');
  }

  private typeName(local: string): string {
    return local.charAt(0).toUpperCase() + local.slice(1);
  }

  private lowerFirst(name: string): string {
    return name.charAt(0).toLowerCase() + name.slice(1);
  }
}
