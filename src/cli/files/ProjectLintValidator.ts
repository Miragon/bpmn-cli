import { readFileSync } from 'node:fs';
import { BpmnError, type ValidationReport, type Validator, type ValidatorContext, type ValidatorFinding } from '../../api/index.js';

export class ProjectLintValidator implements Validator {
  private static readonly NAME = 'bpmnlint';
  private static readonly SAID_AGAIN_BY_RULE: Readonly<Record<string, string>> = {
    'start-event-required': 'W_NO_START',
    'end-event-required': 'W_NO_END',
    'no-implicit-end': 'W_DEAD_END',
  };

  readonly name = ProjectLintValidator.NAME;
  readonly blocks = false;
  readonly detail: string;

  private lint: Promise<{ run(input: { xml: string; platform: ValidatorContext['platform']; importWarnings: ValidatorContext['importWarnings'] }): Promise<ValidatorFinding[]> }> | undefined;

  constructor(
    private readonly configPath: string,
    where: string,
    private readonly notes: readonly ValidatorFinding[],
  ) {
    const ignored = notes.length ? `; ${notes.length} element-id-naming value${notes.length === 1 ? '' : 's'} ignored (W_CONFIG_IGNORED; bpmn validate lists ${notes.length === 1 ? 'it' : 'them'})` : '';
    this.detail = `${where}${ignored}`;
  }

  static assertReadable(path: string): void {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not a JSON object');
      }
    } catch (error) {
      throw BpmnError.io('E_LINT_CONFIG', `Cannot use the bpmnlint configuration ${path}: ${BpmnError.firstLine(error)}`, { file: path, hint: 'Pass an existing .bpmnlintrc in strict JSON to --lint-config, or --no-lint-config.' });
    }
  }

  static withoutRepeats(report: ValidationReport): ValidationReport {
    const repeats = new Set(report.findings.filter(({ validator }) => validator === ProjectLintValidator.NAME).map(({ code, element }) => `${ProjectLintValidator.SAID_AGAIN_BY_RULE[code]}|${element}`));
    const findings = report.findings.filter(({ code, element }) => !repeats.has(`${code}|${element}`));
    return { ...report, findings, state: { ...report.state, warnings: report.state.warnings - (report.findings.length - findings.length) } };
  }

  async validate(xml: string, { platform, importWarnings }: ValidatorContext): Promise<ValidatorFinding[]> {
    this.lint ??= import('@miragon/bpmn-lint').then(({ ProjectLint }) => ProjectLint.at(this.configPath));
    return [...(await (await this.lint).run({ xml, platform, importWarnings })), ...this.notes];
  }
}
