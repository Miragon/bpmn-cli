import type { Finding, ProfileFinding, Severity } from '../Finding.js';

export const SEVERITIES: readonly Severity[] = ['deploy', 'runtime', 'practice'];

type UnserialisedFields = Pick<Finding, 'key' | 'leftOut' | 'subject' | 'covers'>;

export function withUnserialised<TFinding extends Finding>(finding: TFinding, fields: UnserialisedFields): TFinding {
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) {
      Object.defineProperty(finding, name, { value, enumerable: false });
    }
  }
  return finding;
}

export function makeFinding(
  severity: Severity,
  code: string,
  message: string,
  element: string | undefined,
  extra: { related?: string[]; hint?: string; subject?: string } = {},
): ProfileFinding {
  const finding: ProfileFinding = { code, message, severity };
  if (element) finding.element = element;
  if (extra.related?.length) finding.related = extra.related;
  if (extra.hint) finding.hint = extra.hint;
  return withUnserialised(finding, { subject: extra.subject ?? '' });
}
