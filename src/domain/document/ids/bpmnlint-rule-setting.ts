export type BpmnlintSeverity = 'error' | 'warn' | 'info' | 'off';

export interface BpmnlintRuleSetting {
  severity: BpmnlintSeverity;
  /** as bpmnlint hands it to the rule: `{}` for a bare flag, undefined for `[flag]` */
  config: unknown;
}
