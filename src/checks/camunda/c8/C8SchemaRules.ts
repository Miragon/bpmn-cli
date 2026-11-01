import { type BpmnElement, IdWords } from '../../../model/index.js';
import { C8Rules } from './C8Rules.js';
import type { UnprefixedAttributes } from '../rules/CamundaRules.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { SchemaText, type SchemaTextIssue } from '../values/SchemaText.js';
import { ShellWords } from '../rules/ShellWords.js';

export class C8SchemaRules extends C8Rules {
  check(element: BpmnElement, reporter: RuleReporter): void {
    if (element.is('bpmn:Definitions')) {
      this.checkExecutable(reporter);
      this.eventDefinitions().forEach((def) => this.checkSchemaEventDefinition(def, reporter));
      this.checkSchema(reporter);
      this.checkIds(reporter);
      this.checkSchemaText(reporter);
    }
  }

  private checkExecutable(reporter: RuleReporter): void {
    const processes = this.document.tree.processes();
    const executable = processes.filter((process) => process.peek<boolean>('isExecutable') === true);
    if (!processes.length || executable.length) {
      return;
    }
    const first = processes[0]!;
    const what = processes.length === 1 ? `Process ${first.id} is not executable` : `None of the ${processes.length} processes is executable`;
    reporter.deploy({ code: 'W_C8_DEPLOY_EXECUTABLE', element: first, subject: 'executable', message: `${what} (no isExecutable="true"); Camunda 8 refuses to deploy a file without an executable process`, hint: `\`bpmn set <file> ${first.id} isExecutable=true\`.`, fix: { op: 'set', id: first.id, set: { isExecutable: true } } });
  }

  private checkSchema(reporter: RuleReporter): void {
    if ((this.document.tree.definitions.peek<BpmnElement>('extensionElements')?.list('values') ?? []).length) {
      reporter.deploy({ code: 'W_C8_DEPLOY_SCHEMA', element: this.document.tree.definitions, subject: 'definitions', message: `bpmn:definitions carries bpmn:extensionElements, which the BPMN schema does not allow there; Camunda 8 refuses the file`, hint: `Move the content to the process: \`bpmn ext remove <file> ${this.document.tree.definitions.id ?? '<definitionsId>'} <type>\`, then \`bpmn ext add <file> <processId> <type> ...\`.` });
    }
    this.forEachUnprefixedAttribute((attributes, key) => this.checkSchemaAttribute(attributes, key, reporter));
  }

  private checkSchemaAttribute(attributes: UnprefixedAttributes, key: string, reporter: RuleReporter): void {
    const { el, owner, id } = attributes;
    const where = el === owner ? this.describe(el) : `${el.type}${id ? ` in ${id}` : ''}`;
    reporter.deploy({ code: 'W_C8_DEPLOY_SCHEMA', element: el, owner, subject: `schema:${key}`, message: `${where} has the attribute ${key}, which the BPMN schema does not define; Camunda 8 validates the file against the schema and refuses it`, hint: this.schemaHint(attributes, key) });
  }

  private schemaHint(attributes: UnprefixedAttributes, key: string): string {
    const { id, di, addr } = attributes;
    const link = this.decisionLinkOf(attributes, key);
    if (link) {
      return `Write the decision link the Camunda 8 way: \`bpmn set <file> ${id} ${ShellWords.quote(`calledDecision=${link.value}`)}\` (${this.zeebeName('calledDecision')}; the unprefixed ${key} is removed; give it a resultVariable).`;
    }
    if (addr) {
      return `Remove it: \`bpmn set <file> ${addr.slot(`${key}=`)}\` (vendor attributes need their namespace prefix; Camunda 8 settings are mostly ${this.prefix}: extension elements).`;
    }
    if (di) {
      return `Remove ${key}="..." from the XML of ${id ?? 'the diagram element'}, or redraw the diagram: \`bpmn layout <file>\` (the hand-made layout is lost).`;
    }
    return `Remove ${key}="..." from the XML${id ? ` of ${id}` : ''}.`;
  }

  private checkIds(reporter: RuleReporter): void {
    for (const el of this.document.tree.walk(this.document.tree.definitions)) {
      if (el.isGeneric) {
        continue;
      }
      const id = el.peek<string>('id');
      if (typeof id !== 'string' || !id || SchemaText.NCNAME.test(id.trim())) {
        continue;
      }
      const di = el.isDi;
      const fixed = id.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^(?=[^A-Za-z_])/, '_');
      reporter.deploy({ code: 'W_C8_DEPLOY_SCHEMA', element: el, subject: `id:${id}`, message: `${di ? el.type : this.describe(el)} has the id "${id}", which is no XML NCName (${id.includes(':') ? 'a colon is not allowed in an id' : 'letters, digits, _ . - and no leading digit'}); Camunda 8 validates the file against the BPMN schema and refuses it`, hint: di ? `Rename it in the XML (or redraw the diagram: \`bpmn layout <file>\`).` : `\`bpmn set <file> ${ShellWords.quote(id)} id=${fixed}\`.` });
    }
  }

  private checkSchemaText(reporter: RuleReporter): void {
    const { source, tree } = this.document;
    for (const issue of source ? new SchemaText().issues(source.text, tree.moddle) : []) {
      this.checkTextIssue(issue, reporter);
    }
  }

  private checkTextIssue(issue: SchemaTextIssue, reporter: RuleReporter): void {
    if (issue.kind === 'id') {
      this.checkUnreadableId(issue, reporter);
      return;
    }
    const owner = issue.owner !== undefined ? this.document.tree.byId(issue.owner) : undefined;
    if (issue.owner !== undefined && !owner) {
      return;
    }
    const where = owner ? this.describe(owner) : `<${issue.element}>`;
    if (issue.kind === 'boolean') {
      this.reportBooleanIssue(issue, owner, where, reporter);
    } else if (issue.kind === 'order') {
      this.reportOrderIssue(issue, owner, where, reporter);
    } else {
      this.reportIdrefIssue(issue, owner, where, reporter);
    }
  }

  private checkUnreadableId(issue: SchemaTextIssue, reporter: RuleReporter): void {
    if (!this.document.tree.byId(issue.value!)) {
      reporter.deploy({ code: 'W_C8_DEPLOY_SCHEMA', element: this.document.tree.definitions, subject: `id:${issue.value}`, message: `<bpmn:${issue.element}> has the id "${issue.value}", which is no XML NCName (${issue.value!.includes(':') ? 'a colon is not allowed in an id' : 'letters, digits, _ . - and no leading digit'}); bpmn-moddle cannot read the element (an import warning) and Camunda 8 validates the file against the BPMN schema and refuses it`, hint: `Rename it in the XML (and every reference to it), e.g. to ${issue.value!.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^(?=[^A-Za-z_])/, '_')}.` });
    }
  }

  private static inOwner(issue: SchemaTextIssue, owner: BpmnElement | undefined, where: string, prefix: string): string {
    return owner && issue.element !== IdWords.localName(owner.type).replace(/^./, (firstLetter) => firstLetter.toLowerCase()) ? `<${prefix}:${issue.element}> of ${where}` : where;
  }

  private reportBooleanIssue(issue: SchemaTextIssue, owner: BpmnElement | undefined, where: string, reporter: RuleReporter): void {
    const what = C8SchemaRules.inOwner(issue, owner, where, issue.element.startsWith('BPMN') ? 'bpmndi' : 'bpmn');
    reporter.deploy({ code: 'W_C8_DEPLOY_SCHEMA', element: owner ?? this.document.tree.definitions, subject: `boolean:${issue.element}:${issue.ref}`, message: `${what[0]!.toUpperCase()}${what.slice(1)} has ${issue.ref}="${issue.value}", which is no xsd:boolean (true or false; bpmn-moddle reads it as false); Camunda 8 validates the file against the BPMN schema and refuses it`, hint: `Write ${issue.ref}="true" or ${issue.ref}="false" in the XML of ${owner ? owner.id : `<${issue.element}>`}.` });
  }

  private reportOrderIssue(issue: SchemaTextIssue, owner: BpmnElement | undefined, where: string, reporter: RuleReporter): void {
    const what = C8SchemaRules.inOwner(issue, owner, where, 'bpmn');
    reporter.deploy({ code: 'W_C8_DEPLOY_SCHEMA', element: owner ?? this.document.tree.definitions, subject: `order:${issue.element}/${issue.child}`, message: `In ${what}, <bpmn:${issue.child}> comes after <bpmn:${issue.before}>; the BPMN schema puts ${issue.child} before ${issue.before}, and Camunda 8 validates the file against the schema and refuses it`, hint: `Move <bpmn:${issue.child}> before <bpmn:${issue.before}> in the XML of ${owner ? owner.id : `<${issue.element}>`} (Camunda Modeler and \`bpmn\` write that order for the elements they create or change).` });
  }

  private reportIdrefIssue(issue: SchemaTextIssue, owner: BpmnElement | undefined, where: string, reporter: RuleReporter): void {
    const ref = issue.attribute ? `${issue.ref}="${issue.value}"` : `<bpmn:${issue.ref}>${issue.value}</bpmn:${issue.ref}>`;
    reporter.deploy({ code: 'W_C8_DEPLOY_SCHEMA', element: owner ?? this.document.tree.definitions, subject: `idref:${issue.ref}:${issue.value}`, message: `${where[0]!.toUpperCase()}${where.slice(1)} has ${ref}, but the file has no element with the id ${issue.value}; Camunda 8 checks such references against the ids of the file (cvc-id.1) and refuses it`, hint: `Remove ${ref} from ${issue.owner ?? `<bpmn:${issue.element}>`} in the XML, or point it at an element of the file (bpmn-moddle drops the reference when it reads the file: \`bpmn\` refuses to write the file without --force, and a forced write leaves it out).` });
  }

  private checkSchemaEventDefinition(def: BpmnElement, reporter: RuleReporter): void {
    const event = def.parent;
    const id = event?.id;
    const label = id ? this.describe(event!) : def.type;
    if (def.is('bpmn:ConditionalEventDefinition') && !def.peek<BpmnElement>('condition')) {
      reporter.deploy({ code: 'W_C8_DEPLOY_EVENT_DEFINITION', element: event ?? def, subject: 'schema:condition', message: `The conditional event definition of ${label} has no condition element, which the BPMN schema requires; Camunda 8 refuses the file`, hint: id ? `\`bpmn set <file> ${id} ${ShellWords.quote('when== <expression>')}\`.` : 'Fix it in the XML.' });
    } else if (def.is('bpmn:LinkEventDefinition') && this.missing(def.peek<string>('name'))) {
      const none = def.peek<string>('name') === undefined || def.peek<string>('name') === null;
      reporter.deploy({ code: 'W_C8_DEPLOY_LINK', element: event ?? def, subject: 'schema:linkName', message: `The link event definition of ${label} has ${none ? 'no name, which the BPMN schema requires' : 'an empty name'}; Camunda 8 refuses the file`, hint: id ? `\`bpmn set <file> ${id} link=<Name>\` (the throw and the catch event of a pair share the name).` : 'Fix it in the XML.' });
    }
  }
}
