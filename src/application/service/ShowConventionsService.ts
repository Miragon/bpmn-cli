import { ConventionsTable, type Undeclared } from '../../domain/document/ids/ConventionsTable.js';
import type { ShowConventionsUseCase } from '../port/in/ShowConventionsUseCase.js';
import type { LoadProjectSettingsPort, ProjectIdConventions } from '../port/out/LoadProjectSettingsPort.js';

export class ShowConventionsService implements ShowConventionsUseCase {
  constructor(private readonly settings: LoadProjectSettingsPort) {}

  async show(command: ShowConventionsUseCase.Command): Promise<ShowConventionsUseCase.Result> {
    const { file, doc, ...opts } = command;
    const found = await this.settings.idConventions(file, opts);
    return new ConventionsTable(doc, found?.conventions).view({
      ...(file !== undefined ? { file } : {}),
      ...(found?.setting ? { severity: found.setting.severity } : {}),
      notes: found?.notes ?? [],
      ...(found ? { where: found.where } : {}),
      undeclared: ShowConventionsService.undeclared(found, opts.lintConfig === false),
    });
  }

  view(command: ShowConventionsUseCase.ViewCommand): ShowConventionsUseCase.Result {
    const { doc, conventions, ...opts } = command;
    return new ConventionsTable(doc, conventions).view(opts);
  }

  private static undeclared(found: ProjectIdConventions | undefined, skipped: boolean): Undeclared {
    return skipped ? 'skipped' : !found ? 'no config' : found.unavailable ? 'not loaded' : 'off';
  }
}
