/**
 * Operaton's own namespace holds the camunda types under another URI
 * (Operaton reads it first, camunda:* as the fallback). Its elements keep
 * their canonical name (`operaton:inputOutput`: never merged into a
 * camunda:inputOutput, Operaton reads one of each), the structure rules
 * (ops/ExtensionStructure.ts) apply to them by local name (ruleName), and a
 * container created for an operaton item is an operaton one (inFamily).
 */
export function ruleName(type: string): string {
  return type.startsWith('operaton:') ? `camunda:${type.slice('operaton:'.length)}` : type;
}

/** A camunda type name in the namespace family of `like` (`operaton:inputOutput` for an operaton item). */
export function inFamily(type: string, like: string): string {
  return like.startsWith('operaton:') && type.startsWith('camunda:') ? `operaton:${type.slice('camunda:'.length)}` : type;
}

export function isCamunda(type: string): boolean {
  return ruleName(type).startsWith('camunda:');
}

/** A path of camunda type names in the namespace family of `like` (hints for operaton content). */
export function familyPath(path: string, like: string): string {
  return like.startsWith('operaton:') ? path.replace(/(^|[/'])camunda:/g, '$1operaton:') : path;
}
