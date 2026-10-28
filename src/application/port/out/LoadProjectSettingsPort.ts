import type { BpmnlintRuleSetting } from '../../../domain/document/ids/bpmnlint-rule-setting.js';
import type { IdConventions } from '../../../domain/document/ids/IdConventions.js';
import type { ValidatorFinding } from '../../../domain/document/Finding.js';
import type { ProjectLint } from '../../../domain/validation/ProjectLint.js';
import type { Validator } from '../../../domain/validation/validators.js';

/** Where and how the node layer runs the project's bpmnlint. */
export interface FileBpmnlintOptions {

  /**
   * the .bpmnlintrc, relative to lintFrom;
   * false: none; default: the nearest one above
   */
  lintConfig?: string | false;

  /** where a document without a file looks up its .bpmnlintrc; base of shown paths */
  lintFrom?: string;

  /**
   * bpmnlint errors in the change block the write (E_VALIDATION);
   * default: reported as warnings
   */
  lintBlocks?: boolean;

  /** run plugins the project installed, only in a git repository of the current user */
  lintProjectCode?: boolean;
}

/** What the .bpmnlintrc of a file declares about ids. */
export interface ProjectIdConventions {

  /** absent when element-id-naming is off, not configured, or switches every prefix off */
  conventions?: IdConventions;

  /**
   * W_CONFIG_IGNORED for options new ids cannot follow,
   * W_LINT_UNAVAILABLE for what is left out
   */
  notes: ValidatorFinding[];

  setting?: BpmnlintRuleSetting;

  where: string;

  /** the .bpmnlintrc could not be loaded; `notes` say why */
  unavailable?: true;
}

/** What the project around a document configures: its bpmnlint and the id conventions in it. */
export interface LoadProjectSettingsPort {

  /**
   * The project's bpmnlint for a document.
   * Nothing when `validators` already hold a bpmnlint: that host passes its own conventions.
   */
  lint(file: string | undefined, opts: FileBpmnlintOptions & { validators?: readonly Validator[] }): Promise<ProjectLint>;

  /** What the .bpmnlintrc that applies to a file declares about ids. */
  idConventions(file: string | undefined, opts: FileBpmnlintOptions): Promise<ProjectIdConventions | undefined>;
}
