import type { Warning } from '../../shared/CliError.js';

/**
 * deploy: the engines refuse the deployment; runtime: it deploys, but the setting is ignored
 * or fails when the process runs; practice: works, but the engine warns or the model is fragile.
 */
export type Severity = 'deploy' | 'runtime' | 'practice';

export const SEVERITIES: readonly Severity[] = ['deploy', 'runtime', 'practice'];

export interface ProfileFinding extends Warning {
  severity: Severity;
}

/**
 * What exactly is wrong on the element, so a mutation can tell the findings it introduced
 * from those the file already had, without it showing up in JSON output.
 */
export const SUBJECT: unique symbol = Symbol('profile-finding-subject');

type WithSubject = ProfileFinding & { [SUBJECT]?: string };

export function makeFinding(
  severity: Severity,
  code: string,
  message: string,
  element: string | undefined,
  extra: { related?: string[]; hint?: string; subject?: string } = {},
): ProfileFinding {
  const finding: WithSubject = { code, message, severity };
  if (element) finding.element = element;
  if (extra.related?.length) finding.related = extra.related;
  if (extra.hint) finding.hint = extra.hint;
  Object.defineProperty(finding, SUBJECT, { value: extra.subject ?? '', enumerable: false });
  return finding;
}

export function subjectOf(finding: ProfileFinding): string {
  return (finding as WithSubject)[SUBJECT] ?? '';
}
