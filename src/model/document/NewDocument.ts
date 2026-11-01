import { BpmnError } from '../errors/BpmnError.js';
import type { IdConventions } from '../ids/IdDefaults.js';
import { IdRegistry } from '../ids/IdRegistry.js';
import { IdRequests } from '../ids/IdRequests.js';
import { IdSlug } from '../ids/IdSlug.js';
import { IdStyle } from '../ids/IdStyle.js';
import { IdWords } from '../ids/IdWords.js';
import { CamundaDescriptor } from '../vendor/CamundaDescriptor.js';
import { PlatformDetection, type Platform, type Target } from '../vendor/PlatformDetection.js';
import { ZeebeDescriptor } from '../vendor/ZeebeDescriptor.js';
import { ModdleParser } from '../xml/ModdleParser.js';
import { BpmnDocument } from './BpmnDocument.js';
import { BpmnElement } from './BpmnElement.js';
import { BpmnTree } from './BpmnTree.js';

export interface NewDocumentOptions {
  processId?: string;
  processName?: string;
  executable?: boolean;
  target?: Target;
  conventions?: IdConventions;
}

export class NewDocument {
  private static readonly TARGET_NAMESPACE = 'http://bpmn.io/schema/bpmn';

  constructor(private readonly options: NewDocumentOptions = {}) {}

  static assertTarget(target: unknown): asserts target is NewDocumentOptions['target'] {
    if (target !== undefined && !(PlatformDetection.TARGETS as readonly unknown[]).includes(target)) {
      throw BpmnError.usage(`Unknown --target "${String(target)}": expected camunda8 or camunda7`, {
        hint: 'camunda7 also covers CIB seven and Operaton (they read the camunda: namespace); camunda8 is Zeebe. Omit --target for a plain BPMN file.',
      });
    }
  }

  static assertProcessId(id: string): void {
    if (!IdSlug.isValidId(id)) {
      throw BpmnError.model('E_INVALID_ID', `"${id}" is not a valid id (XML NCName)`);
    }
  }

  create(file?: string): BpmnDocument {
    const { options } = this;
    NewDocument.assertTarget(options.target);
    const moddle = ModdleParser.moddle();
    const registry = new IdRegistry();
    const { processId, definitionsId } = this.rootIds(IdStyle.of(options.conventions), registry);
    const definitions = BpmnElement.of(moddle.create('bpmn:Definitions', { id: definitionsId, targetNamespace: NewDocument.TARGET_NAMESPACE }));
    const tree = new BpmnTree(moddle, definitions, registry);
    const process = tree.build('bpmn:Process', { id: processId, ...(options.processName ? { name: options.processName } : {}), isExecutable: options.executable ?? true });
    definitions.add('rootElements', process);
    const document = new BpmnDocument({ tree, registry, importWarnings: [], file });
    if (options.conventions) {
      document.conventions = options.conventions;
    }
    this.declarePlatform(document, process, PlatformDetection.platformOfTarget(options.target));
    return document;
  }

  private declarePlatform(document: BpmnDocument, process: BpmnElement, platform: Platform): void {
    if (platform === 'none') {
      return;
    }
    const { definitions } = document.tree;
    document.namespaces.declare(platform === 'c8' ? 'zeebe' : 'camunda');
    document.namespaces.declare('modeler');
    definitions.attrs['modeler:executionPlatform'] = platform === 'c8' ? 'Camunda Cloud' : 'Camunda Platform';
    definitions.attrs['modeler:executionPlatformVersion'] = platform === 'c8' ? ZeebeDescriptor.PLATFORM_VERSION : CamundaDescriptor.PLATFORM_VERSION;
    document.initProcess(process);
  }

  private rootIds(style: IdStyle, registry: IdRegistry): { processId: string; definitionsId: string } {
    const processId = this.options.processId ?? this.generatedProcessId(style, registry);
    NewDocument.assertProcessId(processId);
    registry.claim(processId);
    const definitionsId = this.definitionsIdFor(processId, style, registry);
    registry.claim(definitionsId);
    return { processId, definitionsId };
  }

  private generatedProcessId(style: IdStyle, registry: IdRegistry): string {
    const { processName } = this.options;
    const declared = style.explain(IdRequests.typeRequest('bpmn:Process')).source === 'lint';
    if (!processName && !declared) {
      return 'Process_1';
    }
    return style.next(IdRequests.typeRequest('bpmn:Process', processName ? { name: processName } : {}), registry).id;
  }

  private definitionsIdFor(processId: string, style: IdStyle, registry: IdRegistry): string {
    const { processName } = this.options;
    if (IdSlug.hasIdWords(processName)) {
      return style.next(IdRequests.typeRequest('bpmn:Definitions', { name: processName! }), registry).id;
    }
    const stem = IdWords.speakingStem(processId);
    if (stem || style.explain(IdRequests.typeRequest('bpmn:Definitions')).source === 'lint') {
      return style.next(IdRequests.typeRequest('bpmn:Definitions', stem ? { context: stem } : {}), registry).id;
    }
    return 'Definitions_1';
  }
}
