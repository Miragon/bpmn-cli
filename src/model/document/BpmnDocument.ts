import { DiagramIndex } from '../diagram/DiagramIndex.js';
import { BpmnError } from '../errors/BpmnError.js';
import { IdAllocator } from '../ids/IdAllocator.js';
import type { IdConventions } from '../ids/IdDefaults.js';
import { IdRegistry } from '../ids/IdRegistry.js';
import { IdStyle } from '../ids/IdStyle.js';
import { FlowRules } from '../kinds/FlowRules.js';
import { CamundaDescriptor } from '../vendor/CamundaDescriptor.js';
import { DeclaredNamespaces } from '../vendor/DeclaredNamespaces.js';
import { PlatformDetection, type Platform } from '../vendor/PlatformDetection.js';
import type { ImportWarning } from '../xml/ModdleParser.js';
import { BpmnScopes } from './BpmnScopes.js';
import type { BpmnElement } from './BpmnElement.js';
import type { BpmnTree } from './BpmnTree.js';
import { FlowGraph } from './FlowGraph.js';
import { type MirrorSnapshot } from './MirrorLists.js';

export interface DocumentSource {
  text: string;
  mirror: MirrorSnapshot;
  asRead?: string;
}

export interface DocumentParts {
  tree: BpmnTree;
  registry: IdRegistry;
  importWarnings: ImportWarning[];
  file?: string | undefined;
  source?: DocumentSource | undefined;
}

export class BpmnDocument {
  private static readonly LOSSY_PATTERNS = [/unparsable content/i, /unrecognized element/i, /unresolved reference/i, /duplicate ID/i, /^duplicate element/i];

  readonly tree: BpmnTree;
  readonly scopes: BpmnScopes;
  readonly flows: FlowGraph;
  readonly flowRules: FlowRules;
  readonly namespaces: DeclaredNamespaces;
  readonly diagram: DiagramIndex;
  readonly ids: IdAllocator;
  readonly importWarnings: ImportWarning[];
  readonly file: string | undefined;
  readonly source: DocumentSource | undefined;
  followFlowEnds = true;
  private style: IdStyle | undefined;
  private declared: IdConventions | undefined;

  constructor({ tree, registry, importWarnings, file, source }: DocumentParts) {
    this.tree = tree;
    this.scopes = new BpmnScopes(tree);
    this.flows = new FlowGraph(tree);
    this.flowRules = new FlowRules(this.scopes, this.flows);
    this.namespaces = new DeclaredNamespaces(tree.definitions);
    this.diagram = new DiagramIndex(tree);
    this.ids = new IdAllocator(tree, registry, () => this.idStyle);
    this.importWarnings = importWarnings;
    this.file = file;
    this.source = source;
  }

  platform(): Platform {
    return new PlatformDetection(this.tree.definitions).info().platform;
  }

  initProcess(process: BpmnElement, platform = this.platform()): void {
    if (platform !== 'c7') {
      return;
    }
    const { namespaces } = this;
    const camunda = DeclaredNamespaces.KNOWN['camunda']!;
    const operaton = DeclaredNamespaces.KNOWN['operaton']!;
    const hasTimeToLive = [camunda, operaton].some((uri) => {
      const prefix = namespaces.prefixFor(uri);
      return prefix !== undefined && process.attrs[`${prefix}:historyTimeToLive`] !== undefined;
    });
    if (hasTimeToLive) {
      return;
    }
    const uri = !namespaces.prefixFor(camunda) && namespaces.prefixFor(operaton) ? operaton : camunda;
    const prefix = namespaces.prefixFor(uri) ?? (uri === operaton ? 'operaton' : 'camunda');
    namespaces.declare(prefix, uri);
    process.attrs[`${prefix}:historyTimeToLive`] = CamundaDescriptor.DEFAULT_TTL;
  }

  get conventions(): IdConventions | undefined {
    return this.declared;
  }

  set conventions(conventions: IdConventions | undefined) {
    if (conventions !== this.declared) {
      this.declared = conventions;
      this.style = undefined;
    }
  }

  get idStyle(): IdStyle {
    this.style ??= IdStyle.of(this.declared);
    return this.style;
  }

  get lossyImportWarnings(): ImportWarning[] {
    return this.importWarnings.filter((warning) => BpmnDocument.LOSSY_PATTERNS.some((pattern) => pattern.test(warning.message)));
  }

  get reportedImportWarnings(): ImportWarning[] {
    const isDecisionLink = ({ property, element }: ImportWarning): boolean => property === 'calledDecision' && element?.$instanceOf('bpmn:BusinessRuleTask') === true;
    return this.importWarnings.some(isDecisionLink) && this.platform() === 'none' ? this.importWarnings.filter((warning) => !isDecisionLink(warning)) : this.importWarnings;
  }

  assertLossless(options: { force?: boolean | undefined } = {}): void {
    const lossy = this.lossyImportWarnings;
    if (!lossy.length || options.force) {
      return;
    }
    throw BpmnError.io('E_IMPORT_LOSSY', `${this.file ?? 'The XML'} contains content bpmn-moddle cannot represent; writing it back would lose data`, {
      ...(this.file ? { file: this.file } : {}),
      warnings: lossy.map((warning) => warning.message.split('\n')[0]),
      hint: 'Fix the XML, or pass --force (MutationOptions.force) to write anyway (the reported content will be dropped).',
    });
  }
}
