import { is, isAny } from 'bpmnlint-utils';
import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { CamundaAttributes } from './CamundaAttributes.js';

const BINDINGS = ['latest', 'deployment', 'version', 'versionTag'];

/** A `camunda:*Binding` that picks the version of the process, case or decision called, with the attributes a binding of `version` or `versionTag` needs. */
export interface Binding {
  binding: string;
  version: string;
  versionTag?: string;
  allowed: string[];
}

/** The bindings of an element the engines read, and the form reference of a user task or start event. */
export class C7Bindings {
  constructor(private readonly attributes: CamundaAttributes) {}

  /** Of a call activity, or of a business rule task with a decision. */
  of(node: ModdleElement): Binding[] {
    if (is(node, 'bpmn:CallActivity')) {
      return [{ binding: 'calledElementBinding', version: 'calledElementVersion', versionTag: 'calledElementVersionTag', allowed: BINDINGS }, { binding: 'caseBinding', version: 'caseVersion', allowed: ['latest', 'deployment', 'version'] }];
    }
    return is(node, 'bpmn:BusinessRuleTask') && this.attributes.defined('decisionRef') !== undefined ? [{ binding: 'decisionRefBinding', version: 'decisionRefVersion', versionTag: 'decisionRefVersionTag', allowed: BINDINGS }] : [];
  }

  /** What is wrong with a binding: a version it needs is missing, or the value is unknown. */
  problemOf({ binding, version, versionTag, allowed }: Binding): 'version' | 'versionTag' | 'value' | undefined {
    const value = this.attributes.defined(binding);
    if (value === undefined) return undefined;
    if (value === 'version' && this.attributes.any(version) === undefined) {
      return 'version';
    }
    if (value === 'versionTag' && versionTag && this.attributes.any(versionTag) === undefined) {
      return 'versionTag';
    }
    return allowed.includes(value) ? undefined : 'value';
  }

  /** A `camunda:formRef` of a user task or start event. */
  static hasFormRef(node: ModdleElement, attributes: CamundaAttributes): boolean {
    return isAny(node, ['bpmn:UserTask', 'bpmn:StartEvent']) && attributes.defined('formRef') !== undefined;
  }
}
