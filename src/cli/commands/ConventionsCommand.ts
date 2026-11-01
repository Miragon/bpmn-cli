import type { Command } from 'commander';
import { kindsJson, type ValidatorFinding } from '../../api/index.js';
import type { CliShell } from '../CliShell.js';
import type { DeclaredConventions } from '../files/IdConventionsReader.js';
import { ProjectLintValidator } from '../files/ProjectLintValidator.js';

export class ConventionsCommand {
  private static readonly UNDECLARED: Readonly<Record<NonNullable<DeclaredConventions['undeclared']>, (where: string | undefined) => string>> = {
    'no config': () => 'no .bpmnlintrc applies here',
    'not loaded': (where) => `the ${where ?? '.bpmnlintrc'} could not be loaded`,
    off: (where) => `element-id-naming is off or not configured in the ${where ?? '.bpmnlintrc'}`,
  };

  constructor(private readonly shell: CliShell) {}

  private static ruleLine({ conventions, severity, where, undeclared = 'off' }: DeclaredConventions): string {
    return conventions
      ? `element-id-naming (${where}): ${severity}, case ${conventions.case ?? 'any'}, eventDefinitionQualifier ${conventions.qualifier}`
      : `no id conventions: ${ConventionsCommand.UNDECLARED[undeclared](where)}; new ids follow element-id-naming's defaults (case camelCase)`;
  }

  private static notesOf({ notes, brokenConfig, where }: DeclaredConventions): Promise<ValidatorFinding[]> | readonly ValidatorFinding[] {
    return brokenConfig ? new ProjectLintValidator(brokenConfig, where ?? brokenConfig, notes).validate('', { phase: 'check', platform: 'none', operations: [], importWarnings: [] }) : notes;
  }

  private static rows(declared: DeclaredConventions): { pattern: string; kinds: string[] }[] {
    const rows = new Map<string, string[]>();
    for (const { pattern = '', kind } of kindsJson({ conventions: declared.conventions }).kinds) {
      rows.set(pattern, [...(rows.get(pattern) ?? []), kind]);
    }
    return [...rows].map(([pattern, kinds]) => ({ pattern, kinds }));
  }

  register(program: Command): void {
    program
      .command('conventions <file>')
      .description('the id patterns new ids follow here, from the nearest .bpmnlintrc (the file need not exist yet)')
      .option('--json', 'print the patterns as JSON')
      .action((path: string, flags: { json?: boolean }) => this.run(path, flags));
  }

  private async run(path: string, { json }: { json?: boolean }): Promise<void> {
    const declared = await this.shell.conventions.near(path);
    const rows = ConventionsCommand.rows(declared);
    const notes = await ConventionsCommand.notesOf(declared);
    if (json) {
      const { conventions, where, severity, undeclared } = declared;
      this.shell.printJson({ file: path, source: where, ...(conventions ? { rule: { severity, case: conventions.case ?? 'any', qualifier: conventions.qualifier } } : { undeclared }), rows, notes });
      return;
    }
    const width = Math.max(...rows.map(({ pattern }) => pattern.length));
    this.shell.print([
      `conventions of ${path}`,
      ConventionsCommand.ruleLine(declared),
      ...rows.map(({ pattern, kinds }) => `  ${pattern.padEnd(width)}  ${kinds.join(' ')}`),
      ...notes.map(({ code, message, hint }) => `warning ${code}: ${message}${hint ? `  (${hint})` : ''}`),
    ].join('\n'));
  }
}
