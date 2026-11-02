// bpmn-moddle@10 types only its element interfaces

declare module 'bpmn-moddle' {
  import type { ModdleElement } from 'moddle';
  import { Moddle } from 'moddle';

  export interface ImportWarning {
    message: string;
    element?: ModdleElement;
    property?: string;
    value?: string;
    error?: Error;
  }

  export interface ImportResult {
    rootElement: ModdleElement;
    elementsById: Record<string, ModdleElement>;
    references: Array<{ element: ModdleElement; property: string; id: string }>;
    warnings: ImportWarning[];
  }

  export interface ImportError extends Error {
    warnings: ImportWarning[];
  }

  export class BpmnModdle extends Moddle {
    constructor(additionalPackages?: Record<string, unknown>, options?: { strict?: boolean });
    fromXML(xml: string, typeName?: string, options?: { lax?: boolean }): Promise<ImportResult>;
    fromXML(xml: string, options?: { lax?: boolean }): Promise<ImportResult>;
    toXML(element: ModdleElement, options?: { format?: boolean; preamble?: boolean }): Promise<{ xml: string }>;
  }
}

declare module 'bpmnlint/lib/linter.js' {
  /** bpmnlint's linter; bpmn-cli types what it uses in adapters/out/bpmnlint/bpmnlint-contract.ts */
  const Linter: new (options: { config?: unknown; resolver: unknown; transformRule?: unknown }) => { lint(root: unknown): Promise<Record<string, unknown[]>> };
  export default Linter;
}
