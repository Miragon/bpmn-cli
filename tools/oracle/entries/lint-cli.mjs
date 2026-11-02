import { spawnSync } from 'node:child_process';
import { mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import { buildSync } from 'esbuild';
import { placedProjectOf } from '../lib/lint-projects.mjs';
import { REPO_ROOT, WORK_DIR } from '../lib/paths.mjs';

const BUNDLE = join(WORK_DIR, 'lint', 'lint.mjs');
const PINNED_PROJECT = /^lint\/(?:examples\/[^/]+|cases\/pinned-project-with-findings)\//;
const REPORT_LINE = /^ {2}(\S*)\s+(error|warning|info)\s+(.*?)(?:\s{2,}(\S+))?\s*$/;
const CHECKED_ONCE_ON = 'none';
const IMPORT_WARNING = 'Import warning: ';
const ANSWERS_NOTHING = { findings: async () => ({ rows: [] }) };

function bundleLint() {
  mkdirSync(dirname(BUNDLE), { recursive: true });
  const staged = `${BUNDLE.slice(0, -'.mjs'.length)}.${process.pid}.mjs`;
  buildSync({ absWorkingDir: REPO_ROOT, entryPoints: ['packages/lint/src/index.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: staged, logLevel: 'silent' });
  renameSync(staged, BUNDLE);
}

if (isMainThread) {
  bundleLint();
}

function reportRow(line) {
  const report = REPORT_LINE.exec(line);
  if (!report) {
    return [];
  }
  const [, element, severity, message, rule] = report;
  const code = rule ?? (message.startsWith(IMPORT_WARNING) ? 'import-warning' : 'parse-error');
  return [{ code, severity: severity === 'error' ? 'error' : 'warning', element: element || '-' }];
}

function cliSide({ folder, file }) {
  return {
    async findings() {
      const { stdout, stderr, status } = spawnSync(process.execPath, [join(folder, 'node_modules', 'bpmnlint', 'bin', 'bpmnlint.js'), file], { cwd: folder, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
      if ((status !== 0 && status !== 1) || stderr) {
        return { refused: `bpmnlint ended with ${status}: ${stderr}` };
      }
      return { rows: stdout.split('\n').flatMap(reportRow) };
    },
  };
}

const linted = new Map();

function projectLintAt(folder, { ProjectLint }) {
  if (!linted.has(folder)) {
    linted.set(folder, ProjectLint.at(join(folder, '.bpmnlintrc')));
  }
  return linted.get(folder);
}

function subjectSide({ folder }, bundle) {
  return {
    async findings(xml, platform) {
      const findings = await projectLintAt(folder, bundle).run({ xml, platform, importWarnings: [] });
      return { rows: findings.map(({ code, severity, element }) => ({ code, severity, element: element ?? '-' })) };
    },
  };
}

export default {
  name: 'lint-cli',
  describes: "packages/lint against bpmnlint 12's own CLI, on the projects that install their plugin",
  probes: ['findings'],
  open: () => import(pathToFileURL(BUNDLE).href),
  sidesFor({ model, platform }, bundle) {
    if (!PINNED_PROJECT.test(model) || platform !== CHECKED_ONCE_ON) {
      return { main: ANSWERS_NOTHING, subject: ANSWERS_NOTHING };
    }
    const project = placedProjectOf(model);
    return { main: cliSide(project), subject: subjectSide(project, bundle) };
  },
};
