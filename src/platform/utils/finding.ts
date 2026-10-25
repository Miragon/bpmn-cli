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
  const f: WithSubject = { code, message, severity };
  if (element) f.element = element;
  if (extra.related?.length) f.related = extra.related;
  if (extra.hint) f.hint = extra.hint;
  Object.defineProperty(f, SUBJECT, { value: extra.subject ?? '', enumerable: false });
  return f;
}

export function subjectOf(f: ProfileFinding): string {
  return (f as WithSubject)[SUBJECT] ?? '';
}
