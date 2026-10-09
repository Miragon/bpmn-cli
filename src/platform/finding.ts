/**
 * A finding of a platform validation profile (src/platform/profile.ts): a
 * Warning with a severity, so an agent can tell what a deployment will
 * refuse from what only misbehaves at run time.
 *
 *  - deploy:   the engines refuse the deployment (codes W_<P>_DEPLOY_*);
 *  - runtime:  the file deploys, but the setting is ignored or fails when
 *              the process runs (a typo, an attribute on the wrong element);
 *  - practice: works, but the engine itself warns or the model is fragile.
 *
 * Every finding carries a subject (what exactly is wrong on its element,
 * e.g. the attribute name) under a symbol, so that a mutation can tell the
 * findings it introduced from those the file already had (profileDelta)
 * without the subject showing up in JSON output.
 */
import type { Warning } from '../errors.js';

export type Severity = 'deploy' | 'runtime' | 'practice';

export const SEVERITIES: readonly Severity[] = ['deploy', 'runtime', 'practice'];

export interface ProfileFinding extends Warning {
  severity: Severity;
}

/** Hidden discriminator of a finding (not serialised). */
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
