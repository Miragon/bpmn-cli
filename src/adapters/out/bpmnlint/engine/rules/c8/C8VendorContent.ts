import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRules.js';

import type { Engine } from '@miragon/bpmnlint-plugin-rules/engine';
import { ElementKinds } from '../ElementKinds.js';
import { C7_URIS, DiagramNamespaces } from '../DiagramNamespaces.js';
import { DidYouMean } from '../DidYouMean.js';
import { Shell } from '../Shell.js';
import { VendorContentRule } from '../VendorContentRule.js';
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
 * Reports vendor content Camunda 8 ignores: Camunda 7 (`camunda:` and `operaton:`) attributes and
 * extension elements; zeebe attributes it does not know, on a BPMN element (most zeebe settings are
 * extension elements) or on a zeebe extension element; zeebe attributes on a BPMN element that does
 * not carry them; zeebe extension elements on a host that does not read them, loose instead of in
 * their container, and input mappings on start, boundary, none intermediate throw and none end
 * events, where only output mappings work.
 */
class C8VendorContent extends VendorContentRule {
  protected readonly engine: Engine = 'c8';

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
    for (const { key, uri } of host.foreignAttributes()) if (C7_URIS.includes(uri ?? '')) this.reportForeignAttribute(host, host.describe(), key, key, { path: host.path(key), hint: this.removeHint(hint, key, hint ? hint.unset(key) : 'edit the XML') });
    const namespaces = DiagramNamespaces.forElement(host.node);
    host.extensionValues().forEach((value, index) => {
      const type = String(value.$type ?? '');
      if (value.$descriptor?.isGeneric && C7_URIS.includes(namespaces.uriOf(type) ?? '')) this.reportForeignExtension(host, type, value, { path: host.extensionPath(index), hint: this.removeHint(hint, type, hint ? hint.extRemove(index) : 'remove it from the XML') });
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
    const zeebe = C8Host.zeebe;
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
      this.reportUnknownAttribute(host, host.describe(), `${prefix}:${local}`, key, { path: host.path(key), hint: home ? `Move it: ${unset}, then ${move}.` : `Remove it: ${unset}.` }, guess ? ` (did you mean ${prefix}:${guess}?)` : '', home ? ` (it reads ${local} on the ${homeName} extension element)` : ' (most zeebe settings are extension elements: `bpmn kinds`, `bpmn guide`)');
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
        const names = C8Host.zeebe.type(element.element.$type)?.attributes.map(({ name }) => name);
        for (const key of names ? Object.keys(element.element.$attrs ?? {}) : []) if (!key.includes(':') && !key.startsWith('xmlns')) this.reportUnknownTreeAttribute(host, element, key, names!, rebuild);
      }
    }
  }

  /** A zeebe attribute on a BPMN element that does not carry it (`zeebe:modelerTemplate` on a lane). */
  private checkMisplacedAttributes(host: C8Host): void {
    const hint = host.hint();
    const prefix = ZeebeHint.prefixOf(host.node);
    for (const key of host.zeebeAttributeKeys()) {
      const local = key.slice(key.indexOf(':') + 1);
      const owners = C8Host.zeebe.attr(local)?.owners;
      if (owners && !owners.some((owner) => host.node.$instanceOf(owner))) this.reportMisplacedAttribute(host, `${prefix}:${local}`, ElementKinds.list(owners), key, { path: host.path(key), hint: `Remove it: ${hint ? hint.unset(`${prefix}:${local}`) : 'edit the XML'}.` });
    }
  }

  private checkMisplacedExtensions(host: C8Host): void {
    const hint = host.hint();
    for (const { value, index, type, placement } of host.zeebeValues()) {
      const finding = { path: host.extensionPath(index), node: host.node };
      if (placement === 'loose') this.reportLooseExtension(host, host.spell(type.name), host.spell(C8Host.zeebe.containersOf(type.name)[0] ?? ''), value, { ...finding, hint: hint ? `Remove it (${hint.extRemove(index)}) and add it again, \`bpmn ext add\` files it into its container: ${hint.extAdd(`${hint.nameOf(value)} ...`)}.` : 'Remove it (remove it from the XML) and add it again, `bpmn ext add` files it into its container: edit the XML.' });
      if (placement === 'misplaced') this.reportMisplacedExtension(host, host.spell(type.name), ElementKinds.list(type.allowedIn.filter((allowed) => allowed.startsWith('bpmn:')), 5), value, { ...finding, hint: `Remove it: ${hint ? hint.extRemove(index) : 'remove it from the XML'}.` });
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
        this.reportOn(host, 'misplaced-extension', `The input mapping ${input.target ? `to ${input.target} ` : ''}on ${host.describe()} has no effect: Camunda 8 ignores input mappings on ${ignoredOn} (output mappings work there)`, { path: host.extensionPath(index, 'inputParameters', inputIndex), type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, node: value, extensionElement: input, hint: hint ? `Remove it: ${hint.extRemove(`${hint.name('input')}[target=${input.target ?? ''}]`)} (set the variable in an activity before it, or as an output mapping of the element before).` : 'Remove it from the XML.' });
      });
    }
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
