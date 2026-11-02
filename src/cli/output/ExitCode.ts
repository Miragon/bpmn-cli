export class ExitCode {
  static readonly OK = 0;
  static readonly MODEL = 2;
  static readonly STRICT_WARNINGS = 5;
  static readonly INTERNAL = 70;

  private current: number = ExitCode.OK;

  get code(): number {
    return this.current;
  }

  set(code: number): void {
    this.current = code;
  }
}
