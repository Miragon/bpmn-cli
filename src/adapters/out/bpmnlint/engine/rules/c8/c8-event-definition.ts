import { is, isAny } from 'bpmnlint-utils';
import { C8Rule, defineRule, describeElement, ERROR_TYPES, reportErrors, triggerName, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C8EventPosition } from './events/C8EventPosition.js';
import { FlowIndex } from './events/FlowIndex.js';

/**
 * Reports event definitions Camunda 8 refuses to deploy: several on one event, none on an event
 * sub-process start, one without the id the engine needs, a compensation that names an activity
 * of another scope or a compensation boundary event not wired to its handler, and a conditional
 * definition without a condition anywhere in the file.
 */
class C8EventDefinition extends C8Rule {
  private readonly flows = new FlowIndex();

  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (is(node, 'bpmn:ConditionalEventDefinition')) {
      this.checkCondition(node, reporter);
    }
    if (!is(node, 'bpmn:Event') || !C8EventPosition.isExecutable(node)) {
      return;
    }

    const definitions = node.get('eventDefinitions') ?? [];
    if (definitions.length > 1) {
      this.reportMultiple(node, definitions, reporter);
      return;
    }
    if (!definitions.length) {
      this.checkEventSubProcessStart(node, reporter);
      return;
    }

    const definition = C8EventPosition.checkedDefinition(node);
    if (!definition) {
      return;
    }
    this.checkDefinitionId(node, definition, reporter);
    if (is(definition, 'bpmn:CompensateEventDefinition')) {
      this.checkCompensation(node, definition, reporter);
    }
  }

  private reportMultiple(node: ModdleElement, definitions: ModdleElement[], reporter: Reporter) {
    const triggers = definitions.map(triggerName);
    reportErrors(node, reporter, {
      message: `${describeElement(node)} has ${definitions.length} event definitions (${triggers.join(', ')}); Camunda 8 allows one and refuses the file`,
      path: ['eventDefinitions'],
      data: {
        type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
        node,
        parentNode: null,
        hint: `Keep one: \`bpmn set <file> ${node.id} trigger=<${triggers.join('|')}>\` (keeps that definition, drops the others), and model each other trigger as its own event.`,
      },
    });
  }

  private checkEventSubProcessStart(node: ModdleElement, reporter: Reporter): void {
    const parent = node.$parent;
    if (!is(node, 'bpmn:StartEvent') || !C8EventPosition.isEventSubProcess(parent)) {
      return;
    }
    reportErrors(node, reporter, {
      message: `Start event ${node.id} of event sub-process ${parent.id} has no trigger; Camunda 8 needs a message, timer, error, signal, escalation or conditional start there and refuses the file`,
      path: ['eventDefinitions'],
      data: {
        type: ERROR_TYPES.PROPERTY_REQUIRED,
        node,
        parentNode: null,
        requiredProperty: 'eventDefinitions',
        hint: `\`bpmn set <file> ${node.id} trigger=message message=<MessageName>\` (or timer, error, signal, escalation, conditional).`,
      },
    });
  }

  private checkDefinitionId(
    node: ModdleElement,
    definition: ModdleElement,
    reporter: Reporter,
  ): void {
    const needsId =
      isAny(definition, ['bpmn:ConditionalEventDefinition', 'bpmn:CompensateEventDefinition']) ||
      (is(definition, 'bpmn:LinkEventDefinition') && is(node, 'bpmn:CatchEvent'));
    if (!needsId || definition.id) {
      return;
    }
    reportErrors(node, reporter, {
      message: `The ${triggerName(definition)} event definition of ${describeElement(node)} has no id; Camunda 8.9 refuses the file (an internal error: "Cannot invoke String.getBytes ... value is null")`,
      path: ['eventDefinitions', 0, 'id'],
      data: {
        type: ERROR_TYPES.PROPERTY_REQUIRED,
        node: definition,
        parentNode: node,
        requiredProperty: 'id',
        hint: `\`bpmn set <file> ${node.id} definition.id=${String(definition.$type).replace(/^[^:]*:/, '')}_${String(node.id).replace(/^[A-Za-z]+_/, '')}\` (Camunda Modeler gives every event definition an id).`,
      },
    });
  }

  private checkCompensation(
    node: ModdleElement,
    definition: ModdleElement,
    reporter: Reporter,
  ): void {
    if (is(node, 'bpmn:ThrowEvent')) {
      this.checkActivityRef(node, definition, reporter);
    }
    if (is(node, 'bpmn:BoundaryEvent')) {
      this.checkCompensationBoundary(node, reporter);
    }
  }

  /** A compensation throw event's activityRef must name an activity of its own scope. */
  private checkActivityRef(
    node: ModdleElement,
    definition: ModdleElement,
    reporter: Reporter,
  ): void {
    const activity = definition.get('activityRef');
    const scope = C8EventPosition.scopeOf(node);
    if (!activity || C8EventPosition.scopeOf(activity) === scope) {
      return;
    }
    reportErrors(node, reporter, {
      message: `Compensation event ${node.id} names ${activity.id}, which is not in its own scope ${scope?.id}; Camunda 8 refuses the file`,
      path: ['eventDefinitions', 0, 'activityRef'],
      data: {
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        node: definition,
        parentNode: node,
        property: 'activityRef',
        activityRef: activity,
        hint: `\`bpmn set <file> ${node.id} definition.activityRef=<activityId>\` (an activity of ${scope?.id}), or \`definition.activityRef=\` to compensate the whole scope.`,
      },
    });
  }

  /** A compensation boundary event needs an association to its handler and no outgoing flow. */
  private checkCompensationBoundary(node: ModdleElement, reporter: Reporter): void {
    const scope = C8EventPosition.scopeOf(node);
    const associated = (scope?.get('artifacts') ?? []).some(
      (artifact: ModdleElement) =>
        is(artifact, 'bpmn:Association') && artifact.get('sourceRef') === node,
    );
    if (!associated) {
      reportErrors(node, reporter, {
        message: `Compensation boundary event ${node.id} has no association to a compensation handler; Camunda 8 refuses the file`,
        path: null,
        data: {
          type: ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED,
          node,
          parentNode: null,
          requiredType: 'bpmn:Association',
          hint: `Connect it to its handler (an activity with isForCompensation=true): \`bpmn connect <file> ${node.id} <handlerId>\`.`,
        },
      });
      return;
    }
    const [outgoing] = this.flows.outgoing(node);
    if (outgoing) {
      reportErrors(node, reporter, {
        message: `Compensation boundary event ${node.id} has an outgoing sequence flow; Camunda 8 refuses the file`,
        path: ['outgoing'],
        data: {
          type: ERROR_TYPES.PROPERTY_NOT_ALLOWED,
          node,
          parentNode: null,
          property: 'outgoing',
          hint: `Remove the flow (\`bpmn remove <file> ${outgoing.id} --no-bridge\`) and connect the handler instead: \`bpmn connect <file> ${node.id} <handlerId>\`.`,
        },
      });
    }
  }

  /** The BPMN schema requires a condition in every conditional event definition of the file. */
  private checkCondition(definition: ModdleElement, reporter: Reporter): void {
    if (definition.get('condition')) {
      return;
    }
    const { owner, path } = C8EventPosition.definitionOwner(definition);
    const label = owner === definition ? definition.$type : describeElement(owner);
    reportErrors(owner, reporter, {
      message: `The conditional event definition of ${label} has no condition element, which the BPMN schema requires; Camunda 8 refuses the file`,
      path: [...path, 'condition'],
      data: {
        type: ERROR_TYPES.PROPERTY_REQUIRED,
        node: definition,
        parentNode: owner === definition ? null : owner,
        requiredProperty: 'condition',
        hint: owner.id ? `\`bpmn set <file> ${owner.id} 'when== <expression>'\`.` : 'Fix it in the XML.',
      },
    });
  }
}

export default defineRule(
  { ruleName: 'c8-event-definition', kind: 'engine-specific', targetEngine: 'c8', findings: { 'c8-event-definition': ['W_C8_DEPLOY_EVENT_DEFINITION', 'deploy'] } },
  C8EventDefinition,
);
