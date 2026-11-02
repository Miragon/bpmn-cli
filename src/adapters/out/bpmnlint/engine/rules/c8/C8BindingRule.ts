import { is } from 'bpmnlint-utils';
import type { ModdleElement, ReportPath } from '../CamundaRule.js';
import { C8HostRule } from './C8HostRule.js';
import type { C8Host, ZeebeValue } from './support/C8Host.js';

/** The binding types Camunda 8 accepts. */
export const BINDING_TYPES = ['deployment', 'latest', 'versionTag'];
/** The extension element camunda-compat's `version-tag` checks on each host: the first of its type. */
const VERSION_TAG_CHECKED_BY_COMPAT: Record<string, string> = { 'zeebe:calledDecision': 'bpmn:BusinessRuleTask', 'zeebe:calledElement': 'bpmn:CallActivity', 'zeebe:formDefinition': 'bpmn:UserTask' };

/** An element with a binding: a called decision, element or form, or one linked resource. */
export interface BindingSite {
  element: ModdleElement;
  subject: string;
  path: (property: string) => ReportPath;
  hint: (fix: Record<string, string>) => string;
  /** whether camunda-compat reports its empty version tag already */
  checkedByCompat: boolean;
  /** whether it is a linked resource */
  linked: boolean;
}

/**
 * The bindings of the zeebe elements an element reads, for the rules on them
 * (`C8LinkedResourceNeedsTypeRule`, `C8BindingTypeKnownRule`, `C8VersionTagBindingNeedsTagRule`):
 * zeebe:calledDecision, zeebe:calledElement, zeebe:formDefinition and each resource of
 * zeebe:linkedResources.
 * Camunda 8 resolves the resource by its binding at deploy and refuses the file when it cannot.
 *
 * @example a versionTag binding without version tag
 * <zeebe:calledElement processId="Billing" bindingType="versionTag" />  <!-- versionTag="v2" -->
 */
export abstract class C8BindingRule extends C8HostRule {
  protected checkHost(host: C8Host): void {
    for (const zeebeValue of host.zeebeValues().filter(({ placement }) => placement === 'read')) {
      const { value, index, type } = zeebeValue;
      if (type.name in VERSION_TAG_CHECKED_BY_COMPAT) {
        this.checkBinding(host, { element: value, subject: `${host.spell(type.name)} of ${host.describe()}`, path: (property) => host.extensionPath(index, property), hint: (fix) => host.hint()?.replace(value, fix) ?? 'Fix it in the XML.', checkedByCompat: this.isCheckedByCompat(host, value, type.name), linked: false });
      } else if (type.name === 'zeebe:linkedResources') {
        this.checkLinkedResources(host, zeebeValue);
      }
    }
  }

  private checkLinkedResources(host: C8Host, { value, index }: ZeebeValue): void {
    const rebuild = this.rebuildHint(host, value);
    (value.values ?? []).forEach((resource: ModdleElement, resourceIndex: number) => {
      const subject = `Linked resource ${resource.linkName ?? resourceIndex + 1} of ${host.describe()}`;
      this.checkBinding(host, { element: resource, subject, path: (property) => host.extensionPath(index, 'values', resourceIndex, property), hint: () => rebuild, checkedByCompat: false, linked: true });
    });
  }

  protected abstract checkBinding(host: C8Host, site: BindingSite): void;

  /** camunda-compat reports an empty version tag of the first such element on its host. */
  private isCheckedByCompat(host: C8Host, value: ModdleElement, name: string): boolean {
    const versionTag: string | undefined = value.versionTag;
    return host.zeebeValues().find((zeebeValue) => zeebeValue.type.name === name)?.value === value && is(host.node, VERSION_TAG_CHECKED_BY_COMPAT[name] ?? '') && (versionTag === undefined || versionTag === '');
  }
}
