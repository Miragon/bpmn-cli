import type { FileBpmnlintOptions, ProjectIdConventions, LoadProjectSettingsPort } from '../../../application/port/out/LoadProjectSettingsPort.js';
import type { ProjectLint } from '../../../domain/validation/ProjectLint.js';
import type { Validator } from '../../../domain/validation/validators.js';
import { ProjectBpmnlint } from './ProjectBpmnlint.js';

/** The project settings of a file: the nearest .bpmnlintrc above it (or the one `lintConfig` names). */
export class BpmnlintProjectSettings implements LoadProjectSettingsPort {
  lint(file: string | undefined, opts: FileBpmnlintOptions & { validators?: readonly Validator[] }): Promise<ProjectLint> {
    return new ProjectBpmnlint(file, opts).lint();
  }

  idConventions(file: string | undefined, opts: FileBpmnlintOptions): Promise<ProjectIdConventions | undefined> {
    return new ProjectBpmnlint(file, opts).idConventions();
  }
}
