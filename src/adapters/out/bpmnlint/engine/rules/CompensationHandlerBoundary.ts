import { is } from 'bpmnlint-utils';

import { ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from './CamundaRules.js';

/** A boundary event attached to a compensation handler, which neither Camunda engine deploys. */
export class CompensationHandlerBoundary {
  /** Reports `node` when it is such a boundary event; `refusal` says who refuses it (`Camunda 8 refuses`). */
  static check(node: ModdleElement, reporter: Reporter, refusal: string): void {
    if (!is(node, 'bpmn:BoundaryEvent')) {
      return;
    }

    const host = node.get('attachedToRef');
    if (host?.get('isForCompensation') !== true) {
      return;
    }

    reportErrors(node, reporter, {
      message: `Boundary event ${node.id} is attached to the compensation handler ${host.id}; ${refusal} boundary events on compensation handlers`,
      path: ['attachedToRef'],
      data: {
        type: ERROR_TYPES.ATTACHED_TO_REF_ELEMENT_TYPE_NOT_ALLOWED,
        node,
        parentNode: null,
        attachedToRef: host,
        hint: `Remove it: \`bpmn remove <file> ${node.id}\` (or attach it to a normal activity: \`bpmn move <file> ${node.id} --on <activityId>\`).`,
      },
    });
  }
}
