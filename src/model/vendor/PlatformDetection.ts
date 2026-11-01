import type { BpmnElement } from '../document/BpmnElement.js';
import { CamundaDescriptor } from './CamundaDescriptor.js';
import { DocumentNamespaces } from './DocumentNamespaces.js';
import { ZeebeDescriptor } from './ZeebeDescriptor.js';

export type Platform = 'c7' | 'c8' | 'none';

export type Target = 'camunda8' | 'camunda7' | 'none';

export interface PlatformInfo {
  platform: Platform;
  source: 'executionPlatform' | 'namespace-use' | 'namespace-declaration' | 'none';
  detail: string;
  operaton?: boolean;
}

export class PlatformDetection {
  static readonly TARGETS: readonly Target[] = ['camunda8', 'camunda7', 'none'];
  private static readonly PLATFORM_OF_TARGET: Readonly<Record<Target, Platform>> = { camunda8: 'c8', camunda7: 'c7', none: 'none' };
  private static readonly OPERATON_NOTE = 'only Operaton reads the operaton namespace, Camunda 7 and CIB seven ignore it';

  constructor(private readonly definitions: BpmnElement) {}

  static platformOfTarget(target: Target | undefined): Platform {
    return target ? PlatformDetection.PLATFORM_OF_TARGET[target] : 'none';
  }

  info(): PlatformInfo {
    const ns = new DocumentNamespaces(this.definitions);
    const usage = ns.usage();
    const declared = ns.executionPlatform();
    const operaton = usage.get(CamundaDescriptor.OPERATON_URI) ?? 0;
    const platform = declared === undefined ? undefined : this.fromExecutionPlatform(declared);
    if (platform) {
      return this.withOperaton({ platform, source: 'executionPlatform', detail: `modeler:executionPlatform "${declared}"` }, operaton);
    }
    return this.fromUsage(usage, operaton) ?? this.fromDeclarations(ns, declared);
  }

  private withOperaton(info: PlatformInfo, operaton: number): PlatformInfo {
    if (info.platform !== 'c7' || operaton === 0) {
      return info;
    }
    const note = info.source === 'namespace-use' ? {} : { detail: `${info.detail}; ${operaton} operaton attribute(s)/element(s): ${PlatformDetection.OPERATON_NOTE}` };
    return { ...info, operaton: true, ...note };
  }

  private fromUsage(usage: Map<string, number>, operaton: number): PlatformInfo | undefined {
    const camunda = usage.get(CamundaDescriptor.URI) ?? 0;
    const c7 = [...CamundaDescriptor.C7_URIS].reduce((sum, uri) => sum + (usage.get(uri) ?? 0), 0);
    const c8 = usage.get(ZeebeDescriptor.URI) ?? 0;
    if (!c7 && !c8) {
      return undefined;
    }
    const platform: Platform = c7 >= c8 ? 'c7' : 'c8';
    const parts = [camunda ? `${camunda} camunda` : '', operaton ? `${operaton} operaton` : '', c8 ? `${c8} zeebe` : ''].filter(Boolean).join(' and ');
    const note = platform === 'c7' && operaton ? `; ${PlatformDetection.OPERATON_NOTE}` : '';
    return this.withOperaton({ platform, source: 'namespace-use', detail: `${parts} attribute(s)/element(s)${note}` }, operaton);
  }

  private fromDeclarations(ns: DocumentNamespaces, declared: string | undefined): PlatformInfo {
    const declaredC7 = [...CamundaDescriptor.C7_URIS].filter((uri) => ns.declares(uri));
    const declaresC8 = ns.declares(ZeebeDescriptor.URI);
    const xmlns = (uri: string): string => `xmlns:${ns.prefixOf(uri) ?? ''}`;
    if (declaredC7.length > 0 !== declaresC8) {
      const declaration = declaresC8 ? xmlns(ZeebeDescriptor.URI) : declaredC7.map(xmlns).join(' and ');
      return { platform: declaresC8 ? 'c8' : 'c7', source: 'namespace-declaration', detail: `${declaration} declared (no vendor content yet)` };
    }
    if (declaredC7.length && declaresC8) {
      return { platform: 'none', source: 'none', detail: `${[...declaredC7.map(xmlns), xmlns(ZeebeDescriptor.URI)].join(' and ')} declared, but no vendor content tells which engine` };
    }
    return { platform: 'none', source: 'none', detail: declared !== undefined ? `unknown modeler:executionPlatform "${declared}", no vendor content` : 'no executionPlatform and no vendor namespace' };
  }

  private fromExecutionPlatform(value: string): Platform | undefined {
    const normalized = value.trim().toLowerCase();
    if (normalized.startsWith('camunda platform') || normalized.startsWith('camunda 7') || normalized.startsWith('operaton') || normalized.startsWith('cib seven') || normalized.startsWith('cibseven')) {
      return 'c7';
    }
    if (normalized.startsWith('camunda cloud') || normalized.startsWith('camunda 8') || normalized.startsWith('zeebe')) {
      return 'c8';
    }
    return undefined;
  }
}
