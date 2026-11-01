import { readFileSync } from 'node:fs';
import { BpmnError, type Validator, type ValidatorContext, type ValidatorFinding } from '../../api/index.js';

export class ProjectLintValidator implements Validator {
  readonly name = 'bpmnlint';
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

  async validate(xml: string, { platform, importWarnings }: ValidatorContext): Promise<ValidatorFinding[]> {
    this.lint ??= import('@miragon/bpmn-lint').then(({ ProjectLint }) => ProjectLint.at(this.configPath));
    return [...(await (await this.lint).run({ xml, platform, importWarnings })), ...this.notes];
  }
}
