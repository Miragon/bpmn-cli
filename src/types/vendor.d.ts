// Type shims for bpmn-io packages that ship no (usable) TypeScript declarations.
// bpmn-moddle@10 only exposes element interfaces via "bpmn-moddle/types"; the
// runtime class comes from "moddle" (which is typed). bpmn-auto-layout ships no
// declarations at all.

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

declare module 'bpmn-auto-layout' {
  export class LayoutError extends Error {
    override name: 'LayoutError';
    code: string;
    elementId: string;
    relatedElementIds: string[];
  }
  export class LayoutWarning extends Error {
    override name: 'LayoutWarning';
    code: string;
    elementId: string;
    relatedElementIds: string[];
  }
  export function layoutProcess(xml: string): Promise<{ xml: string; warnings: LayoutWarning[] }>;
}
