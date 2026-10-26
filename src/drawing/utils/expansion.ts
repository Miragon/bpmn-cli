/** Which sub-processes a drawing shows expanded: expanded unless the DI or the caller says not. */
import { is, many, walk, type El, type Model, idOf } from '../../model/utils/moddle.js';

export const SUB_PROCESS_TYPES = ['bpmn:SubProcess', 'bpmn:AdHocSubProcess', 'bpmn:Transaction'];

export function subProcesses(root: El): El[] {
  return [...walk(root)].filter((element) => SUB_PROCESS_TYPES.some((type) => is(element, type)) && !!element.get('id'));
}

export function diExpansionState(defs: El): Map<string, boolean> {
  const state = new Map<string, boolean>();
  for (const diagram of many(defs, 'diagrams')) {
    const plane = diagram.get<El | undefined>('plane');
    if (!plane) continue;
    for (const shape of many(plane, 'planeElement')) {
      if (!is(shape, 'bpmndi:BPMNShape')) continue;
      const target = shape.get<El | undefined>('bpmnElement');
      const id = target?.get<string | undefined>('id');
      if (!id) continue;
      if (SUB_PROCESS_TYPES.some((type) => is(target, type))) {
        state.set(id, shape.get<boolean | undefined>('isExpanded') === true);
      }
    }
  }
  return state;
}

/** Ids that are no sub-process are ignored: the CLI validates them up front. */
export function resolveExpanded(model: Model, opts: { expand?: Iterable<string>; collapse?: Iterable<string> } = {}): Set<string> {
  const diState = diExpansionState(model.definitions);
  const known = new Set(subProcesses(model.definitions).map(idOf));
  const expanded = new Set<string>();
  for (const id of known) {
    const recorded = diState.get(id);
    if (recorded === undefined || recorded) expanded.add(id);
  }
  for (const id of opts.expand ?? []) if (known.has(id)) expanded.add(id);
  for (const id of opts.collapse ?? []) expanded.delete(id);
  return expanded;
}
