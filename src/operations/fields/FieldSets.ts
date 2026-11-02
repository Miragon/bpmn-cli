import { FieldValues } from './FieldValues.js';
import { OperationField } from './OperationField.js';

export class FieldSets {
  static readonly placement = {
    after: OperationField.optional(FieldValues.reference, "Anchor id: append after a gateway or an unconnected node, or splice into the anchor's single outgoing flow. Together with `before`: splice into the flow after -> before."),
    before: OperationField.optional(FieldValues.reference, "Anchor id: prepend before a join gateway or an unconnected node, or splice into the anchor's single incoming flow."),
    flow: OperationField.optional(FieldValues.reference, 'Sequence flow id to splice the node into (A -> B becomes A -> node -> B).'),
    in: OperationField.optional(FieldValues.reference, 'Container id (process, sub-process or participant): put the node there without connecting it.'),
    on: OperationField.optional(FieldValues.reference, 'Boundary events only: id of the host activity.'),
  };

  static readonly flowIntoNode = {
    flowName: OperationField.optional(FieldValues.text, 'Label of the flow into the new node.'),
    flowId: OperationField.optional(FieldValues.reference, 'Explicit id of the flow into the new node (only used when a new flow is created).'),
    condition: OperationField.optional(FieldValues.text, 'Condition expression of the flow into the new node, e.g. "${ok}".'),
    language: OperationField.optional(FieldValues.text, 'Expression language of `condition` (omit for the engine default).'),
    default: OperationField.optional(FieldValues.flag, 'Mark the flow into the new node as the default flow of its source (exclusive/inclusive gateway or activity).'),
  };

  static readonly selectors = {
    path: OperationField.optional(FieldValues.references(2), '[fromId, toId]: add every node (and, for color, every flow) on the shortest sequence-flow path between them (default flows first on ties).'),
    branch: OperationField.optional(FieldValues.reference, 'Add the branch this sequence flow starts: every node only it reaches up to the join (for color also its flows).'),
  };

  static readonly kind = OperationField.required(FieldValues.reference, 'Element kind with optional trigger suffix, e.g. "userTask", "startEvent:message", "boundaryEvent:timer" (see `bpmn guide kinds`).');

  static readonly refAs = OperationField.alias('Batch alias of the bpmn:Message / Error / Signal / Escalation the element references after the op (the one the keys `message` / `error` / `signal` / `escalation` of `set` created or found; E_USAGE when it references none), e.g. "$msg"; then `{"op": "ext", "id": "$msg", "action": "add", "type": "zeebe:subscription", ...}`.');

  static readonly elementKeys = OperationField.optional(FieldValues.keys, 'What the element holds: the keys of `bpmn set`, e.g. {"timer": "P2D", "camunda:assignee": "kermit"}.');

  static readonly unset = OperationField.optional(FieldValues.unsetKeys, 'Keys to remove from the element, e.g. name or camunda:assignee (`bpmn guide set-keys` lists them).');

  static readonly noDefaultWithCondition = { not: { required: ['default', 'condition'], properties: { default: { const: true } } } };

  static readonly placementRules = [['after', 'flow'], ['after', 'in'], ['after', 'on'], ['before', 'flow'], ['before', 'in'], ['before', 'on'], ['flow', 'in'], ['flow', 'on'], ['in', 'on']].map((pair) => ({ not: { required: pair } }));

  static readonly selectionRule = { anyOf: ['ids', 'path', 'branch'].map((key) => ({ required: [key] })) };
}
