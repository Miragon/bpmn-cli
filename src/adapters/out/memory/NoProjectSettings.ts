import type { ProjectIdConventions, LoadProjectSettingsPort } from '../../../application/port/out/LoadProjectSettingsPort.js';
import { ProjectLint } from '../../../domain/validation/ProjectLint.js';

/** A document in memory has no project around it: no .bpmnlintrc, no declared id conventions. */
export class NoProjectSettings implements LoadProjectSettingsPort {
  async lint(): Promise<ProjectLint> {
    return ProjectLint.NONE;
  }

  async idConventions(): Promise<ProjectIdConventions | undefined> {
    return undefined;
  }
}
