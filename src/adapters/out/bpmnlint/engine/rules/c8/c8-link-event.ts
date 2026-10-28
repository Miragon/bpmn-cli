import { is, isAny } from 'bpmnlint-utils';
import { C8Rule, defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C8EventPosition } from './events/C8EventPosition.js';
import { isMissing } from './events/utils/c8Values.js';
import { sh } from '../shell.js';
import { LinkEvents } from '../LinkEvents.js';

/**
 * Reports a link throw event whose (sub-)process has no link catch event of its name, and a link
 * event definition without a name where camunda-compat does not look: Camunda 8 refuses both.
 */
class C8LinkEvent extends C8Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (is(node, 'bpmn:LinkEventDefinition')) {
      this.checkName(node, reporter);
    }
    if (is(node, 'bpmn:Process') && C8EventPosition.isExecutable(node)) {
      this.checkThrows(node, reporter);
    }
  }

  private checkThrows(process: ModdleElement, reporter: Reporter): void {
    const links = new LinkEvents(process, (node) => {
      const definition = C8EventPosition.onlyDefinition(node, 'bpmn:LinkEventDefinition');
      return definition?.get('name');
    });
    for (const { el, name, scope } of links.unmatchedThrows()) {
      reportErrors(el, reporter, {
        message: `Link throw event ${el.id} goes to "${name}", but ${scope.id} has no link catch event of that name; Camunda 8 refuses the file`,
        path: ['eventDefinitions', 0, 'name'],
        data: {
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          node: el.get('eventDefinitions')[0],
          parentNode: el,
          property: 'name',
          hint: `\`bpmn add <file> intermediateCatchEvent:link "<Name>" --in ${scope.id} --link ${sh(name)}\`, then continue from it (or rename the link: \`bpmn set <file> ${el.id} link=<Name>\`).`,
        },
      });
    }
  }

  /**
   * The BPMN schema requires a name on every link event definition of the file, and Camunda 8
   * refuses an empty one. camunda-compat checks the first definition of an intermediate event in an
   * executable process; this checks the others.
   */
  private checkName(definition: ModdleElement, reporter: Reporter): void {
    const name = definition.get('name');
    if (!isMissing(name) || this.isCheckedByCompat(definition)) {
      return;
    }
    const { owner, path } = C8EventPosition.definitionOwner(definition);
    const label = owner === definition ? definition.$type : describeElement(owner);
    reportErrors(owner, reporter, {
      message: `The link event definition of ${label} has ${name === '' ? 'an empty name' : 'no name, which the BPMN schema requires'}; Camunda 8 refuses the file`,
      path: [...path, 'name'],
      data: {
        type: ERROR_TYPES.PROPERTY_REQUIRED,
        node: definition,
        parentNode: owner === definition ? null : owner,
        requiredProperty: 'name',
        hint: owner.id
          ? `\`bpmn set <file> ${owner.id} link=<Name>\` (the throw and the catch event of a pair share the name).`
          : 'Fix it in the XML.',
      },
    });
  }

  private isCheckedByCompat(definition: ModdleElement): boolean {
    const event = definition.$parent;
    return (
      isAny(event, ['bpmn:IntermediateCatchEvent', 'bpmn:IntermediateThrowEvent']) &&
      event.get('eventDefinitions')[0] === definition &&
      C8EventPosition.isInExecutableProcess(event)
    );
  }
}

export default defineRule(
  { ruleName: 'c8-link-event', kind: 'engine-specific', targetEngine: 'c8', impact: 'deploy' },
  C8LinkEvent,
);
