import type { Doc } from '../../model/Doc.js';
import type { El } from '../../model/utils/moddle.js';
import { C8EventRules } from './c8/C8EventRules.js';
import { C8ExtensionRules } from './c8/C8ExtensionRules.js';
import { C8FlowRules } from './c8/C8FlowRules.js';
import { C8SchemaRules } from './c8/C8SchemaRules.js';
import { C8TaskRules } from './c8/C8TaskRules.js';
import { EngineProfile, type ElementWalk } from './EngineProfile.js';
import type { RuleRun } from './RuleRun.js';
import { SchemaText, type SchemaTextIssue } from './SchemaText.js';
import { peek } from './utils/element.js';

/**
 * The Camunda 8 (Zeebe) profile: what Camunda 8.9 refuses on deploy, ignores or fails on at run
 * time, and zeebe content it does not know. It covers executable processes (ad-hoc content
 * included), the root elements they use, and the schema of the whole file.
 */
export class C8Profile extends EngineProfile {
  private readonly textIssues = new WeakMap<object, SchemaTextIssue[]>();
  private readonly schemaText = new SchemaText(this.kit);
  private extensions!: C8ExtensionRules;
  private tasks!: C8TaskRules;
  private events!: C8EventRules;
  private flows!: C8FlowRules;

  protected override checkDocument(run: RuleRun): void {
    const { doc } = run;
    const prefix = run.ns.prefixOf(this.kit.zeebe.uri) ?? 'zeebe';
    this.extensions = new C8ExtensionRules(run, prefix);
    this.tasks = new C8TaskRules(run, prefix);
    this.events = new C8EventRules(run, prefix, this.tasks);
    this.flows = new C8FlowRules(run, prefix);
    const schema = new C8SchemaRules(run, prefix);
    const processes = doc.processes();
    const executable = processes.filter((proc) => peek<boolean>(proc, 'isExecutable') === true);
    schema.checkExecutable(processes, executable);
    // the root elements the processes use are checked through their events
    for (const proc of executable) this.visit(proc, undefined, true);
    this.extensions.checkCaughtMessages(executable);
    schema.checkSchemaEventDefinitions();
    this.events.checkFeelNames();
    schema.checkSchema();
    schema.checkIds();
    if (doc.source) schema.checkSchemaText(this.schemaTextIssues(doc, doc.source));
  }

  /** Read once per text: the profile runs before and after an edit. */
  private schemaTextIssues(doc: Doc, source: NonNullable<Doc['source']>): SchemaTextIssue[] {
    let issues = this.textIssues.get(source);
    if (!issues) {
      issues = this.schemaText.issues(source.text, doc.moddle);
      this.textIssues.set(source, issues);
    }
    return issues;
  }

  protected override checkElement(el: El, owner: El | undefined): ElementWalk {
    const is = this.kit.is;
    this.extensions.checkAttributes(el, owner);
    this.extensions.checkExtensions(el, owner);
    if (is(el, 'bpmn:Transaction')) {
      this.flows.checkTransaction(el);
      return 'stop';
    }
    if (is(el, 'bpmn:ComplexGateway')) this.flows.checkComplexGateway(el);
    if (is(el, 'bpmn:Process') || (is(el, 'bpmn:SubProcess') && !is(el, 'bpmn:AdHocSubProcess'))) this.events.checkStartEvents(el);
    if (is(el, 'bpmn:Process') || is(el, 'bpmn:SubProcess')) this.events.checkSubscriptionScopes(el);
    if (is(el, 'bpmn:Process')) this.events.checkLinks(el);
    if (is(el, 'bpmn:AdHocSubProcess')) this.flows.checkAdHoc(el);
    if (is(el, 'bpmn:ServiceTask') || is(el, 'bpmn:SendTask') || is(el, 'bpmn:ScriptTask') || is(el, 'bpmn:BusinessRuleTask')) this.tasks.checkServiceLike(el);
    if (is(el, 'bpmn:ReceiveTask')) this.events.checkMessageCatch(el);
    if (is(el, 'bpmn:CallActivity')) this.tasks.checkCallActivity(el);
    if (is(el, 'bpmn:UserTask')) this.tasks.checkUserTask(el);
    if (is(el, 'bpmn:Activity')) this.tasks.checkMultiInstance(el);
    if (is(el, 'bpmn:Event')) this.events.checkEvent(el);
    if (is(el, 'bpmn:BoundaryEvent')) this.events.checkBoundaryHost(el);
    if (is(el, 'bpmn:ExclusiveGateway') || is(el, 'bpmn:InclusiveGateway')) this.flows.checkBranchingGateway(el);
    if (is(el, 'bpmn:EventBasedGateway')) this.flows.checkEventGateway(el);
    if (is(el, 'bpmn:SequenceFlow')) this.flows.checkFlow(el);
    return 'descend';
  }
}
