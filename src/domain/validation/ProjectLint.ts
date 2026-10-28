import type { IdConventions } from '../document/ids/IdConventions.js';
import type { NamedValidator, Validator } from './validators.js';

/** The project's validator for a document and the id conventions it declares. */
export class ProjectLint {
  static readonly NONE = new ProjectLint();

  constructor(
    readonly validator?: NamedValidator,
    readonly conventions?: IdConventions,
  ) {}

  /**
   * The options with the project's bpmnlint next to the host's validators and the id
   * conventions it declares; `file` names the document for the validators.
   */
  applyTo<TOptions extends { file?: string; validators?: Validator[]; conventions?: IdConventions }>(opts: TOptions, file: string | undefined): TOptions {
    const named = opts.file ?? file;
    const conventions = opts.conventions ?? this.conventions;
    return {
      ...opts,
      ...(named ? { file: named } : {}),
      ...(this.validator ? { validators: [...(opts.validators ?? []), this.validator] } : {}),
      ...(conventions ? { conventions } : {}),
    };
  }
}
