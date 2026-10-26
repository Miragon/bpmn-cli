/**
 * Operaton holds the camunda types under its own URI and reads them first, camunda:* as the
 * fallback. Its elements keep their name (never merged into the camunda twin) but follow
 * the camunda structure rules by local name.
 */
export function ruleName(type: string): string {
  return type.startsWith('operaton:') ? `camunda:${type.slice('operaton:'.length)}` : type;
}

export function inFamily(type: string, like: string): string {
  return like.startsWith('operaton:') && type.startsWith('camunda:') ? `operaton:${type.slice('camunda:'.length)}` : type;
}

export function isCamunda(type: string): boolean {
  return ruleName(type).startsWith('camunda:');
}

export function familyPath(path: string, like: string): string {
  return like.startsWith('operaton:') ? path.replace(/(^|[/'])camunda:/g, '$1operaton:') : path;
}
