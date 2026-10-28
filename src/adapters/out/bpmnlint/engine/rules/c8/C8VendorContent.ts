import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement, type ReportData } from '../CamundaRules.js';

import { ElementKinds } from '../ElementKinds.js';
import { C7_URIS, DiagramNamespaces } from '../DiagramNamespaces.js';
import { DidYouMean } from '../DidYouMean.js';
import { RuleKit } from '../RuleKit.js';
import { Shell } from '../Shell.js';
import type { VendorHost } from '../VendorHost.js';
import { C8Host } from './C8Host.js';
import { ZeebeHint } from './ZeebeHint.js';

/** The zeebe content Camunda 8 reads in place of a Camunda 7 attribute or element, as `bpmn ext add` takes it. */
const CAMUNDA_8_EQUIVALENT: Record<string, string> = {
  assignee: 'assignmentDefinition assignee=<assignee>',
  candidateGroups: 'assignmentDefinition candidateGroups=<groups>',
  candidateUsers: 'assignmentDefinition candidateUsers=<users>',
  dueDate: 'taskSchedule dueDate=<date>',
  followUpDate: 'taskSchedule followUpDate=<date>',
  priority: 'priorityDefinition priority=<0..100>',
  formKey: 'formDefinition formId=<formId>',
  topic: 'taskDefinition type=<jobType>',
  type: 'taskDefinition type=<jobType>',
  class: 'taskDefinition type=<jobType>',
  delegateExpression: 'taskDefinition type=<jobType>',
  expression: 'taskDefinition type=<jobType>',
  decisionRef: 'calledDecision decisionId=<decisionId> resultVariable=<variable>',
  inputOutput: 'input source==<expression> target=<variable>',
  versionTag: 'versionTag value=<tag>',
};

/** Where Camunda 8 ignores input mappings: on events of a type, some only without an event definition. */
const INPUTS_IGNORED: Array<[type: string, noneOnly: boolean, where: string]> = [
  ['bpmn:StartEvent', false, 'start events'],
  ['bpmn:BoundaryEvent', false, 'boundary events'],
  ['bpmn:IntermediateThrowEvent', true, 'none intermediate throw events'],
  ['bpmn:EndEvent', true, 'none end events'],
];

/** Zeebe elements Camunda 8 accepts but does not execute: no home for an attribute. */
const NOT_EXECUTED = ['zeebe:publishMessage'];

/**
 * Vendor content Camunda 8 does not read: Camunda 7 settings, and unknown or misplaced zeebe
 * settings.
 * Camunda 8 deploys the file and silently ignores the setting, so the process runs without the
 * behaviour the model seems to configure.
 *
 * - `c8-foreign-content`: camunda and operaton attributes and extension elements.
 * - `c8-unknown-attribute`: a zeebe attribute that does not exist, on a BPMN element or a zeebe
 *   extension element.
 * - `c8-misplaced-attribute`: a zeebe attribute on a BPMN element that does not carry it.
 * - `c8-misplaced-extension`: a zeebe extension element on an element that does not read it, or
 *   outside its container; input mappings on a start, boundary, none intermediate throw or none end
 *   event.
 *
 * @example a Camunda 7 assignee in a Camunda 8 model
 * <bpmn:userTask id="Review" camunda:assignee="demo" />  <!-- Camunda 8 reads zeebe:assignmentDefinition -->
 */
class C8VendorContent extends C8Rule {

  protected visit(node: ModdleElement): void {
    const host = C8Host.of(node);
    if (!host) return;
    this.checkForeignContent(host);
    this.checkUnknownAttributes(host);
    this.checkUnknownTreeAttributes(host);
    this.checkMisplacedAttributes(host);
    this.checkMisplacedExtensions(host);
  }

  private checkForeignContent(host: C8Host): void {
    const hint = host.hint();
    for (const { key, uri } of host.foreignAttributes()) if (C7_URIS.includes(uri ?? '')) this.reportContent(host, 'c8-foreign-content', `${host.describe()} carries the Camunda 7 attribute ${key}, which Camunda 8 ignores`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: key, path: host.path(key), hint: this.removeHint(hint, key, hint ? hint.unset(key) : 'edit the XML') });
    const namespaces = DiagramNamespaces.forElement(host.node);
    host.extensionValues().forEach((value, index) => {
      const type = String(value.$type ?? '');
      if (value.$descriptor?.isGeneric && C7_URIS.includes(namespaces.uriOf(type) ?? '')) this.reportContent(host, 'c8-foreign-content', `${host.describe()} contains the Camunda 7 extension ${type}, which Camunda 8 ignores`, { type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, extensionElement: value, path: host.extensionPath(index), hint: this.removeHint(hint, type, hint ? hint.extRemove(index) : 'remove it from the XML') });
    });
  }

  /** `Remove it: <remove>`, and the zeebe content Camunda 8 reads instead, if there is one. */
  private removeHint(hint: ZeebeHint | undefined, name: string, remove: string): string {
    const equivalent = CAMUNDA_8_EQUIVALENT[name.slice(name.indexOf(':') + 1)];
    if (!equivalent) return `Remove it: ${remove}.`;
    return `Remove it: ${remove}; Camunda 8 reads ${hint ? hint.extAdd(hint.name(equivalent)) : 'edit the XML'}.`;
  }

  /** A zeebe attribute of the BPMN element the descriptor does not define, moved to the extension element that has it. */
  private checkUnknownAttributes(host: C8Host): void {
    const zeebe = RuleKit.kit.ZEEBE;
    const hint = host.hint();
    const prefix = ZeebeHint.prefixOf(host.node);
    for (const key of host.zeebeAttributeKeys()) {
      const local = key.slice(key.indexOf(':') + 1);
      if (zeebe.attr(local)) continue;
      const home = zeebe.typeNames().map((name) => zeebe.type(name)!).find((type) => !NOT_EXECUTED.includes(type.name) && zeebe.allowedOn(type.name, host.node) === true && type.attributes.some(({ name }) => name === local));
      const homeName = home && `${prefix}:${home.name.slice('zeebe:'.length)}`;
      const guess = home ? undefined : DidYouMean.of(local, zeebe.attrs().map(({ name }) => name.slice('zeebe:'.length)));
      const unset = hint ? hint.unset(`${prefix}:${local}`) : 'edit the XML';
      const move = home && hint ? hint.extAdd(`${homeName} ${Shell.quote(`${local}=${host.node.$attrs[key] ?? ''}`)}`) : 'edit the XML';
      this.reportUnknownAttribute(host, host.describe(), `${prefix}:${local}`, { property: key, path: host.path(key), hint: home ? `Move it: ${unset}, then ${move}.` : `Remove it: ${unset}.` }, guess ? ` (did you mean ${prefix}:${guess}?)` : '', home ? ` (it reads ${local} on the ${homeName} extension element)` : ' (most zeebe settings are extension elements: `bpmn kinds`, `bpmn guide`)');
    }
  }

  /** An attribute a zeebe extension element (or one inside it) does not have. */
  private checkUnknownTreeAttributes(host: C8Host): void {
    const hint = host.hint();
    const prefix = ZeebeHint.prefixOf(host.node);
    for (const { value, index, placement } of host.zeebeValues()) {
      if (placement !== 'read') continue;
      const rebuild = hint ? hint.rebuild(hint.nameOf(value)) : 'Fix it in the XML.';
      for (const element of host.tree(value, prefix, host.extensionPath(index))) {
        const names = RuleKit.kit.ZEEBE.type(element.element.$type)?.attributes.map(({ name }) => name);
        for (const key of names ? Object.keys(element.element.$attrs ?? {}) : []) if (!key.includes(':') && !key.startsWith('xmlns')) this.reportUnknownAttribute(host, element.where, key, { property: key, path: [...element.path, key], node: element.element, hint: rebuild }, DidYouMean.suggestion(key, names!));
      }
    }
  }

  /** A zeebe attribute on a BPMN element that does not carry it (`zeebe:modelerTemplate` on a lane). */
  private checkMisplacedAttributes(host: C8Host): void {
    const hint = host.hint();
    const prefix = ZeebeHint.prefixOf(host.node);
    for (const key of host.zeebeAttributeKeys()) {
      const local = key.slice(key.indexOf(':') + 1);
      const owners = RuleKit.kit.ZEEBE.attr(local)?.owners;
      if (owners && !owners.some((owner) => host.node.$instanceOf(owner))) this.reportContent(host, 'c8-misplaced-attribute', `${prefix}:${local} on ${host.describe()} has no effect: Camunda 8 reads it on ${ElementKinds.list(owners)} only`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: key, path: host.path(key), hint: `Remove it: ${hint ? hint.unset(`${prefix}:${local}`) : 'edit the XML'}.` });
    }
  }

  private checkMisplacedExtensions(host: C8Host): void {
    const hint = host.hint();
    for (const { value, index, type, placement } of host.zeebeValues()) {
      const finding = { type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, extensionElement: value, path: host.extensionPath(index), node: host.node };
      if (placement === 'loose') this.reportContent(host, 'c8-misplaced-extension', `${host.spell(type.name)} sits directly in the extension elements of ${host.describe()}, but belongs inside ${host.spell(RuleKit.kit.ZEEBE.containersOf(type.name)[0] ?? '')}; Camunda 8 ignores it`, { ...finding, hint: hint ? `Remove it (${hint.extRemove(index)}) and add it again, \`bpmn ext add\` files it into its container: ${hint.extAdd(`${hint.nameOf(value)} ...`)}.` : 'Remove it (remove it from the XML) and add it again, `bpmn ext add` files it into its container: edit the XML.' });
      if (placement === 'misplaced') this.reportContent(host, 'c8-misplaced-extension', `${host.spell(type.name)} on ${host.describe()} has no effect: Camunda 8 reads it on ${ElementKinds.list(type.allowedIn.filter((allowed) => allowed.startsWith('bpmn:')), 5)} only`, { ...finding, hint: `Remove it: ${hint ? hint.extRemove(index) : 'remove it from the XML'}.` });
    }
    this.checkIgnoredInputs(host);
  }

  /** Input mappings on start, boundary, none intermediate throw and none end events, where only output mappings work. */
  private checkIgnoredInputs(host: C8Host): void {
    const node = host.node;
    const noDefinitions = !(node.eventDefinitions ?? []).length;
    const ignoredOn = INPUTS_IGNORED.find(([type, noneOnly]) => is(node, type) && (!noneOnly || noDefinitions))?.[2];
    if (!ignoredOn) return;
    const hint = host.hint();
    for (const { value, index, type } of host.zeebeValues()) {
      if (type.name !== 'zeebe:ioMapping') continue;
      (value.inputParameters ?? []).forEach((input: ModdleElement, inputIndex: number) => {
        this.reportContent(host, 'c8-misplaced-extension', `The input mapping ${input.target ? `to ${input.target} ` : ''}on ${host.describe()} has no effect: Camunda 8 ignores input mappings on ${ignoredOn} (output mappings work there)`, { path: host.extensionPath(index, 'inputParameters', inputIndex), type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, node: value, extensionElement: input, hint: hint ? `Remove it: ${hint.extRemove(`${hint.name('input')}[target=${input.target ?? ''}]`)} (set the variable in an activity before it, or as an output mapping of the element before).` : 'Remove it from the XML.' });
      });
    }
  }

  /** `name` on `where`, which the descriptor does not know; `suggestion` names the one it most likely means, `after` where Camunda 8 reads it. */
  private reportUnknownAttribute(host: VendorHost, where: string, name: string, data: Pick<ReportData, 'path'> & Record<string, unknown>, suggestion: string, after = ''): void {
    this.reportContent(host, 'c8-unknown-attribute', `${where} has the unknown attribute ${name}${suggestion}; Camunda 8 ignores it${after}`, { type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, ...data });
  }

  private reportContent(host: VendorHost, finding: string, message: string, { path, ...data }: ReportData): void {
    this.report(finding, host.target, message, { node: host.node, path, ...data });
  }
}

export default defineRule(
  {
    ruleName: 'c8-vendor-content',
    kind: 'engine-specific',
    targetEngine: 'c8',
    findings: {
      'c8-foreign-content': ['W_C8_FOREIGN_CONTENT', 'runtime'],
      'c8-unknown-attribute': ['W_C8_UNKNOWN_ATTRIBUTE', 'runtime'],
      'c8-misplaced-attribute': ['W_C8_MISPLACED_ATTRIBUTE', 'runtime'],
      'c8-misplaced-extension': ['W_C8_MISPLACED_EXTENSION', 'runtime'],
    },
  },
  C8VendorContent,
);
