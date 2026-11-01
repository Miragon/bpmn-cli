import { CAMUNDA, type CamundaDescriptor, ZEEBE, type ZeebeDescriptor } from '../../model/index.js';
import { VendorFamily } from './VendorFamily.js';

export class ExtensionStructure {
  private static readonly SINGLE_CHILD: Readonly<Record<string, readonly string[]>> = {
    'camunda:connector': ['camunda:connectorId', 'camunda:inputOutput'],
    'camunda:formField': ['camunda:properties', 'camunda:validation'],
    'camunda:executionListener': ['camunda:script'],
    'camunda:taskListener': ['camunda:script'],
    'camunda:field': ['camunda:string', 'camunda:expression'],
    'camunda:potentialStarter': ['bpmn:resourceAssignmentExpression'],
  };

  private static readonly KEYS: Readonly<Record<string, readonly string[]>> = {
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

  private static readonly CHILD_ORDER: Readonly<Record<string, readonly string[]>> = {
    'camunda:inputOutput': ['camunda:inputParameter', 'camunda:outputParameter'],
    'camunda:connector': ['camunda:inputOutput', 'camunda:connectorId'],
    'camunda:formField': ['camunda:properties', 'camunda:validation', 'camunda:value'],
    'camunda:executionListener': ['camunda:script', 'camunda:field'],
    'camunda:taskListener': ['camunda:script', 'camunda:field', 'bpmn:timerEventDefinition'],
    'zeebe:ioMapping': ['zeebe:input', 'zeebe:output'],
  };

  private static readonly PURE_CONTAINERS: ReadonlySet<string> = new Set([
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

  private static readonly EXAMPLE_CONTAINER: Readonly<Record<string, string>> = {
    'camunda:value': 'camunda:formField',
    'camunda:script': 'camunda:executionListener',
    'camunda:list': 'camunda:inputParameter',
    'camunda:map': 'camunda:inputParameter',
  };

  static readonly INSTANCE = new ExtensionStructure(CAMUNDA, ZEEBE);

  readonly singleTop: ReadonlySet<string>;
  private readonly staticHomes: Readonly<Record<string, string>>;

  constructor(
    private readonly camunda: CamundaDescriptor,
    zeebe: ZeebeDescriptor,
  ) {
    this.singleTop = new Set([...camunda.singles, ...zeebe.singles]);
    this.staticHomes = {
      'camunda:connectorId': 'camunda:connector',
      ...zeebe.nestedHomes(),
    };
  }

  isNestedOnly(type: string): boolean {
    const typeName = new VendorFamily(type).ruleName();
    return new VendorFamily(typeName).isCamunda() && !this.camunda.allowedParents(typeName).some((allowedParent) => allowedParent === '*' || allowedParent.startsWith('bpmn:')) && this.camunda.containersOf(typeName).length > 0;
  }

  homeAt(type: string, levelType: string | undefined): string | undefined {
    if (levelType !== undefined && this.holds(levelType, type)) {
      return undefined;
    }
    const home = this.containerOf(type);
    if (!home) {
      return undefined;
    }
    if (levelType === undefined) {
      return this.staticHomes[new VendorFamily(type).ruleName()] || !this.isNestedOnly(home) ? home : undefined;
    }
    return this.holds(levelType, home) ? home : undefined;
  }

  isCreatable(type: string): boolean {
    const typeName = new VendorFamily(type).ruleName();
    return ExtensionStructure.PURE_CONTAINERS.has(typeName) || this.singleTop.has(typeName) || Object.values(ExtensionStructure.SINGLE_CHILD).some((children) => children.includes(typeName));
  }

  isSingle(type: string, levelType: string | undefined): boolean {
    return levelType === undefined ? this.singleTop.has(new VendorFamily(type).ruleName()) : !!ExtensionStructure.SINGLE_CHILD[new VendorFamily(levelType).ruleName()]?.includes(new VendorFamily(type).ruleName());
  }

  keysOf(type: string): readonly string[] {
    return ExtensionStructure.KEYS[new VendorFamily(type).ruleName()] ?? [];
  }

  childOrder(type: string): readonly string[] | undefined {
    return ExtensionStructure.CHILD_ORDER[new VendorFamily(type).ruleName()];
  }

  isPureContainer(type: string): boolean {
    return ExtensionStructure.PURE_CONTAINERS.has(new VendorFamily(type).ruleName());
  }

  containersOf(type: string): string[] {
    return this.camunda
      .containersOf(new VendorFamily(type).ruleName())
      .filter((containerName) => !containerName.endsWith('inputOutputParameter'))
      .map((containerName) => new VendorFamily(type).spell(containerName));
  }

  examplePath(type: string, containers: string[]): string {
    return this.pathTo(new VendorFamily(type).ruleName(), ExtensionStructure.EXAMPLE_CONTAINER[new VendorFamily(type).ruleName()] ?? new VendorFamily(containers[0]!).ruleName());
  }

  private holds(parent: string, child: string): boolean {
    const parentName = new VendorFamily(parent).ruleName();
    const childName = new VendorFamily(child).ruleName();
    if (ExtensionStructure.SINGLE_CHILD[parentName]?.includes(childName)) {
      return true;
    }
    if (this.staticHomes[childName] === parentName) {
      return true;
    }
    return new VendorFamily(childName).isCamunda() && this.camunda.containersOf(childName).includes(parentName);
  }

  private containerOf(type: string): string | undefined {
    const typeName = new VendorFamily(type).ruleName();
    const fixed = this.staticHomes[typeName];
    if (fixed) {
      return new VendorFamily(type).spell(fixed);
    }
    if (!this.isNestedOnly(typeName)) {
      return undefined;
    }
    const all = this.camunda.containersOf(typeName);
    return all.length === 1 ? new VendorFamily(type).spell(all[0]!) : undefined;
  }

  private pathTo(type: string, container: string): string {
    const chain = [type];
    let current: string | undefined = container;
    for (let depth = 0; current && this.isNestedOnly(current) && depth < 6; depth++) {
      chain.unshift(current);
      const up: string[] = this.camunda.containersOf(current).filter((upper) => !upper.endsWith('inputOutputParameter'));
      current = up.length === 1 ? up[0] : undefined;
    }
    if (current && !this.isNestedOnly(current) && chain.length === 1) {
      chain.unshift(current);
    }
    return chain
      .map((typeName, index) => {
        const key = index < chain.length - 1 ? ExtensionStructure.KEYS[typeName]?.[0] : undefined;
        return key ? `${typeName}[${key}=<${key}>]` : typeName;
      })
      .join('/');
  }
}

