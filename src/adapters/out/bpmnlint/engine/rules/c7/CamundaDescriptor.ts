import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import type { EngineKit } from '../../../engine-kit.js';

/** Hosts the descriptor misses but the engines read. */
const EXTRA_HOSTS: Record<string, string[]> = {
  potentialStarter: ['bpmn:Process'],
  errorEventDefinition: ['bpmn:ServiceTask', 'bpmn:SendTask', 'bpmn:BusinessRuleTask', 'bpmn:MessageEventDefinition', 'bpmn:IntermediateThrowEvent', 'bpmn:EndEvent'],
};

/**
 * What bpmn-cli's camunda descriptor says about placement, by local name: the element types each
 * camunda attribute applies to, and the hosts each camunda extension element is read on, with the
 * ones the descriptor misses. The engine run hands the descriptor over before it lints.
 */
export class CamundaDescriptor {
  private static instance: CamundaDescriptor | undefined;

  private constructor(private readonly camunda: EngineKit['CAMUNDA']) {}

  static use(camunda: EngineKit['CAMUNDA']): void {
    if (CamundaDescriptor.instance?.camunda !== camunda) CamundaDescriptor.instance = new CamundaDescriptor(camunda);
  }

  static get(): CamundaDescriptor {
    if (!CamundaDescriptor.instance) throw new Error('CamundaDescriptor.use(CAMUNDA) runs before the Camunda 7 rules');
    return CamundaDescriptor.instance;
  }

  /** Every camunda attribute name, in descriptor order. */
  attributeNames(): string[] {
    return this.camunda.attrs().map(({ name }) => name.slice(name.indexOf(':') + 1));
  }

  /** The element types `local` applies to; undefined for an attribute the descriptor does not know. */
  ownersOf(local: string): string[] | undefined {
    return this.camunda.attr(local)?.owners;
  }

  /** The camunda attribute names that apply to `el`. */
  attributeNamesFor(el: ModdleElement): string[] {
    return this.attributeNames().filter((local) => this.appliesTo(local, el));
  }

  appliesTo(local: string, el: ModdleElement): boolean {
    return (this.ownersOf(local) ?? []).some((owner) => el.$instanceOf(owner));
  }

  /** The hosts the engines read the extension element `local` on, the descriptor's and the extra ones. */
  hostsOf(local: string): string[] {
    return [...this.camunda.allowedParents(local), ...(EXTRA_HOSTS[local] ?? [])];
  }

  /** Whether the engines read the extension element `local` directly in the extension elements of `host`. */
  isReadOn(local: string, host: ModdleElement): boolean {
    return this.hostsOf(local).some((allowed) => allowed === '*' || (allowed.startsWith('bpmn:') && host.$instanceOf(allowed)));
  }

  /** Whether `local` only appears nested in another camunda element (no host of its own). */
  isNestedOnly(local: string): boolean {
    return this.camunda.allowedParents(local).length === 0;
  }

  /** The camunda elements (`camunda:formData`) that hold `local`; a slot typed with a super type accepts it too. */
  containersOf(local: string): string[] {
    return this.camunda.containersOf(local);
  }
}
