import { type BpmnDocument, type BpmnElement, CAMUNDA, CamundaDescriptor, DocumentNamespaces } from '../../../model/index.js';
import { C7AttributeRules } from './C7AttributeRules.js';
import { C7BindingRules } from './C7BindingRules.js';
import { C7DescriptorNames } from './C7DescriptorNames.js';
import { C7EventRules } from './C7EventRules.js';
import { C7ExtensionContentRules } from './C7ExtensionContentRules.js';
import { C7ExtensionRules } from './C7ExtensionRules.js';
import { C7FlowRules } from './C7FlowRules.js';
import { C7ImplementationRules } from './C7ImplementationRules.js';
import { C7SchemaRules } from './C7SchemaRules.js';
import { C7StartEventRules } from './C7StartEventRules.js';
import { C7SubscriptionRules } from './C7SubscriptionRules.js';
import type { CamundaRules } from '../rules/CamundaRules.js';
import type { ElementStep } from '../rules/RuleWalk.js';
import { RuleContext } from '../rules/RuleContext.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { RuleWalk } from '../rules/RuleWalk.js';

export class C7Checks extends RuleWalk {
  private readonly rules: readonly CamundaRules[];
  private readonly flows: C7FlowRules;

  constructor(document: BpmnDocument, operaton: boolean) {
    super(document);
    const namespaces = new DocumentNamespaces(this.document.tree.definitions);
    const prefix = (operaton ? namespaces.prefixOf(CamundaDescriptor.OPERATON_URI) : undefined) ?? namespaces.prefixOf(CAMUNDA.uri) ?? namespaces.prefixOf(CamundaDescriptor.OPERATON_URI) ?? 'camunda';
    const context = new RuleContext(document, namespaces, prefix, operaton);
    const implementation = new C7ImplementationRules(context);
    const bindings = new C7BindingRules(context, implementation);
    this.flows = new C7FlowRules(context, bindings);
    this.rules = [
      new C7AttributeRules(context),
      new C7ExtensionRules(context, new C7DescriptorNames(), new C7ExtensionContentRules(context, implementation)),
      implementation,
      bindings,
      new C7EventRules(context, implementation),
      this.flows,
      new C7StartEventRules(context),
      new C7SubscriptionRules(context),
      new C7SchemaRules(context),
    ];
  }

  protected override checkDocument(reporter: RuleReporter): void {
    const { definitions } = this.document.tree;
    for (const rules of this.rules) {
      rules.check(definitions, reporter);
    }
    for (const root of definitions.list('rootElements')) {
      if (!root.is('bpmn:Process')) {
        this.visit(root, undefined, false, reporter);
      } else if (root.peek<boolean>('isExecutable') === true) {
        this.visit(root, undefined, true, reporter);
      }
    }
  }

  protected override checkElement(element: BpmnElement, reporter: RuleReporter): ElementStep {
    if (reporter.executable && element.is('bpmn:AdHocSubProcess')) {
      this.flows.checkAdHoc(element, reporter);
      return 'stop';
    }
    for (const rules of this.rules) {
      rules.check(element, reporter);
    }
    return 'descend';
  }
}
