import { CAMUNDA, type CamundaDescriptor } from '../../platform/CamundaDescriptor.js';
import { ZEEBE, type ZeebeDescriptor } from '../../platform/ZeebeDescriptor.js';
import { inFamily, isCamunda, ruleName } from '../utils/vendor-family.js';

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

/** Same type and same value of the first attribute present is the same item: adding replaces it. */
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

/** Containers whose schema is a sequence (camunda.xsd / zeebe.xsd). */
const CHILD_ORDER: Readonly<Record<string, readonly string[]>> = {
  'camunda:inputOutput': ['camunda:inputParameter', 'camunda:outputParameter'],
  'camunda:connector': ['camunda:inputOutput', 'camunda:connectorId'],
  'camunda:formField': ['camunda:properties', 'camunda:validation', 'camunda:value'],
  'camunda:executionListener': ['camunda:script', 'camunda:field'],
  'camunda:taskListener': ['camunda:script', 'camunda:field', 'bpmn:timerEventDefinition'],
  'zeebe:ioMapping': ['zeebe:input', 'zeebe:output'],
};

/** Removed with their last child: they mean nothing once empty. */
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

const EXAMPLE_CONTAINER: Readonly<Record<string, string>> = {
  'camunda:value': 'camunda:formField',
  'camunda:script': 'camunda:executionListener',
  'camunda:list': 'camunda:inputParameter',
  'camunda:map': 'camunda:inputParameter',
};

/**
 * The structure rules of vendor extension elements: containers, keyed items, single-instance
 * types and child order. Names are canonical (camunda: / zeebe: by namespace URI).
 */
export class ExtensionStructure {
  readonly singleTop: ReadonlySet<string>;
  /** Containers of child types the camunda descriptor does not describe as types. */
  private readonly staticHomes: Readonly<Record<string, string>>;

  constructor(
    private readonly camunda: CamundaDescriptor,
    zeebe: ZeebeDescriptor,
  ) {
    this.singleTop = new Set([...camunda.singles, ...zeebe.singles]);
    this.staticHomes = {
      // a String property of camunda:Connector, written as an element
      'camunda:connectorId': 'camunda:connector',
      ...zeebe.nestedHomes(),
    };
  }

  nestedOnly(type: string): boolean {
    const t = ruleName(type);
    return isCamunda(t) && !this.camunda.allowedParents(t).some((p) => p === '*' || p.startsWith('bpmn:')) && this.camunda.containersOf(t).length > 0;
  }

  homeAt(type: string, levelType: string | undefined): string | undefined {
    if (levelType !== undefined && this.holds(levelType, type)) return undefined;
    const home = this.containerOf(type);
    if (!home) return undefined;
    if (levelType === undefined) return this.staticHomes[ruleName(type)] || !this.nestedOnly(home) ? home : undefined;
    return this.holds(levelType, home) ? home : undefined;
  }

  /** A container that needs no attributes of its own, so `ext add` may create it. */
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

  private holds(parent: string, child: string): boolean {
    const p = ruleName(parent);
    const c = ruleName(child);
    if (SINGLE_CHILD[p]?.includes(c)) return true;
    if (this.staticHomes[c] === p) return true;
    return isCamunda(c) && this.camunda.containersOf(c).includes(p);
  }

  private containerOf(type: string): string | undefined {
    const t = ruleName(type);
    const fixed = this.staticHomes[t];
    if (fixed) return inFamily(fixed, type);
    if (!this.nestedOnly(t)) return undefined;
    const all = this.camunda.containersOf(t);
    return all.length === 1 ? inFamily(all[0]!, type) : undefined;
  }

  /** camunda:constraint -> 'camunda:formField[id=<id>]/camunda:validation/camunda:constraint' */
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
