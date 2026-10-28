import { defineRule, ERROR_TYPES, type Reporter } from '../CamundaRules.js';

import { C7Host, ZEEBE_URI } from './extensions/C7Host.js';
import { C7HostRule } from './extensions/C7HostRule.js';
import { CamundaElementTree } from './extensions/CamundaElementTree.js';
import { CamundaPlacement } from './extensions/CamundaPlacement.js';
import { ExtensionHints } from './extensions/ExtensionHints.js';
import { slotted } from '../shell.js';

/** Reports Camunda 8 (zeebe) attributes and extension elements in a Camunda 7 diagram, which Camunda 7 ignores. */
class C7ForeignContent extends C7HostRule {
  protected checkHost(host: C7Host, reporter: Reporter): void {
    const hints = new ExtensionHints(host);
    this.checkAttributes(host, hints, reporter);
    if (!host.isDefinitions()) {
      this.checkExtensions(host, hints, reporter);
    }
  }

  private checkAttributes(host: C7Host, hints: ExtensionHints, reporter: Reporter): void {
    for (const { key, local, uri } of host.foreignAttributes()) {
      if (uri !== ZEEBE_URI) {
        continue;
      }
      host.report(reporter, {
        message: `${host.describe()} carries the Camunda 8 attribute ${key}, which Camunda 7 ignores`,
        path: host.path(`zeebe:${local}`),
        type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
        property: `zeebe:${local}`,
        hint: `Remove it: ${hints.unset(key) ?? 'edit the XML'}, and use the camunda attribute instead (\`bpmn kinds\` lists them).`,
      });
    }
  }

  private checkExtensions(host: C7Host, hints: ExtensionHints, reporter: Reporter): void {
    const placement = new CamundaPlacement(host);
    const address = hints.address;
    for (const extension of host.extensions()) {
      const type = String(extension.value.$type);
      if (extension.uri === ZEEBE_URI) {
        host.report(reporter, {
          message: `${host.describe()} contains the Camunda 8 extension ${type}, which Camunda 7 ignores`,
          path: host.extensionPath(extension.index),
          type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
          node: extension.value,
          extensionElement: extension.value,
          hint: address
            ? `Remove it: \`bpmn ext remove <file> ${address.id} ${slotted(address.slot, type)}\`.`
            : 'Remove it from the XML.',
        });
        continue;
      }
      if (!extension.isCamunda || placement.misplacement(extension) !== undefined) {
        continue;
      }
      const rebuild = hints.rebuild(extension);
      const tree = new CamundaElementTree(host, extension);
      for (const { element, where, path, key, local, uri } of tree.foreignAttributes()) {
        if (uri !== ZEEBE_URI) {
          continue;
        }
        host.report(reporter, {
          message: `${where} carries the Camunda 8 attribute ${key}, which Camunda 7 ignores`,
          path: [...path, `zeebe:${local}`],
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          node: element,
          property: `zeebe:${local}`,
          hint: rebuild,
        });
      }
    }
  }
}

export default defineRule(
  { ruleName: 'c7-foreign-content', kind: 'engine-specific', targetEngine: 'c7', impact: 'runtime' },
  C7ForeignContent,
);
