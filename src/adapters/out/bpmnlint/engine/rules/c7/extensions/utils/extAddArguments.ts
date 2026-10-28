import type { ModdleElement } from '@miragon/bpmnlint-plugin-rules/engine';
import { UnresolvedReferences } from '../UnresolvedReferences.js';
import { sh } from '../../../shell.js';

interface Property {
  name: string;
  isAttr?: boolean;
  isBody?: boolean;
}

/** The attributes of a typed camunda element in file order, an unresolved reference where the descriptor puts it. */
function attributesOf(element: ModdleElement): Array<[string, string]> | undefined {
  const properties: Property[] = element.$descriptor?.properties ?? [];
  const entries: Array<[string, string]> = [];
  for (const key of Object.keys(element)) {
    const property = properties.find((candidate) => candidate.name === key);
    const value = element[key];
    const isEmptyList = Array.isArray(value) && value.length === 0;
    if (key.startsWith('$') || property?.isBody || isEmptyList) {
      continue;
    }
    if (property && !property.isAttr) {
      return undefined;
    }
    entries.push([key, value && typeof value === 'object' ? String(value.id) : String(value)]);
  }
  const rank = (name: string) => properties.findIndex((property) => property.name === name);
  for (const [name, id] of UnresolvedReferences.all(element)) {
    const before = entries.findIndex(([key]) => rank(key) > rank(name));
    entries.splice(before === -1 ? entries.length : before, 0, [name, id]);
  }
  for (const [key, value] of Object.entries(element.$attrs ?? {})) {
    if (!key.startsWith('xmlns')) {
      entries.push([key, String(value)]);
    }
  }
  return entries;
}

/**
 * `bpmn ext add` arguments that re-create a flat camunda element (attributes and body), or
 * undefined when it has child elements; `fix` replaces attribute values (placeholders).
 */
export function extAddArguments(
  element: ModdleElement,
  type: string,
  fix: Record<string, string> = {},
): string | undefined {
  const entries = attributesOf(element);
  if (!entries) {
    return undefined;
  }
  for (const key of Object.keys(fix)) {
    if (!entries.some(([existing]) => existing === key)) {
      entries.push([key, fix[key] ?? '']);
    }
  }
  const attributes = entries.map(([key, value]) => sh(`${key}=${fix[key] ?? value}`));
  const bodyProperty = (element.$descriptor?.properties ?? []).find((property: Property) => property.isBody);
  const body = bodyProperty ? element[bodyProperty.name] : undefined;
  return [type, ...attributes, ...(body !== undefined ? ['--body', sh(String(body))] : [])].join(' ');
}
