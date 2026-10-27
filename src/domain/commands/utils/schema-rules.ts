import { PLACEMENT_CONFLICTS } from './op-fields.js';

export const SELECTION_RULE = { anyOf: ['ids', 'path', 'kind', 'branch'].map((key) => ({ required: [key] })) };

export function placementRules(): unknown[] {
  return PLACEMENT_CONFLICTS.map(([first, second]) => ({ not: { required: [first, second] } }));
}

export function defaultRule(): unknown {
  return { not: { required: ['default', 'condition'], properties: { default: { const: true } } } };
}

export function groupRules(groups: string[][]): unknown[] {
  return [
    ...groups.flatMap((group) => group.flatMap((first, index) => group.slice(index + 1).map((second) => ({ not: { required: [first, second] } })))),
    { anyOf: groups.flat().map((key) => ({ required: [key] })) },
  ];
}
