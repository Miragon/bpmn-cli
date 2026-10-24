import { CAMUNDA, type CamundaDescriptor } from '../platform/CamundaDescriptor.js';
import { ZEEBE, type ZeebeDescriptor } from '../platform/ZeebeDescriptor.js';
import { inFamily, isCamunda, ruleName } from './utils/vendor-family.js';

/** Children that occur at most once inside their vendor parent. */
export const SINGLE_CHILD: Readonly<Record<string, readonly string[]>> = {
  // engine-verified: a second one is ENGINE-01009 on all three C7 engines
  'camunda:connector': ['camunda:connectorId', 'camunda:inputOutput'],
  'camunda:formField': ['camunda:properties', 'camunda:validation'],
  'camunda:executionListener': ['camunda:script'],
  'camunda:taskListener': ['camunda:script'],
  // single-valued properties of the descriptor
  'camunda:field': ['camunda:string', 'camunda:expression'],
  'camunda:potentialStarter': ['bpmn:resourceAssignmentExpression'],
};

/** Identity of repeatable items: same type and same value of the first attribute present = the same item (adding replaces it). */
export const KEYS: Readonly<Record<string, readonly string[]>> = {
  'camunda:inputParameter': ['name'],
  'camunda:outputParameter': ['name'],
  'camunda:formField': ['id'],
  'camunda:property': ['name', 'id'],
  'camunda:field': ['name'],
  'camunda:constraint': ['name'],
  'camunda:value': ['id'],
  'camunda:entry': ['key'],
  'zeebe:input': ['target'],
  'zeebe:output': ['target'],
  'zeebe:header': ['key'],
  'zeebe:property': ['name'],
};

/** Child order of containers whose schema is a sequence (camunda.xsd / zeebe.xsd, the order the modelers write). */
const CHILD_ORDER: Readonly<Record<string, readonly string[]>> = {
  'camunda:inputOutput': ['camunda:inputParameter', 'camunda:outputParameter'],
  'camunda:connector': ['camunda:inputOutput', 'camunda:connectorId'],
  'camunda:formField': ['camunda:properties', 'camunda:validation', 'camunda:value'],
  'camunda:executionListener': ['camunda:script', 'camunda:field'],
  'camunda:taskListener': ['camunda:script', 'camunda:field', 'bpmn:timerEventDefinition'],
  'zeebe:ioMapping': ['zeebe:input', 'zeebe:output'],
};

/** Containers that mean nothing once empty: removed with their last child. */
const PURE_CONTAINERS: ReadonlySet<string> = new Set([
  'camunda:inputOutput',
  'camunda:formData',
  'camunda:properties',
  'camunda:validation',
  'zeebe:ioMapping',
  'zeebe:taskHeaders',
  'zeebe:properties',
  'zeebe:executionListeners',
  'zeebe:taskListeners',
  'zeebe:linkedResources',
]);

/** The container used in hints for types the descriptor allows in many places. */
const EXAMPLE_CONTAINER: Readonly<Record<string, string>> = {
  'camunda:value': 'camunda:formField',
  'camunda:script': 'camunda:executionListener',
  'camunda:list': 'camunda:inputParameter',
  'camunda:map': 'camunda:inputParameter',
};

export class ExtensionStructure {
  /**
   * Types that occur at most once in bpmn:extensionElements (canonical names:
   * camunda: / zeebe: by namespace URI, whatever prefix a file uses).
   */
  readonly singleTop: ReadonlySet<string>;
  /** Containers of child types the camunda descriptor does not describe as types (and all Zeebe ones). */
  private readonly staticHomes: Readonly<Record<string, string>>;

  constructor(
    private readonly camunda: CamundaDescriptor,
    zeebe: ZeebeDescriptor,
  ) {
    this.singleTop = new Set([...camunda.singles, ...zeebe.singles]);
    this.staticHomes = {
      'camunda:connectorId': 'camunda:connector', // a String property of camunda:Connector, written as an element
      ...zeebe.nestedHomes(),
    };
  }

  /** A camunda type that may only appear inside another vendor element (descriptor: no allowedIn, but a container). */
  nestedOnly(type: string): boolean {
    const t = ruleName(type);
    return isCamunda(t) && !this.camunda.allowedParents(t).some((p) => p === '*' || p.startsWith('bpmn:')) && this.camunda.containersOf(t).length > 0;
  }

  /**
   * Where an item of `type` goes when it is inserted at a level of type
   * `levelType` (undefined = the top of extensionElements) but does not belong
   * there itself: the container type to find or create there, or undefined.
   */
  homeAt(type: string, levelType: string | undefined): string | undefined {
    if (levelType !== undefined && this.holds(levelType, type)) return undefined;
    const home = this.containerOf(type);
    if (!home) return undefined;
    if (levelType === undefined) return this.staticHomes[ruleName(type)] || !this.nestedOnly(home) ? home : undefined;
    return this.holds(levelType, home) ? home : undefined;
  }

  /** A path step that `ext add` may create when it is missing: a container that needs no attributes of its own. */
  creatable(type: string): boolean {
    const t = ruleName(type);
    return PURE_CONTAINERS.has(t) || this.singleTop.has(t) || Object.values(SINGLE_CHILD).some((c) => c.includes(t));
  }

  isSingle(type: string, levelType: string | undefined): boolean {
    return levelType === undefined ? this.singleTop.has(ruleName(type)) : !!SINGLE_CHILD[ruleName(levelType)]?.includes(ruleName(type));
  }

  keysOf(type: string): readonly string[] {
    return KEYS[ruleName(type)] ?? [];
  }

  childOrder(type: string): readonly string[] | undefined {
    return CHILD_ORDER[ruleName(type)];
  }

  isPureContainer(type: string): boolean {
    return PURE_CONTAINERS.has(ruleName(type));
  }

  containersOf(type: string): string[] {
    return this.camunda
      .containersOf(ruleName(type))
      .filter((c) => !c.endsWith('inputOutputParameter'))
      .map((c) => inFamily(c, type));
  }

  examplePath(type: string, containers: string[]): string {
    return this.pathTo(ruleName(type), EXAMPLE_CONTAINER[ruleName(type)] ?? ruleName(containers[0]!));
  }

  /** True when vendor type `parent` holds `child` as a direct child. */
  private holds(parent: string, child: string): boolean {
    const p = ruleName(parent);
    const c = ruleName(child);
    if (SINGLE_CHILD[p]?.includes(c)) return true;
    if (this.staticHomes[c] === p) return true;
    return isCamunda(c) && this.camunda.containersOf(c).includes(p);
  }

  /** The one container type of a child type, if it has exactly one (in the child's namespace family). */
  private containerOf(type: string): string | undefined {
    const t = ruleName(type);
    const fixed = this.staticHomes[t];
    if (fixed) return inFamily(fixed, type);
    if (!this.nestedOnly(t)) return undefined;
    const all = this.camunda.containersOf(t);
    return all.length === 1 ? inFamily(all[0]!, type) : undefined;
  }

  /**
   * An example path from the top of extensionElements to `type` through
   * `container` (containers that are themselves nested only are walked up
   * until one sits in extensionElements, which the path then leaves out:
   * camunda:constraint -> 'camunda:formField[id=<id>]/camunda:validation/camunda:constraint').
   */
  private pathTo(type: string, container: string): string {
    const chain = [type];
    let c: string | undefined = container;
    for (let i = 0; c && this.nestedOnly(c) && i < 6; i++) {
      chain.unshift(c);
      const up: string[] = this.camunda.containersOf(c).filter((x) => !x.endsWith('inputOutputParameter'));
      c = up.length === 1 ? up[0] : undefined;
    }
    if (c && !this.nestedOnly(c) && chain.length === 1) chain.unshift(c);
    return chain
      .map((t, i) => {
        const key = i < chain.length - 1 ? KEYS[t]?.[0] : undefined;
        return key ? `${t}[${key}=<${key}>]` : t;
      })
      .join('/');
  }
}

export const EXTENSION_STRUCTURE = new ExtensionStructure(CAMUNDA, ZEEBE);
