import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { C7VendorContentRule } from './C7VendorContentRule.js';
import { C7Host, type HostExtension } from './support/C7Host.js';
import { CamundaPlacement, type Misplacement } from './support/CamundaPlacement.js';

/**
 * A camunda extension element on an element type that ignores it, on the side of an event that
 * ignores it, or loose instead of inside its container.
 * Camunda 7 deploys the file and ignores it.
 *
 * @example a task listener on a service task
 * <bpmn:serviceTask id="Charge">
 *   <bpmn:extensionElements><camunda:taskListener event="create" class="org.acme.Audit" /></bpmn:extensionElements>  <!-- user tasks only -->
 * </bpmn:serviceTask>
 */
class C7CamundaExtensionPlacementRule extends C7VendorContentRule {
  protected checkHost(host: C7Host): void {
    if (host.isDefinitions()) return;
    const placement = new CamundaPlacement(host);
    for (const extension of host.camundaExtensions()) {
      const misplacement = placement.misplacementOf(extension);
      if (!misplacement) continue;
      const type = host.typeName(extension.local);
      const message = misplacement.kind === 'loose' ? `${type} sits directly in the extension elements of ${host.describe()}, but belongs inside ${misplacement.containers}; the engines ignore it` : `${type} on ${host.describe()} has no effect: the engines read it on ${misplacement.readOn} only`;
      this.reportContent(host, message, { type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, extensionElement: extension.value, path: host.extensionPath(extension.index), node: extension.value, hint: this.misplacedHint(host, extension, misplacement) });
    }
  }

  /** Remove it; a loose element is added again into its container, one the flow node reads is moved there. */
  private misplacedHint(host: C7Host, extension: HostExtension, { kind }: Misplacement): string {
    const address = host.address;
    if (kind === 'side') {
      return host.address ? `Remove it: ${host.address.extRemove(host.selector(extension))}.` : 'Remove it from the XML.';
    }
    if (!address) {
      return kind === 'loose' ? 'Fix it in the XML.' : 'Remove it from the XML.';
    }
    const type = host.typeName(extension.local);
    const again = C7Host.extAddArguments(extension.value, type);
    if (kind === 'loose') {
      return `Remove it (${address.extRemove(extension.index)}) and add it again, \`bpmn ext add\` files it into its container: ${address.extAdd(again ?? `${type} --xml '...'`)}.`;
    }
    const owner = host.owner;
    const moves = owner?.id && again && CamundaPlacement.isReadOn(extension.local, owner) && !new C7Host(owner).camundaExtensions(extension.local).length;
    return `Remove it: ${address.extRemove(extension.index)}${moves ? `, then add it to ${ElementKinds.describe(owner)}, where the engines read it: \`bpmn ext add <file> ${owner.id} ${again}\`` : ''}.`;
  }
}

export default defineRule({ ruleName: 'c7-camunda-extension-placement', code: 'W_C7_MISPLACED_EXTENSION', impact: 'runtime' }, C7CamundaExtensionPlacementRule);
