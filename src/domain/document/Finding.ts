export type ValidatorSeverity = 'error' | 'warning';

/**
 * deploy: the engines refuse the deployment; runtime: it deploys, but the setting is ignored
 * or fails when the process runs; practice: works, but the engine warns or the model is fragile.
 */
export type Severity = 'deploy' | 'runtime' | 'practice';

/**
 * One finding about the model: a structural error or warning, an engine profile's finding or a
 * validator's. The read-only fields are not enumerable, so they never show up in JSON output.
 */
export interface Finding {
  code: string;
  message: string;
  element?: string;
  related?: string[];
  hint?: string;
  severity?: Severity | ValidatorSeverity;
  validator?: string;
  /** identity for the before / after comparison (default: code + element, else code + message) */
  readonly key?: string;
  /** a write does not compare this finding but counts it under this reason; a check reports it */
  readonly leftOut?: string;
  /** what exactly is wrong on the element, so a mutation can tell the findings it introduced from those the file already had */
  readonly subject?: string;
  /** the warning is dropped when the profile reports all these subjects on its element */
  readonly covers?: string[];
}

export type ProfileFinding = Finding & { severity: Severity };

export type ValidatorIssue = Finding & { validator: string; severity: ValidatorSeverity };

/** What a validator returns. */
export interface ValidatorFinding extends Pick<Finding, 'message' | 'element' | 'related' | 'hint'> {
  /** 'error' or 'warning'; ERROR / WARN / WARNING in any case are accepted too */
  severity: string;
  /** stable rule id, e.g. UNNAMED_TASK (`ruleId` is read when there is no code) */
  code?: string;
  ruleId?: string;
  key?: string;
  leftOut?: string;
}
