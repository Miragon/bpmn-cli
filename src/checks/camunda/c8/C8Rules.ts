import { type BpmnElement, IdWords, Kinds, ZEEBE } from '../../../model/index.js';
import { CamundaRules } from '../rules/CamundaRules.js';
import { FeelExpression } from '../feel/FeelExpression.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';

export abstract class C8Rules extends CamundaRules {
  private static readonly C8_EQUIVALENT: Record<string, string> = {
  assignee: 'zeebe:assignmentDefinition assignee=<assignee>',
  candidateGroups: 'zeebe:assignmentDefinition candidateGroups=<groups>',
  candidateUsers: 'zeebe:assignmentDefinition candidateUsers=<users>',
  dueDate: 'zeebe:taskSchedule dueDate=<date>',
  followUpDate: 'zeebe:taskSchedule followUpDate=<date>',
  priority: 'zeebe:priorityDefinition priority=<0..100>',
  formKey: 'zeebe:formDefinition formId=<formId>',
  topic: 'zeebe:taskDefinition type=<jobType>',
  type: 'zeebe:taskDefinition type=<jobType>',
  class: 'zeebe:taskDefinition type=<jobType>',
  delegateExpression: 'zeebe:taskDefinition type=<jobType>',
  expression: 'zeebe:taskDefinition type=<jobType>',
  decisionRef: 'zeebe:calledDecision decisionId=<decisionId> resultVariable=<variable>',
  inputOutput: 'zeebe:input source==<expression> target=<variable>',
  versionTag: 'zeebe:versionTag value=<tag>',
};

  protected foreignHint(el: BpmnElement, owner: BpmnElement | undefined, local: string, remove: string): string {
    const equivalent = C8Rules.C8_EQUIVALENT[local];
    return `Remove it: ${remove}${equivalent ? `; Camunda 8 reads ${this.extAdd(el, owner, equivalent.replace(/^zeebe:/, `${this.prefix}:`))}` : ''}.`;
  }

  protected nonInterrupting(el: BpmnElement): boolean {
    if (el.is('bpmn:BoundaryEvent')) {
      return el.peek<boolean>('cancelActivity') === false;
    }
    if (el.is('bpmn:StartEvent')) {
      return el.peek<boolean>('isInterrupting') === false;
    }
    return false;
  }

  protected blank(value: string | undefined): boolean {
    return !this.nonEmpty(value);
  }

  protected missing(value: string | undefined): boolean {
    return value === undefined || value === null || value === '';
  }

  protected isFeel(value: string | undefined): boolean {
    return value !== undefined && value.trim().startsWith('=');
  }

  protected feelOf(juel: string): string {
    const match = /^\s*[$#]\{([\s\S]*)\}\s*$/.exec(juel);
    const inner = (match ? match[1]! : juel).trim();
    const quoted = inner.replace(/'((?:[^'\\]|\\.)*)'/g, (_quote, text: string) => `"${text.replace(/"/g, '\\"')}"`);
    return ` ${quoted.replace(/&&/g, 'and').replace(/\|\|/g, 'or').replace(/==/g, '=').replace(/!\s*\((?!=)/g, 'not(').replace(/!(?!=)\s*([\w.]+)/g, 'not($1)')}`;
  }

  protected describe(el: BpmnElement, owner?: BpmnElement): string {
    const id = el.id;
    const kind = el.isBpmn ? IdWords.lcfirst(Kinds.label(el).replace(/^bpmn:/, '')) : el.type;
    if (id) {
      return `${kind} ${id}`;
    }
    return owner ? `the ${IdWords.lcfirst(IdWords.localName(el.type))} of ${this.describe(owner)}` : kind;
  }

  protected zeebe(el: BpmnElement | undefined, local: string): BpmnElement[] {
    return this.extensionValues(el)
      .filter((extValue) => extValue.uri === ZEEBE.uri && extValue.local === local)
      .map((extValue) => extValue.el);
  }

  protected kids(el: BpmnElement, local?: string): BpmnElement[] {
    return this.genericChildren(el, local, (uri) => uri === ZEEBE.uri);
  }

  protected zeebeName(local: string): string {
    return `${this.prefix}:${local}`;
  }

  protected messageOf(el: BpmnElement): BpmnElement | undefined {
    if (el.is('bpmn:ReceiveTask') || el.is('bpmn:SendTask')) {
      return el.peek<BpmnElement>('messageRef');
    }
    const def = el.list('eventDefinitions').find((definition) => definition.is('bpmn:MessageEventDefinition'));
    return def?.peek<BpmnElement>('messageRef');
  }

  protected extAdd(el: BpmnElement, owner: BpmnElement | undefined, args: string): string {
    const addr = this.addressOf(el, owner);
    if (!addr) {
      return 'edit the XML';
    }
    return `\`bpmn ext add <file> ${addr.id} ${ShellWords.slotted(addr.prefix, args)}\``;
  }

  private replaceCommand(host: BpmnElement, owner: BpmnElement | undefined, zeebeElement: BpmnElement, fix: Record<string, string>): string | undefined {
    if (this.kids(zeebeElement).length) {
      return undefined;
    }
    const attrs: Record<string, string> = {};
    for (const [key, val] of Object.entries(zeebeElement.raw)) {
      if (key.startsWith('$') || key.startsWith('xmlns') || val === undefined || val === null || typeof val === 'object') {
        continue;
      }
      attrs[key] = String(val);
    }
    Object.assign(attrs, fix);
    const args = Object.entries(attrs).map(([key, val]) => ShellWords.quote(`${key}=${val}`));
    return this.extAdd(host, owner, [zeebeElement.type, ...args, '--replace'].join(' '));
  }

  protected fixHint(host: BpmnElement, owner: BpmnElement | undefined, zeebeElement: BpmnElement, fix: Record<string, string>): string {
    const cmd = this.replaceCommand(host, owner, zeebeElement, fix);
    return cmd ? `${cmd}.` : this.rebuildHint(host, owner, zeebeElement.type);
  }

  protected rebuildHint(host: BpmnElement, owner: BpmnElement | undefined, type: string): string {
    const addr = this.addressOf(host, owner);
    if (!addr) {
      return 'Fix it in the XML.';
    }
    return `See it with \`bpmn show <file> ${addr.id}\`, then rebuild it: \`bpmn ext add <file> ${addr.id} ${ShellWords.quote(`${addr.prefix}${type}`)} --replace --xml '<${type} ...>...</${type}>'\`.`;
  }

  protected checkFeel(el: BpmnElement, owner: BpmnElement | undefined, subject: string, what: string, value: string | undefined, fix: string, reporter: RuleReporter): boolean {
    if (!this.isFeel(value)) {
      return false;
    }
    const problem = new FeelExpression(value!.trim().slice(1)).problem();
    if (!problem) {
      return false;
    }
    reporter.deploy({ code: 'W_C8_DEPLOY_EXPRESSION', element: el, owner, subject: `feel:${subject}`, message: `${what} "${value!.trim()}" is no valid FEEL: ${problem}; Camunda 8 parses it at deploy and refuses the file`, hint: fix });
    return true;
  }
}
