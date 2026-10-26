import type { El } from '../../../model/utils/moddle.js';
import { NCNAME, type SchemaTextIssue } from '../SchemaText.js';
import { idOf, isGeneric, list, localName, peek } from '../utils/element.js';
import { sh } from '../utils/hint.js';
import { missing } from './utils/value.js';
import { C8Rules } from './C8Rules.js';

/** What Camunda 8 checks of the file as a whole: an executable process, the BPMN schema, ids. */
export class C8SchemaRules extends C8Rules {
  checkExecutable(processes: El[], executable: El[]): void {
    if (!processes.length || executable.length) return;
    const first = processes[0]!;
    const what = processes.length === 1 ? `Process ${idOf(first)} is not executable` : `None of the ${processes.length} processes is executable`;
    this.push('deploy', 'W_C8_DEPLOY_EXECUTABLE', first, undefined, 'executable', `${what} (no isExecutable="true"); Camunda 8 refuses to deploy a file without an executable process`, `\`bpmn set <file> ${idOf(first)} isExecutable=true\`.`);
  }

  /**
   * Attributes without a namespace prefix that BPMN does not define, and extension elements on
   * bpmn:definitions: Camunda 8 validates the file against the BPMN schema (cvc-complex-type).
   */
  checkSchema(): void {
    if (list(peek<El>(this.doc.definitions, 'extensionElements'), 'values').length) {
      this.push('deploy', 'W_C8_DEPLOY_SCHEMA', this.doc.definitions, undefined, 'definitions', `bpmn:definitions carries bpmn:extensionElements, which the BPMN schema does not allow there; Camunda 8 refuses the file`, `Move the content to the process: \`bpmn ext remove <file> ${idOf(this.doc.definitions) ?? '<definitionsId>'} <type>\`, then \`bpmn ext add <file> <processId> <type> ...\`.`);
    }
    for (const { el, owner, id, di, addr, keys } of this.unprefixedAttributes()) {
      for (const key of keys) {
        const where = el === owner ? this.describe(el) : `${el.$type}${id ? ` in ${id}` : ''}`;
        const link = el === owner && !!id && this.kit.is(el, 'bpmn:BusinessRuleTask') && (key === 'calledDecision' || key === 'calledElement') ? new this.kit.DecisionLinkReader(this.doc).linkOf(el) : undefined;
        const remove = addr ? `\`bpmn set <file> ${addr.id} ${sh(`${addr.prefix}${key}=`)}\`` : undefined;
        const hint = link
          ? `Write the decision link the Camunda 8 way: \`bpmn set <file> ${id} ${sh(`calledDecision=${link.value}`)}\` (${this.zeebeName('calledDecision')}; the unprefixed ${key} is removed; give it a resultVariable).`
          : remove
            ? `Remove it: ${remove} (vendor attributes need their namespace prefix; Camunda 8 settings are mostly ${this.prefix}: extension elements).`
            : di
              ? `Remove ${key}="..." from the XML of ${id ?? 'the diagram element'}, or redraw the diagram: \`bpmn layout <file>\` (the hand-made layout is lost).`
              : `Remove ${key}="..." from the XML${id ? ` of ${id}` : ''}.`;
        this.push('deploy', 'W_C8_DEPLOY_SCHEMA', el, owner, `schema:${key}`, `${where} has the attribute ${key}, which the BPMN schema does not define; Camunda 8 validates the file against the schema and refuses it`, hint);
      }
    }
  }

  /**
   * An id the BPMN schema does not allow: bpmn-moddle reads `prefix:name` ids, Camunda 8 refuses
   * them (cvc-datatype-valid).
   */
  checkIds(): void {
    for (const el of this.kit.walk(this.doc.definitions)) {
      if (isGeneric(el)) continue;
      const id = peek<string>(el, 'id');
      if (typeof id !== 'string' || !id || NCNAME.test(id.trim())) continue;
      const di = this.kit.isDiElement(el);
      const fixed = id.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^(?=[^A-Za-z_])/, '_');
      this.push('deploy', 'W_C8_DEPLOY_SCHEMA', el, undefined, `id:${id}`, `${di ? el.$type : this.describe(el)} has the id "${id}", which is no XML NCName (${id.includes(':') ? 'a colon is not allowed in an id' : 'letters, digits, _ . - and no leading digit'}); Camunda 8 validates the file against the BPMN schema and refuses it`, di ? `Rename it in the XML (or redraw the diagram: \`bpmn layout <file>\`).` : `\`bpmn set <file> ${sh(id)} id=${fixed}\`.`);
    }
  }

  /**
   * Child element order and IDREFs that name no id, read from the file's text (SchemaText): the
   * model shows neither, Camunda 8 refuses both. An issue of an element an edit removed is gone.
   */
  checkSchemaText(issues: SchemaTextIssue[]): void {
    for (const issue of issues) {
      if (issue.kind === 'id') {
        // checkIds reports the elements bpmn-moddle read; this one it could not read
        if (this.doc.get(issue.value!)) continue;
        this.push('deploy', 'W_C8_DEPLOY_SCHEMA', this.doc.definitions, undefined, `id:${issue.value}`, `<bpmn:${issue.element}> has the id "${issue.value}", which is no XML NCName (${issue.value!.includes(':') ? 'a colon is not allowed in an id' : 'letters, digits, _ . - and no leading digit'}); bpmn-moddle cannot read the element (an import warning) and Camunda 8 validates the file against the BPMN schema and refuses it`, `Rename it in the XML (and every reference to it), e.g. to ${issue.value!.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^(?=[^A-Za-z_])/, '_')}.`);
        continue;
      }
      const owner = issue.owner !== undefined ? this.doc.get(issue.owner) : undefined;
      if (issue.owner !== undefined && !owner) continue;
      const where = owner ? this.describe(owner) : `<${issue.element}>`;
      if (issue.kind === 'boolean') {
        const what = owner && issue.element !== localName(owner.$type).replace(/^./, (firstLetter) => firstLetter.toLowerCase()) ? `<${issue.element.startsWith('BPMN') ? 'bpmndi' : 'bpmn'}:${issue.element}> of ${where}` : where;
        this.push('deploy', 'W_C8_DEPLOY_SCHEMA', owner ?? this.doc.definitions, undefined, `boolean:${issue.element}:${issue.ref}`, `${what[0]!.toUpperCase()}${what.slice(1)} has ${issue.ref}="${issue.value}", which is no xsd:boolean (true or false; bpmn-moddle reads it as false); Camunda 8 validates the file against the BPMN schema and refuses it`, `Write ${issue.ref}="true" or ${issue.ref}="false" in the XML of ${owner ? idOf(owner) : `<${issue.element}>`}.`);
        continue;
      }
      if (issue.kind === 'order') {
        const what = owner && issue.element !== localName(owner.$type).replace(/^./, (firstLetter) => firstLetter.toLowerCase()) ? `<bpmn:${issue.element}> of ${where}` : where;
        this.push('deploy', 'W_C8_DEPLOY_SCHEMA', owner ?? this.doc.definitions, undefined, `order:${issue.element}/${issue.child}`, `In ${what}, <bpmn:${issue.child}> comes after <bpmn:${issue.before}>; the BPMN schema puts ${issue.child} before ${issue.before}, and Camunda 8 validates the file against the schema and refuses it`, `Move <bpmn:${issue.child}> before <bpmn:${issue.before}> in the XML of ${owner ? idOf(owner) : `<${issue.element}>`} (Camunda Modeler and \`bpmn\` write that order for the elements they create or change).`);
      } else {
        const ref = issue.attribute ? `${issue.ref}="${issue.value}"` : `<bpmn:${issue.ref}>${issue.value}</bpmn:${issue.ref}>`;
        this.push('deploy', 'W_C8_DEPLOY_SCHEMA', owner ?? this.doc.definitions, undefined, `idref:${issue.ref}:${issue.value}`, `${where[0]!.toUpperCase()}${where.slice(1)} has ${ref}, but the file has no element with the id ${issue.value}; Camunda 8 checks such references against the ids of the file (cvc-id.1) and refuses it`, `Remove ${ref} from ${issue.owner ?? `<bpmn:${issue.element}>`} in the XML, or point it at an element of the file (bpmn-moddle drops the reference when it reads the file: \`bpmn\` refuses to write the file without --force, and a forced write leaves it out).`);
      }
    }
  }

  /** Every event definition of the file: a conditional one needs a condition, a link one a name. */
  checkSchemaEventDefinitions(): void {
    for (const def of this.kit.walk(this.doc.definitions, { bpmnOnly: true })) {
      if (!this.kit.is(def, 'bpmn:EventDefinition')) continue;
      const event = def.$parent as El | undefined;
      const id = idOf(event);
      const label = id ? this.describe(event!) : def.$type;
      if (this.kit.is(def, 'bpmn:ConditionalEventDefinition') && !peek<El>(def, 'condition')) {
        this.push('deploy', 'W_C8_DEPLOY_EVENT_DEFINITION', event ?? def, undefined, 'schema:condition', `The conditional event definition of ${label} has no condition element, which the BPMN schema requires; Camunda 8 refuses the file`, id ? `\`bpmn set <file> ${id} ${sh('when== <expression>')}\`.` : 'Fix it in the XML.');
      } else if (this.kit.is(def, 'bpmn:LinkEventDefinition') && missing(peek<string>(def, 'name'))) {
        // no name: the schema refuses it; an empty one: Camunda 8 ("must be present and not empty")
        const none = peek<string>(def, 'name') === undefined || peek<string>(def, 'name') === null;
        this.push('deploy', 'W_C8_DEPLOY_LINK', event ?? def, undefined, 'schema:linkName', `The link event definition of ${label} has ${none ? 'no name, which the BPMN schema requires' : 'an empty name'}; Camunda 8 refuses the file`, id ? `\`bpmn set <file> ${id} link=<Name>\` (the throw and the catch event of a pair share the name).` : 'Fix it in the XML.');
      }
    }
  }
}
