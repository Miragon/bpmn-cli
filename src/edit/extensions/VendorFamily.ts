export class VendorFamily {
  constructor(private readonly type: string) {}

  ruleName(): string {
    return this.type.startsWith('operaton:') ? `camunda:${this.type.slice('operaton:'.length)}` : this.type;
  }

  spell(type: string): string {
    return this.type.startsWith('operaton:') && type.startsWith('camunda:') ? `operaton:${type.slice('camunda:'.length)}` : type;
  }

  isCamunda(): boolean {
    return this.ruleName().startsWith('camunda:');
  }

  spellPath(path: string): string {
    return this.type.startsWith('operaton:') ? path.replace(/(^|[/'])camunda:/g, '$1operaton:') : path;
  }
}
