import { defineRule, describeElement, ERROR_TYPES, type Reporter } from '../CamundaRules.js';

import { C7Host, type HostExtension } from './extensions/C7Host.js';
import { C7ExtensionRule } from './extensions/C7HostRule.js';
import { CamundaPlacement, type Misplacement } from './extensions/CamundaPlacement.js';
import type { ExtensionHints } from './extensions/ExtensionHints.js';
import { extAddArguments } from './extensions/utils/extAddArguments.js';
import { slotted } from '../shell.js';

/**
 * Reports a camunda extension element where the Camunda 7 engines do not read it: on a host type
 * that ignores it (a task listener on a service task, camunda:inputOutput on the process), loose
 * in the extension elements instead of inside its container, or on the side of an event that
 * ignores it (camunda:field on a message catch event definition).
 */
class C7MisplacedExtension extends C7ExtensionRule {
  protected override readonly executableOnly = false;

  protected checkExtensions(host: C7Host, hints: ExtensionHints, reporter: Reporter): void {
    const placement = new CamundaPlacement(host);
    for (const extension of host.camundaExtensions()) {
      const misplacement = placement.misplacementOf(extension);
      if (!misplacement) {
        continue;
      }
      host.report(reporter, {
        message: misplacement.message,
        path: host.extensionPath(extension.index),
        type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
        node: extension.value,
        extensionElement: extension.value,
        hint: this.hint(host, hints, extension, misplacement),
      });
    }
  }

  /** Remove it; a loose element is added again into its container, one the flow node reads is moved there. */
  private hint(
    host: C7Host,
    hints: ExtensionHints,
    extension: HostExtension,
    { kind }: Misplacement,
  ): string {
    const address = hints.address;
    if (kind === 'side') {
      const remove = hints.removeBySelector(extension);
      return remove ? `Remove it: ${remove}.` : 'Remove it from the XML.';
    }
    if (!address) {
      return kind === 'loose' ? 'Fix it in the XML.' : 'Remove it from the XML.';
    }
    const type = hints.typeName(extension.local);
    const again = extAddArguments(extension.value, type);
    const remove = hints.removeAt(extension);
    if (kind === 'loose') {
      const add = again
        ? `\`bpmn ext add <file> ${address.id} ${slotted(address.slot, again)}\``
        : `\`bpmn ext add <file> ${address.id} ${slotted(address.slot, type)} --xml '...'\``;
      return `Remove it (${remove}) and add it again, \`bpmn ext add\` files it into its container: ${add}.`;
    }
    return `Remove it: ${remove}${this.moveToOwner(host, extension, again)}.`;
  }

  /**
   * `, then add it to <flow node>: ...` when the element sits on an event definition or loop and
   * the flow node that holds it reads it and has none of its type yet; '' otherwise.
   */
  private moveToOwner(host: C7Host, extension: HostExtension, again: string | undefined): string {
    const owner = host.owner;
    if (!owner?.id || !again || !CamundaPlacement.isReadOn(extension.local, owner)) {
      return '';
    }
    if (new C7Host(owner).camundaExtensions(extension.local).length) {
      return '';
    }
    return `, then add it to ${describeElement(owner)}, where the engines read it: \`bpmn ext add <file> ${owner.id} ${again}\``;
  }
}

export default defineRule(
  { ruleName: 'c7-misplaced-extension', kind: 'engine-specific', targetEngine: 'c7', impact: 'runtime' },
  C7MisplacedExtension,
);
