import type { ConventionsXmlOptions } from '../api.js';
import type { IdConventions, Undeclared } from '../ids/conventions.js';
import { projectIdConventions, type FileBpmnlintOptions, type ProjectIdConventions } from './bpmnlint.js';

export class ConventionsLookup {
  private constructor(
    private readonly found: ProjectIdConventions | undefined,
    private readonly skipped: boolean,
  ) {}

  static async of(file: string | undefined, opts: FileBpmnlintOptions): Promise<ConventionsLookup> {
    return new ConventionsLookup(await projectIdConventions(file, opts), opts.lintConfig === false);
  }

  get conventions(): IdConventions | undefined {
    return this.found?.conventions;
  }

  options(file: string | undefined): ConventionsXmlOptions {
    const found = this.found;
    return {
      ...(found?.conventions ? { conventions: found.conventions } : {}),
      ...(file !== undefined ? { file } : {}),
      ...(found?.setting ? { severity: found.setting.severity } : {}),
      notes: found?.notes ?? [],
      ...(found ? { where: found.where } : {}),
      undeclared: this.undeclared(),
    };
  }

  /** Why none are declared, where none are. */
  private undeclared(): Undeclared {
    const found = this.found;
    return this.skipped ? 'skipped' : !found ? 'no config' : found.unavailable ? 'not loaded' : !found.setting || found.setting.severity === 'off' ? 'off' : 'no prefixes';
  }
}
