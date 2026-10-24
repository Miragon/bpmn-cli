/**
 * Op rules shared by `apply` (ops JSON, ops/OpsParser.ts) and the CLI flags (src/commands/);
 * `name` spells a field the way the caller's user wrote it ("after" or --after).
 */
export interface RuleViolation {
  message: string;
  hint: string;
}

export type FieldSpelling = (field: string) => string;

const PLACEMENT_ORDER = ['after', 'before', 'flow', 'in', 'on'];

/** Placement fields must form one of: after | before | after+before | flow | in | on. */
export function placementViolation(present: string[], name: FieldSpelling): RuleViolation | undefined {
  const used = PLACEMENT_ORDER.filter((k) => present.includes(k));
  if (used.length <= 1 || (used.length === 2 && used.includes('after') && used.includes('before'))) return undefined;
  return {
    message: `${used.map(name).join(' and ')} cannot be combined`,
    hint: `Use exactly one placement: ${name('after')}, ${name('before')}, ${name('after')} + ${name('before')} (splice into that flow), ${name('flow')}, ${name('in')}, or ${name('on')} (boundary events).`,
  };
}

export function defaultWithConditionViolation(isDefault: boolean, hasCondition: boolean, name: FieldSpelling): RuleViolation | undefined {
  if (!isDefault || !hasCondition) return undefined;
  return {
    message: `${name('default')} and ${name('condition')} are mutually exclusive: a default flow has no condition`,
    hint: 'Keep the condition on the other branches and mark this one as default.',
  };
}

/** At most one field of each group. */
export function groupViolation(present: string[], groups: string[][], name: FieldSpelling): RuleViolation | undefined {
  for (const g of groups) {
    const used = g.filter((k) => present.includes(k));
    if (used.length > 1) return { message: `${used.map(name).join(' and ')} cannot be combined`, hint: `Give at most one of ${g.map(name).join(', ')}.` };
  }
  return undefined;
}
