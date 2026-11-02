import { BpmnError } from '../errors/BpmnError.js';
import type { BatchContext } from '../ids/IdSuggestions.js';
import type { BpmnElement } from './BpmnElement.js';
import type { BpmnTree } from './BpmnTree.js';

export class BpmnScopes {
  constructor(private readonly tree: BpmnTree) {}

  private static laneDepth(lane: BpmnElement): number {
    let depth = 0;
    for (let ancestor = lane.parent; ancestor && !ancestor.is('bpmn:Process'); ancestor = ancestor.parent) {
      if (ancestor.is('bpmn:Lane')) {
        depth++;
      }
    }
    return depth;
  }

  scopeOf(element: BpmnElement): BpmnElement | undefined {
    for (let ancestor = element.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.is('bpmn:Process') || ancestor.is('bpmn:SubProcess')) {
        return ancestor;
      }
    }
    return undefined;
  }

  processOf(scope: BpmnElement | undefined): BpmnElement | undefined {
    let current = scope;
    while (current && !current.is('bpmn:Process')) {
      current = current.parent;
    }
    return current;
  }

  defaultScope(): BpmnElement {
    const processes = this.tree.processes();
    if (processes.length === 1) {
      return processes[0]!;
    }
    if (!processes.length) {
      throw BpmnError.model('E_NO_PROCESS', 'The file contains no process', { hint: 'Add a participant with `bpmn add <file> participant <name>`, or recreate the file with `bpmn new <file> --force`.' });
    }
    throw BpmnError.model('E_AMBIGUOUS_SCOPE', `The file has ${processes.length} processes; specify the scope with --in <processId|subProcessId>`, {
      candidates: processes.map((process) => process.get<string>('id')),
    });
  }

  requireScope(id: string | undefined, batch?: BatchContext): BpmnElement {
    if (!id) {
      return this.defaultScope();
    }
    const scope = this.tree.require(id, ['bpmn:Process', 'bpmn:SubProcess', 'bpmn:Participant'], 'scope', batch);
    if (!scope.is('bpmn:Participant')) {
      return scope;
    }
    const process = scope.get<BpmnElement | undefined>('processRef');
    if (!process) {
      throw BpmnError.model('E_BLACK_BOX', `Participant "${id}" has no process (black box)`, { element: id });
    }
    return process;
  }

  flowElements(scope: BpmnElement): readonly BpmnElement[] {
    return scope.list('flowElements');
  }

  flowNodes(scope: BpmnElement): BpmnElement[] {
    return this.flowElements(scope).filter((element) => element.is('bpmn:FlowNode'));
  }

  boundaryEventsOf(activity: BpmnElement): BpmnElement[] {
    const scope = this.scopeOf(activity);
    return scope ? this.flowElements(scope).filter((element) => element.is('bpmn:BoundaryEvent') && element.get<BpmnElement | undefined>('attachedToRef') === activity) : [];
  }

  lanesOf(node: BpmnElement): BpmnElement[] {
    const process = this.processOf(node);
    return process ? this.allLanes(process).filter((lane) => lane.list('flowNodeRef').includes(node)) : [];
  }

  laneOf(node: BpmnElement): BpmnElement | undefined {
    let best: BpmnElement | undefined;
    let bestDepth = -1;
    for (const lane of this.lanesOf(node)) {
      const depth = BpmnScopes.laneDepth(lane);
      if (depth > bestDepth) {
        best = lane;
        bestDepth = depth;
      }
    }
    return best;
  }

  allLanes(process: BpmnElement): BpmnElement[] {
    const lanes: BpmnElement[] = [];
    const visit = (laneSet: BpmnElement | undefined): void => {
      for (const lane of laneSet?.list('lanes') ?? []) {
        lanes.push(lane);
        visit(lane.get<BpmnElement | undefined>('childLaneSet'));
      }
    };
    process.list('laneSets').forEach(visit);
    return lanes;
  }

  laneSetOf(owner: BpmnElement): BpmnElement | undefined {
    if (owner.is('bpmn:Lane')) {
      return owner.get<BpmnElement | undefined>('childLaneSet');
    }
    const process = owner.is('bpmn:Participant') ? owner.get<BpmnElement | undefined>('processRef') : owner;
    return process?.list('laneSets')[0];
  }
}
