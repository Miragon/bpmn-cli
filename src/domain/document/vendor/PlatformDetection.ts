import type { Doc } from '../Doc.js';
import type { El } from '../utils/moddle.js';
import { CAMUNDA_URI, C7_URIS, OPERATON_URI } from './CamundaDescriptor.js';
import { DocumentNamespaces } from './DocumentNamespaces.js';
import { ZEEBE_URI } from './ZeebeDescriptor.js';

export type Platform = 'c7' | 'c8' | 'none';
export type PlatformChoice = Platform | 'auto';
export const PLATFORM_CHOICES: readonly PlatformChoice[] = ['auto', 'c7', 'c8', 'none'];

export interface PlatformInfo {
  platform: Platform;
  source: 'option' | 'executionPlatform' | 'namespace-use' | 'namespace-declaration' | 'none';
  detail: string;
  /** c7 only: the profile then reads operaton:* before camunda:* like Operaton does. */
  operaton?: boolean;
}

const OPERATON_NOTE = 'only Operaton reads the operaton namespace, Camunda 7 and CIB seven ignore it';

/**
 * Which engine a file targets, by order of evidence: an explicit choice,
 * `modeler:executionPlatform`, the vendor namespace the content uses, a declared but unused one.
 * The c7 family is Camunda 7, CIB seven and Operaton; only Operaton reads the operaton namespace.
 */
export class PlatformDetection {
  constructor(private readonly definitions: El) {}

  static of(doc: Doc): PlatformDetection {
    return new PlatformDetection(doc.definitions);
  }

  info(): PlatformInfo {
    const ns = new DocumentNamespaces(this.definitions);
    const usage = ns.usage();
    const camunda = usage.get(CAMUNDA_URI) ?? 0;
    const operaton = usage.get(OPERATON_URI) ?? 0;
    const c7 = [...C7_URIS].reduce((sum, uri) => sum + (usage.get(uri) ?? 0), 0);
    const c8 = usage.get(ZEEBE_URI) ?? 0;
    const declared = ns.executionPlatform();
    const withOperaton = (info: PlatformInfo): PlatformInfo =>
      info.platform === 'c7' && operaton > 0 ? { ...info, operaton: true, ...(info.source === 'namespace-use' ? {} : { detail: `${info.detail}; ${operaton} operaton attribute(s)/element(s): ${OPERATON_NOTE}` }) } : info;
    if (declared !== undefined) {
      const platform = this.fromExecutionPlatform(declared);
      if (platform) return withOperaton({ platform, source: 'executionPlatform', detail: `modeler:executionPlatform "${declared}"` });
    }
    if (c7 || c8) {
      const platform: Platform = c7 >= c8 ? 'c7' : 'c8';
      const parts = [camunda ? `${camunda} camunda` : '', operaton ? `${operaton} operaton` : '', c8 ? `${c8} zeebe` : ''].filter(Boolean).join(' and ');
      const note = platform === 'c7' && operaton ? `; ${OPERATON_NOTE}` : '';
      return withOperaton({ platform, source: 'namespace-use', detail: `${parts} attribute(s)/element(s)${note}` });
    }
    const declaredC7 = [...C7_URIS].filter((uri) => ns.declares(uri));
    const declaresC8 = ns.declares(ZEEBE_URI);
    const prefixOf = (uri: string): string => ns.prefixOf(uri) ?? '';
    if (declaredC7.length > 0 !== declaresC8) {
      const decl = declaresC8 ? `xmlns:${prefixOf(ZEEBE_URI)}` : declaredC7.map((uri) => `xmlns:${prefixOf(uri)}`).join(' and ');
      return { platform: declaresC8 ? 'c8' : 'c7', source: 'namespace-declaration', detail: `${decl} declared (no vendor content yet)` };
    }
    if (declaredC7.length && declaresC8) {
      const decl = [...declaredC7.map((uri) => `xmlns:${prefixOf(uri)}`), `xmlns:${prefixOf(ZEEBE_URI)}`].join(' and ');
      return { platform: 'none', source: 'none', detail: `${decl} declared, but no vendor content tells which engine` };
    }
    return { platform: 'none', source: 'none', detail: declared !== undefined ? `unknown modeler:executionPlatform "${declared}", no vendor content` : 'no executionPlatform and no vendor namespace' };
  }

  resolve(choice: PlatformChoice = 'auto'): PlatformInfo {
    if (choice === 'auto') return this.info();
    const info: PlatformInfo = { platform: choice, source: 'option', detail: '--platform option' };
    if (choice !== 'c7') return info;
    // the choice picks the profile; how Operaton content is read still comes from the file
    const detected = this.info();
    return detected.operaton ? { ...info, operaton: true, detail: `--platform option; the file uses the operaton namespace: ${OPERATON_NOTE}` } : info;
  }

  target(): 'camunda7' | 'camunda8' | undefined {
    const platform = this.info().platform;
    return platform === 'c7' ? 'camunda7' : platform === 'c8' ? 'camunda8' : undefined;
  }

  private fromExecutionPlatform(value: string): Platform | undefined {
    const normalized = value.trim().toLowerCase();
    if (normalized.startsWith('camunda platform') || normalized.startsWith('camunda 7') || normalized.startsWith('operaton') || normalized.startsWith('cib seven') || normalized.startsWith('cibseven')) return 'c7';
    if (normalized.startsWith('camunda cloud') || normalized.startsWith('camunda 8') || normalized.startsWith('zeebe')) return 'c8';
    return undefined;
  }
}
