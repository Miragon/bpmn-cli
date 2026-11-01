import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { lintProjectOf, nothingToCompare, openLintBundle, projectFolder, projectLintAt } from './lint.mjs';

const REPORT_LINE = /^ {2}(\S*)\s+(error|warning|info)\s+(.*?)(?:\s{2,}(\S+))?\s*$/;
const PINNED_PROJECT = /^lint\/(?:examples\/|cases\/pinned-project-with-findings)/;
const CHECKED_ONCE_ON = 'none';
const IMPORT_WARNING = 'Import warning: ';

function reportRow(line) {
  const report = REPORT_LINE.exec(line);
  if (!report) {
    return [];
  }
  const [, element, severity, message, rule] = report;
  const code = rule ?? (message.startsWith(IMPORT_WARNING) ? 'import-warning' : 'parse-error');
  return [{ code, severity: severity === 'error' ? 'error' : 'warning', element: element || '-' }];
}

function cliSide(project, model) {
  const folder = projectFolder(project);
  const file = model.slice(project.length + 1);
  return {
    async findings() {
      const { stdout, stderr, status } = spawnSync(process.execPath, [join(folder, 'node_modules', 'bpmnlint', 'bin', 'bpmnlint.js'), file], { cwd: folder, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
      if (status !== 0 && status !== 1 || stderr) {
        return { refused: `bpmnlint ended with ${status}: ${stderr}` };
      }
      return { rows: stdout.split('\n').flatMap(reportRow) };
    },
  };
}

function subjectSide(project, bundle) {
  return {
    async findings(xml, platform) {
      const findings = await projectLintAt(project, bundle).run({ xml, platform, importWarnings: [] });
      return { rows: findings.map(({ code, severity, element }) => ({ code, severity, element: element ?? '-' })) };
    },
  };
}

export default {
  name: 'lint-cli',
  describes: "ProjectLint against bpmnlint 12's own CLI, on projects with their plugin installed",
  probes: ['findings'],
  open: openLintBundle,
  sidesFor({ model, platform }, bundle) {
    const project = lintProjectOf(model);
    const judged = project && PINNED_PROJECT.test(model) && platform === CHECKED_ONCE_ON;
    return judged ? { main: cliSide(project, model), subject: subjectSide(project, bundle) } : nothingToCompare;
  },
};
