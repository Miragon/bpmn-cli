import type { El } from '../../model/utils/moddle.js';
import { C7DescriptorNames } from './c7/C7DescriptorNames.js';
import { C7EventRules } from './c7/C7EventRules.js';
import { C7ExtensionContentRules } from './c7/C7ExtensionContentRules.js';
import { C7ExtensionRules } from './c7/C7ExtensionRules.js';
import { C7FlowRules } from './c7/C7FlowRules.js';
import { C7ImplementationRules } from './c7/C7ImplementationRules.js';
import { SERVICE_LIKE } from './c7/C7Rules.js';
import { C7SchemaRules } from './c7/C7SchemaRules.js';
import { EngineProfile, type ElementWalk } from './EngineProfile.js';
import type { RuleRun } from './RuleRun.js';
import { list, peek } from './utils/element.js';

/**
 * The Camunda 7 profile, also for CIB seven and Operaton: what the engines refuse on deploy,
 * ignore or fail on at run time (checked against 7.24, CIB seven 2.2, Operaton 2.1.5), over
 * executable processes, file-level content and the schema of the whole file.
 */
export class C7Profile extends EngineProfile {
  private readonly names = new C7DescriptorNames(this.kit);
  private extensions!: C7ExtensionRules;
  private implementation!: C7ImplementationRules;
  private events!: C7EventRules;
  private flows!: C7FlowRules;

  /** `operaton`: read the file like Operaton does (detected from the namespace when omitted). */
  protected override checkDocument(run: RuleRun, opts: { operaton?: boolean }): void {
    const { doc, ns } = run;
    const operaton = opts.operaton ?? (ns.usage().get(this.kit.OPERATON_URI) ?? 0) > 0;
    const prefix = (operaton ? ns.prefixOf(this.kit.OPERATON_URI) : undefined) ?? ns.prefixOf(this.kit.camunda.uri) ?? ns.prefixOf(this.kit.OPERATON_URI) ?? 'camunda';
    this.implementation = new C7ImplementationRules(run, prefix);
    this.extensions = new C7ExtensionRules(run, prefix, this.names, new C7ExtensionContentRules(run, prefix, this.implementation));
    this.events = new C7EventRules(run, prefix, this.implementation);
    this.flows = new C7FlowRules(run, prefix, operaton, this.implementation);
    const defs = doc.definitions;
    this.extensions.checkAttributes(defs, undefined);
    this.extensions.checkExtensions(defs, undefined, true);
    const executable = doc.processes().filter((proc) => peek<boolean>(proc, 'isExecutable') === true);
    for (const root of list(defs, 'rootElements')) {
      if (this.kit.is(root, 'bpmn:Process')) {
        if (executable.includes(root)) this.visit(root, undefined, true);
        continue;
      }
      this.visit(root, undefined, false);
    }
    if (executable.length) this.events.checkSignalNames();
    const schema = new C7SchemaRules(run, prefix);
    schema.checkSchemaEventDefinitions();
    schema.checkSchemaAttributes();
  }

  protected override checkElement(el: El, owner: El | undefined, executable: boolean): ElementWalk {
    const is = this.kit.is;
    if (executable && is(el, 'bpmn:AdHocSubProcess')) {
      // the engines skip an ad-hoc sub-process with its content, like a non-executable process
      this.flows.checkAdHoc(el);
      return 'stop';
    }
    this.extensions.checkAttributes(el, owner);
    this.extensions.checkExtensions(el, owner, executable);
    this.extensions.checkVendorRefs(el, owner);
    if (!executable) return 'descend';
    const implementation = this.implementation;
    if (is(el, 'bpmn:Process')) implementation.checkProcess(el);
    if (SERVICE_LIKE.some((type) => is(el, type))) implementation.checkServiceLike(el);
    if (is(el, 'bpmn:BusinessRuleTask')) implementation.checkBusinessRule(el);
    if (is(el, 'bpmn:CallActivity')) implementation.checkCallActivity(el);
    if (is(el, 'bpmn:UserTask') || is(el, 'bpmn:StartEvent')) implementation.checkForms(el);
    if (is(el, 'bpmn:UserTask')) implementation.checkUserTaskPriority(el);
    if (is(el, 'bpmn:Activity')) implementation.checkMultiInstance(el);
    if (is(el, 'bpmn:Event')) this.events.checkEvent(el);
    if (is(el, 'bpmn:EventBasedGateway')) this.flows.checkEventGateway(el);
    if (is(el, 'bpmn:ComplexGateway')) this.flows.checkComplexGateway(el);
    if (is(el, 'bpmn:ExclusiveGateway')) this.flows.checkExclusiveGateway(el);
    if (is(el, 'bpmn:ScriptTask')) implementation.checkScriptTask(el);
    if (is(el, 'bpmn:ReceiveTask')) this.events.checkReceiveTask(el);
    if (is(el, 'bpmn:SequenceFlow')) this.flows.checkFlowCondition(el);
    if ((is(el, 'bpmn:Activity') || is(el, 'bpmn:Gateway') || is(el, 'bpmn:Event') || is(el, 'bpmn:MultiInstanceLoopCharacteristics')) && !is(el, 'bpmn:Process')) implementation.checkPriorities(el, owner, ['jobPriority']);
    if (is(el, 'bpmn:Process') || is(el, 'bpmn:SubProcess')) this.events.checkStartEvents(el);
    if (is(el, 'bpmn:Process')) {
      this.events.checkSubscriptions(el);
      this.events.checkLinks(el);
    }
    return 'descend';
  }
}
