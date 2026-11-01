export class VendorFamily {
  static ruleName(type: string): string {
    return type.startsWith('operaton:') ? `camunda:${type.slice('operaton:'.length)}` : type;
  }

  static inFamily(type: string, like: string): string {
    return like.startsWith('operaton:') && type.startsWith('camunda:') ? `operaton:${type.slice('camunda:'.length)}` : type;
  }

  static isCamunda(type: string): boolean {
    return VendorFamily.ruleName(type).startsWith('camunda:');
  }

  static familyPath(path: string, like: string): string {
    return like.startsWith('operaton:') ? path.replace(/(^|[/'])camunda:/g, '$1operaton:') : path;
  }
}
