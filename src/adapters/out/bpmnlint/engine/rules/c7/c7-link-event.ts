import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7DefinitionSubject } from './events/C7DefinitionSubject.js';
import { C7EventDefinitions } from './events/C7EventDefinitions.js';
import { C7ExecutableScope } from './events/C7ExecutableScope.js';
import { sh } from '../shell.js';
import { LinkEvents } from '../LinkEvents.js';

/**
 * Reports the link events Camunda 7 refuses to deploy. Every link definition in the file needs a
 * name (BPMN schema). In what the engines run, link catch names are unique in a process
 * (sub-processes included), and a throw event reached by a sequence flow needs a catch event of its
 * name in its own (sub-)process.
 */
class C7LinkEvent extends C7Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (is(node, 'bpmn:LinkEventDefinition')) {
      this.checkName(node, reporter);
    }
    if (is(node, 'bpmn:Process') && C7ExecutableScope.contains(node)) {
      this.checkLinks(node, reporter);
    }
  }

  private checkName(definition: ModdleElement, reporter: Reporter): void {
    if (definition.name !== undefined && definition.name !== null) {
      return;
    }
    const subject = new C7DefinitionSubject(definition);
    reportErrors(subject.target, reporter, {
      message: `${subject.name('Link event')} has no link name, which the BPMN schema requires; the engines refuse the file`,
      path: subject.path('name'),
      data: {
        type: ERROR_TYPES.PROPERTY_REQUIRED,
        node: definition,
        parentNode: subject.parentNode,
        requiredProperty: 'name',
        hint: subject.hint('link=<Name>', 'the throw and the catch event of a pair share the name'),
      },
    });
  }

  private checkLinks(process: ModdleElement, reporter: Reporter): void {
    const links = new LinkEvents(process, (node) => this.linkName(node));
    for (const { first, el, name } of links.duplicateCatches()) {
      reportErrors(el, reporter, {
        message: `Link catch events ${first.id} and ${el.id} are both named "${name}"; the engines refuse two link catch events with one name in a process (sub-processes included)`,
        path: this.namePath(el),
        data: {
          type: ERROR_TYPES.ELEMENT_PROPERTY_VALUE_DUPLICATED,
          node: el,
          parentNode: null,
          duplicatedProperty: 'name',
          duplicatedPropertyValue: name,
          first,
          hint: `\`bpmn set <file> ${el.id} link=<OtherName>\` (and its throw events too).`,
        },
      });
    }
    const targets = this.flowTargets(process);
    for (const { el, name, scope } of links.unmatchedThrows()) {
      if (!targets.has(el)) {
        continue;
      }
      const elsewhere = links.catchNamed(name);
      const scopeId = scope.id ?? '<scopeId>';
      const missing = elsewhere
        ? `the catch event of that name (${elsewhere.id}) is in another scope`
        : 'no link catch event has that name';
      reportErrors(el, reporter, {
        message: `Link throw event ${el.id} jumps to "${name}", but ${missing}; the engines resolve links within one (sub-)process (${scopeId}) and refuse the file`,
        path: this.namePath(el),
        data: {
          type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
          node: el,
          parentNode: null,
          property: 'name',
          ...(elsewhere ? { elsewhere } : {}),
          hint: `Add the catching side in ${scopeId}: \`bpmn add <file> intermediateCatchEvent:link "<Name>" --in ${scopeId} --link ${sh(name)}\` and continue from it, or point the throw at an existing catch: \`bpmn set <file> ${el.id} link=<Name>\`.`,
        },
      });
    }
  }

  /** The name of the link definition the engines act on; none for the content of an ad-hoc sub-process. */
  private linkName(node: ModdleElement): string | undefined {
    if (!C7ExecutableScope.contains(node)) {
      return undefined;
    }
    const name = new C7EventDefinitions(node).ofType('bpmn:LinkEventDefinition')?.name;
    return name ?? undefined;
  }

  private namePath(event: ModdleElement): (string | number)[] {
    const definitions = new C7EventDefinitions(event);
    return definitions.pathTo(definitions.ofType('bpmn:LinkEventDefinition'), 'name');
  }

  /** The flow nodes a sequence flow of the process leads to. */
  private flowTargets(
    scope: ModdleElement,
    targets = new Set<ModdleElement>(),
  ): Set<ModdleElement> {
    for (const element of scope.flowElements ?? []) {
      if (is(element, 'bpmn:SequenceFlow') && element.targetRef) {
        targets.add(element.targetRef);
      }
      if (element.flowElements) {
        this.flowTargets(element, targets);
      }
    }
    return targets;
  }
}

export default defineRule(
  { ruleName: 'c7-link-event', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7LinkEvent,
);
