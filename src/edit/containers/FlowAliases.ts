import { type BpmnElement, BpmnError, type ChangeSet, Kinds } from '../../model/index.js';
import type { AddOperation } from '../../operations/index.js';
import type { EditSession } from '../session/EditSession.js';
import { NodePlacement } from './NodePlacement.js';

export class FlowAliases {
  constructor(private readonly edit: EditSession) {}

  private static placementWords(command: AddOperation): string {
    const mode = NodePlacement.modeOf(command);
    if (mode === 'after') {
      return `--after ${command.after} appends it`;
    }
    return mode === 'none' ? 'no placement' : `--${mode}`;
  }

  bindFlowAs(command: AddOperation, node: BpmnElement, entryFlow: BpmnElement | undefined, changes: ChangeSet): void {
    if (!command.flowAs) {
      return;
    }
    const mode = NodePlacement.modeOf(command);
    const flow = entryFlow ?? (mode === 'before' ? this.edit.document.flows.outgoing(node)[0] : undefined);
    if (!flow) {
      throw BpmnError.usage(`flowAs ${command.flowAs}: ${node.id} gets no flow from this placement (${mode === 'none' ? 'no placement' : `--${mode}`})`, {
        element: node.id,
        hint: 'Place the node with after / before / flow, or connect it with a connect op that has "as".',
      });
    }
    changes.bind(command.flowAs, flow);
  }

  bindOutAs(command: AddOperation, node: BpmnElement, changes: ChangeSet): void {
    if (!command.outAs) {
      return;
    }
    const alias = command.outAs;
    const out = this.edit.document.flows.outgoing(node);
    if (out.length === 1) {
      changes.bind(alias, out[0]);
      return;
    }
    if (!out.length) {
      throw BpmnError.usage(`outAs ${alias}: ${node.id} gets no flow out of it from this placement (${FlowAliases.placementWords(command)})`, {
        element: node.id,
        hint: 'outAs names the flow an add creates out of the new node: a splice, a prepend or "to" creates one. Otherwise connect the node with a connect op that has "as".',
      });
    }
    const ends = out.map((flow) => `${flow.id} to ${flow.get<BpmnElement>('targetRef').id}`).join(', ');
    throw BpmnError.usage(`outAs ${alias}: ${node.id} gets ${out.length} flows out of it from this placement (${ends})`, {
      element: node.id,
      related: out.map((flow) => flow.id),
      hint: `outAs names one flow: drop "to" and connect ${node.id} to ${command.to} with a connect op that has "as" (outAs then names the other flow).`,
    });
  }

  bindExistingOutAs(alias: string, existing: BpmnElement, changes: ChangeSet): void {
    const flowNode = existing.is('bpmn:FlowNode');
    const out = flowNode ? this.edit.document.flows.outgoing(existing) : [];
    if (out.length === 1) {
      changes.bind(alias, out[0]);
      return;
    }
    const ids = out.map((flow) => flow.id);
    throw BpmnError.usage(`outAs ${alias}: ${existing.id} already exists and ${FlowAliases.existingShape(existing, flowNode, ids)}`, {
      element: existing.id,
      ...(ids.length ? { related: ids, candidates: ids } : {}),
      hint: 'With ifAbsent, outAs binds the flow out of an existing node only when exactly one leaves it: drop "outAs" there and use the flow\'s id.',
    });
  }

  private static existingShape(existing: BpmnElement, flowNode: boolean, ids: readonly string[]): string {
    if (!flowNode) {
      return `is a ${Kinds.label(existing)}, no flow node`;
    }
    return ids.length ? `has ${ids.length} flows out of it (${ids.join(', ')})` : 'has no flow out of it';
  }
}
