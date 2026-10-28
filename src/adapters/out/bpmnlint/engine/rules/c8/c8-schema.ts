import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { ModdlePath } from './tasks/ModdlePath.js';
import { ZeebeHint } from './extensions/ZeebeHint.js';
import { sh } from '../shell.js';

/**
 * Reports what Camunda 8 refuses when it validates the file against the BPMN schema and the
 * moddle tree shows: attributes without a namespace prefix the schema does not define, extension
 * elements on `bpmn:definitions`, and ids that are no XML NCName.
 */
class C8Schema extends C8Rule {
  private static readonly NCNAME_START =
    'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';

  private static readonly NCNAME = new RegExp(
    `^[${C8Schema.NCNAME_START}][${C8Schema.NCNAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`,
    'u',
  );

  private static readonly BPMN_TYPE = /^(bpmn|bpmndi|dc|di):/;

  private static readonly DI_TYPE = /^(bpmndi|dc|di):/;

  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (node.$descriptor?.isGeneric) {
      return;
    }
    if (is(node, 'bpmn:Definitions')) {
      this.checkDefinitionsExtensions(node, reporter);
    }
    if (C8Schema.BPMN_TYPE.test(node.$type)) {
      this.checkUnprefixedAttributes(node, reporter);
    }
    this.checkId(node, reporter);
  }

  private checkDefinitionsExtensions(definitions: ModdleElement, reporter: Reporter): void {
    const extensionElements = definitions.extensionElements;
    if (!extensionElements?.values?.length) {
      return;
    }
    reportErrors(definitions, reporter, {
      message:
        'bpmn:definitions carries bpmn:extensionElements, which the BPMN schema does not allow there; Camunda 8 refuses the file',
      path: ['extensionElements'],
      data: {
        type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED,
        node: definitions,
        parentNode: null,
        extensionElement: extensionElements,
        hint: `Move the content to the process: \`bpmn ext remove <file> ${definitions.id ?? '<definitionsId>'} <type>\`, then \`bpmn ext add <file> <processId> <type> ...\`.`,
      },
    });
  }

  private checkUnprefixedAttributes(node: ModdleElement, reporter: Reporter): void {
    const keys = Object.keys(node.$attrs ?? {}).filter(
      (key) => !key.includes(':') && key !== 'xmlns',
    );
    if (!keys.length) {
      return;
    }
    const owner = ModdlePath.ownerOf(node) ?? node;
    const where =
      owner === node ? this.describe(node) : `${node.$type}${owner.id ? ` in ${owner.id}` : ''}`;
    for (const key of keys) {
      reportErrors(owner, reporter, {
        message: `${where} has the attribute ${key}, which the BPMN schema does not define; Camunda 8 validates the file against the schema and refuses it`,
        path: [...ModdlePath.between(owner, node), key],
        data: {
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          node,
          parentNode: owner === node ? null : owner,
          property: key,
          hint: this.unprefixedHint(node, owner, key),
        },
      });
    }
  }

  private checkId(node: ModdleElement, reporter: Reporter): void {
    const id = node.id;
    if (typeof id !== 'string' || !id || C8Schema.NCNAME.test(id.trim())) {
      return;
    }
    const isDi = C8Schema.DI_TYPE.test(node.$type);
    const what = isDi ? node.$type : this.describe(node);
    const suggestedValue = id.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^(?=[^A-Za-z_])/, '_');
    const reason = id.includes(':')
      ? 'a colon is not allowed in an id'
      : 'letters, digits, _ . - and no leading digit';
    reportErrors(node, reporter, {
      message: `${what} has the id "${id}", which is no XML NCName (${reason}); Camunda 8 validates the file against the BPMN schema and refuses it`,
      path: ['id'],
      data: {
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        node,
        parentNode: null,
        property: 'id',
        suggestedValue,
        hint: isDi
          ? 'Rename it in the XML (or redraw the diagram: `bpmn layout <file>`).'
          : `\`bpmn set <file> ${sh(id)} id=${suggestedValue}\`.`,
      },
    });
  }

  /** Remove the attribute with `bpmn set`; on a diagram element or one `bpmn` cannot address, in the XML. */
  private unprefixedHint(node: ModdleElement, owner: ModdleElement, key: string): string {
    const isDi = C8Schema.DI_TYPE.test(node.$type) || C8Schema.DI_TYPE.test(owner.$type);
    const hint = isDi ? undefined : ZeebeHint.of(node);
    if (hint) {
      return `Remove it: ${hint.unset(key)} (vendor attributes need their namespace prefix; Camunda 8 settings are mostly ${ZeebeHint.prefixOf(node)}: extension elements).`;
    }
    if (isDi) {
      return `Remove ${key}="..." from the XML of ${owner.id ?? 'the diagram element'}, or redraw the diagram: \`bpmn layout <file>\` (the hand-made layout is lost).`;
    }
    return `Remove ${key}="..." from the XML${owner.id ? ` of ${owner.id}` : ''}.`;
  }

  private describe(node: ModdleElement): string {
    if (String(node.$type).startsWith('bpmn:')) {
      return describeElement(node);
    }
    return node.id ? `${node.$type} ${node.id}` : node.$type;
  }
}

export default defineRule(
  { ruleName: 'c8-schema', kind: 'engine-specific', targetEngine: 'c8', impact: 'deploy' },
  C8Schema,
);
