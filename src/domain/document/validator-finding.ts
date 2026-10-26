export type ValidatorSeverity = 'error' | 'warning';

/** What a validator returns. */
export interface ValidatorFinding {
  /** 'error' or 'warning'; ERROR / WARN / WARNING in any case are accepted too */
  severity: string;
  /** stable rule id, e.g. UNNAMED_TASK (`ruleId` is read when there is no code) */
  code?: string;
  ruleId?: string;
  message: string;
  element?: string;
  related?: string[];
  hint?: string;
  /** identity for the before / after comparison (default: code + element, else code + message) */
  key?: string;
  /** a write does not compare this finding but counts it under this reason; a check reports it */
  leftOut?: string;
}
