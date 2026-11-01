import { type BpmnDocument, type BpmnElement, DocumentNamespaces, ZEEBE } from '../../../model/index.js';
import { C8AttributeRules } from './C8AttributeRules.js';
import { C8DefinitionRules } from './C8DefinitionRules.js';
import { C8EventRules } from './C8EventRules.js';
import { C8ExtensionRules } from './C8ExtensionRules.js';
import { C8FlowRules } from './C8FlowRules.js';
import { C8SchemaRules } from './C8SchemaRules.js';
import { C8SubscriptionRules } from './C8SubscriptionRules.js';
import { C8TaskRules } from './C8TaskRules.js';
import { C8TimerRules } from './C8TimerRules.js';
import { C8ZeebeContentRules } from './C8ZeebeContentRules.js';
import type { CamundaRules } from '../rules/CamundaRules.js';
import type { ElementStep } from '../rules/RuleWalk.js';
import { RuleContext } from '../rules/RuleContext.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { RuleWalk } from '../rules/RuleWalk.js';

export class C8Checks extends RuleWalk {
  private readonly attributes: C8AttributeRules;
  private readonly extensions: C8ExtensionRules;
  private readonly flows: C8FlowRules;
  private readonly rules: readonly CamundaRules[];
  private readonly documentRules: readonly CamundaRules[];

  constructor(document: BpmnDocument) {
    super(document);
    const namespaces = new DocumentNamespaces(this.document.tree.definitions);
    const context = new RuleContext(document, namespaces, namespaces.prefixOf(ZEEBE.uri) ?? 'zeebe');
    const tasks = new C8TaskRules(context);
    const definitions = new C8DefinitionRules(context, tasks, new C8TimerRules(context));
    const subscriptions = new C8SubscriptionRules(context);
    this.attributes = new C8AttributeRules(context);
    this.extensions = new C8ExtensionRules(context, new C8ZeebeContentRules(context));
    this.flows = new C8FlowRules(context);
    this.rules = [tasks, new C8EventRules(context, definitions), definitions, subscriptions, this.flows];
    this.documentRules = [subscriptions, new C8SchemaRules(context)];
  }

  protected override checkDocument(reporter: RuleReporter): void {
    const { definitions } = this.document.tree;
    for (const process of this.document.tree.processes()) {
      if (process.peek<boolean>('isExecutable') === true) {
        this.visit(process, undefined, true, reporter);
      }
    }
    for (const message of this.attributes.caughtMessages()) {
      reporter.enter(message, undefined, true);
      this.attributes.check(message, reporter);
      this.extensions.check(message, reporter);
    }
    reporter.enter(definitions, undefined, true);
    for (const rules of this.documentRules) {
      rules.check(definitions, reporter);
    }
  }

  protected override checkElement(element: BpmnElement, reporter: RuleReporter): ElementStep {
    this.attributes.check(element, reporter);
    this.extensions.check(element, reporter);
    if (element.is('bpmn:Transaction')) {
      this.flows.checkTransaction(element, reporter);
      return 'stop';
    }
    for (const rules of this.rules) {
      rules.check(element, reporter);
    }
    return 'descend';
  }
}
