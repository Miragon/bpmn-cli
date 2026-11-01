export type ValidatorSeverity = 'error' | 'warning';

export type Severity = 'deploy' | 'runtime' | 'practice';

export interface Suggestion {
  op: string;
  [field: string]: unknown;
}

export interface Finding {
  code: string;
  message: string;
  element?: string;
  related?: string[];
  hint?: string;
  severity?: Severity | ValidatorSeverity;
  validator?: string;
  fix?: Suggestion;
  readonly key?: string;
  readonly subject?: string;
}

export type ProfileFinding = Finding & { severity: Severity };

export type ValidatorIssue = Finding & { validator: string; severity: ValidatorSeverity };

export interface ValidatorFinding extends Pick<Finding, 'message' | 'element' | 'related' | 'hint'> {
  severity: string;
  code?: string;
  ruleId?: string;
  key?: string;
}

export interface FindingCounts {
  errors: number;
  warnings: number;
}

type UnserialisedFields = Pick<Finding, 'key' | 'subject'>;

export class Findings {
  static readonly SEVERITIES: readonly Severity[] = ['deploy', 'runtime', 'practice'];

  static withUnserialised<TFinding extends Finding>(finding: TFinding, fields: UnserialisedFields): TFinding {
    for (const [name, value] of Object.entries(fields)) {
      if (value !== undefined) {
        Object.defineProperty(finding, name, { value, enumerable: false });
      }
    }
    return finding;
  }

  static countOf(findings: readonly Finding[]): FindingCounts {
    const errors = findings.filter(({ severity }) => severity === 'error').length;
    return { errors, warnings: findings.length - errors };
  }

  static ofLayout(this: void, { code, message, elementId }: { code: string; message: string; elementId: string }): Finding {
    return { code: `W_LAYOUT_${code}`, message, element: elementId, severity: 'warning' };
  }

  static make(severity: Severity, code: string, message: string, element: string | undefined, extra: { related?: string[]; hint?: string; subject?: string } = {}): ProfileFinding {
    const finding: ProfileFinding = { code, message, severity };
    if (element) {
      finding.element = element;
    }
    if (extra.related?.length) {
      finding.related = extra.related;
    }
    if (extra.hint) {
      finding.hint = extra.hint;
    }
    return Findings.withUnserialised(finding, { subject: extra.subject ?? '' });
  }
}
