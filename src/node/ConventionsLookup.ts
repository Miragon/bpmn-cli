import type { ConventionsXmlOptions } from '../api.js';
import type { IdConventions, Undeclared } from '../ids/conventions.js';
import { projectIdConventions, type FileBpmnlintOptions, type ProjectIdConventions } from './bpmnlint.js';

/** The id conventions the project's .bpmnlintrc declares for a file (projectIdConventions), as `bpmn new` and `bpmn show --conventions` use them. */
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

  /** The options of conventionsXml (and conventionsView) for `file`: the conventions, the rule's severity, the notes, where the .bpmnlintrc is and why it declares none. */
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
