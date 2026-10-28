import type { Doc } from '../../../../domain/document/Doc.js';
import type { ProfileFinding } from '../../../../domain/document/Finding.js';


import type { El } from '../../../../domain/document/utils/moddle.js';
import type { SchemaTextIssue } from './SchemaText.js';

const SCHEMA = 'W_C8_DEPLOY_SCHEMA';
import type { EngineKit } from '../engine-kit.js';

/**
 * The Camunda 8 schema findings only the file's text shows: child order, IDREFs that name no id,
 * bad xsd:booleans and ids bpmn-moddle could not read. A bpmnlint rule sees the model only, so
 * bpmn-cli reports them itself. An issue of an element an edit removed is gone.
 */
export class SchemaTextFindings {
  constructor(
    private readonly kit: EngineKit,
    private readonly doc: Doc,
  ) {}

  findings(issues: SchemaTextIssue[]): ProfileFinding[] {
    const out: ProfileFinding[] = [];
    for (const issue of issues) {
      if (issue.kind === 'id') {
        if (this.doc.get(issue.value!)) continue;
        out.push(this.unreadableId(issue));
        continue;
      }
      const owner = issue.owner !== undefined ? this.doc.get(issue.owner) : undefined;
      if (issue.owner !== undefined && !owner) continue;
      if (issue.kind === 'boolean') out.push(this.badBoolean(issue, owner));
      else if (issue.kind === 'order') out.push(this.badOrder(issue, owner));
      else out.push(this.danglingIdref(issue, owner));
    }
    return out;
  }

  private unreadableId(issue: SchemaTextIssue): ProfileFinding {
    const value = issue.value!;
    const reason = value.includes(':') ? 'a colon is not allowed in an id' : 'letters, digits, _ . - and no leading digit';
    return this.finding(undefined, `id:${value}`, `<bpmn:${issue.element}> has the id "${value}", which is no XML NCName (${reason}); bpmn-moddle cannot read the element (an import warning) and Camunda 8 validates the file against the BPMN schema and refuses it`, `Rename it in the XML (and every reference to it), e.g. to ${value.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^(?=[^A-Za-z_])/, '_')}.`);
  }

  private badBoolean(issue: SchemaTextIssue, owner: El | undefined): ProfileFinding {
    const what = this.nestedLabel(issue, owner, issue.element.startsWith('BPMN') ? 'bpmndi' : 'bpmn');
    return this.finding(owner, `boolean:${issue.element}:${issue.ref}`, `${this.capitalised(what)} has ${issue.ref}="${issue.value}", which is no xsd:boolean (true or false; bpmn-moddle reads it as false); Camunda 8 validates the file against the BPMN schema and refuses it`, `Write ${issue.ref}="true" or ${issue.ref}="false" in the XML of ${owner ? owner.id : `<${issue.element}>`}.`);
  }

  private badOrder(issue: SchemaTextIssue, owner: El | undefined): ProfileFinding {
    const what = this.nestedLabel(issue, owner, 'bpmn');
    return this.finding(owner, `order:${issue.element}/${issue.child}`, `In ${what}, <bpmn:${issue.child}> comes after <bpmn:${issue.before}>; the BPMN schema puts ${issue.child} before ${issue.before}, and Camunda 8 validates the file against the schema and refuses it`, `Move <bpmn:${issue.child}> before <bpmn:${issue.before}> in the XML of ${owner ? owner.id : `<${issue.element}>`} (Camunda Modeler and \`bpmn\` write that order for the elements they create or change).`);
  }

  private danglingIdref(issue: SchemaTextIssue, owner: El | undefined): ProfileFinding {
    const where = owner ? this.describe(owner) : `<${issue.element}>`;
    const ref = issue.attribute ? `${issue.ref}="${issue.value}"` : `<bpmn:${issue.ref}>${issue.value}</bpmn:${issue.ref}>`;
    return this.finding(owner, `idref:${issue.ref}:${issue.value}`, `${this.capitalised(where)} has ${ref}, but the file has no element with the id ${issue.value}; Camunda 8 checks such references against the ids of the file (cvc-id.1) and refuses it`, `Remove ${ref} from ${issue.owner ?? `<bpmn:${issue.element}>`} in the XML, or point it at an element of the file (bpmn-moddle drops the reference when it reads the file: \`bpmn\` refuses to write the file without --force, and a forced write leaves it out).`);
  }

  /** The issue's element, as the child of its owner when it is not the owner itself. */
  private nestedLabel(issue: SchemaTextIssue, owner: El | undefined, prefix: string): string {
    const where = owner ? this.describe(owner) : `<${issue.element}>`;
    const ownElement = owner && issue.element === this.lowerFirst(owner.$type.replace(/^[^:]*:/, ''));
    return owner && !ownElement ? `<${prefix}:${issue.element}> of ${where}` : where;
  }

  /** `userTask Activity_X`, as the engine findings name an element. */
  private describe(el: El): string {
    const kind = this.kit.isBpmnElement(el) ? this.lowerFirst(this.kit.kindLabel(el).replace(/^bpmn:/, '')) : el.$type;
    return `${kind} ${el.id}`;
  }

  private finding(owner: El | undefined, subject: string, message: string, hint: string): ProfileFinding {
    return this.kit.makeFinding('deploy', SCHEMA, message, owner?.id ?? this.doc.definitions.id, { hint, subject });
  }

  private capitalised(text: string): string {
    return `${text[0]!.toUpperCase()}${text.slice(1)}`;
  }

  private lowerFirst(text: string): string {
    return text.charAt(0).toLowerCase() + text.slice(1);
  }
}
