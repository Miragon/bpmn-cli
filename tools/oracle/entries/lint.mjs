import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import { buildSync } from 'esbuild';
import { CORPUS_DIR, MAIN_ROOT, REPO_ROOT, WORK_DIR } from '../lib/paths.mjs';

const LINT_DIR = join(WORK_DIR, 'lint');
const BUNDLE = join(LINT_DIR, 'lint.mjs');
const STAMP = '.corpus-stamp';
const PLUGINS = 'plugins';
const GIT_FILE = 'dot-git';
const LINT_PROJECT = /^lint\/(?:examples|cases)\/[^/]+/;
const ANSWERS_NOTHING = { findings: async () => ({ rows: [] }) };

function filesBelow(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

function stampOf(source) {
  const hash = createHash('sha256');
  for (const file of filesBelow(source)) {
    hash.update(file.slice(source.length)).update(readFileSync(file));
  }
  return hash.digest('hex');
}

function installPlugins(project) {
  const plugins = join(project, PLUGINS);
  if (existsSync(plugins)) {
    cpSync(plugins, join(project, 'node_modules'), { recursive: true });
  }
}

function installDependencies(project) {
  if (existsSync(join(project, 'package.json'))) {
    execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: project, stdio: ['ignore', 'ignore', 'inherit'] });
  }
}

function placeRepository(project) {
  const gitFile = join(project, GIT_FILE);
  if (existsSync(gitFile)) {
    renameSync(gitFile, join(project, '.git'));
  } else {
    mkdirSync(join(project, '.git'));
  }
}

function isPlaced(project, stamp) {
  return existsSync(join(project, STAMP)) && readFileSync(join(project, STAMP), 'utf8') === stamp;
}

function moveIntoPlace(staged, project, stamp) {
  rmSync(project, { recursive: true, force: true });
  try {
    renameSync(staged, project);
  } catch (error) {
    rmSync(staged, { recursive: true, force: true });
    if (!isPlaced(project, stamp)) {
      throw error;
    }
  }
}

function placeProject(source, project) {
  const stamp = stampOf(source);
  if (isPlaced(project, stamp)) {
    return;
  }
  const staged = `${project}.${process.pid}`;
  cpSync(source, staged, { recursive: true });
  placeRepository(staged);
  installPlugins(staged);
  installDependencies(staged);
  writeFileSync(join(staged, STAMP), stamp);
  moveIntoPlace(staged, project, stamp);
}

function placeProjects() {
  for (const kind of ['examples', 'cases']) {
    const folder = join(CORPUS_DIR, 'lint', kind);
    for (const name of readdirSync(folder)) {
      placeProject(join(folder, name), join(LINT_DIR, kind, name));
    }
  }
}

function bundleLint() {
  mkdirSync(dirname(BUNDLE), { recursive: true });
  const staged = `${BUNDLE.slice(0, -'.mjs'.length)}.${process.pid}.mjs`;
  buildSync({ absWorkingDir: REPO_ROOT, entryPoints: ['packages/lint/src/index.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: staged, logLevel: 'silent' });
  renameSync(staged, BUNDLE);
}

if (isMainThread) {
  bundleLint();
  placeProjects();
}

const mainModule = (path) => import(pathToFileURL(join(MAIN_ROOT, 'dist', path)).href);

function row({ code, severity, element }) {
  return { code, severity: severity === 'error' ? 'error' : 'warning', element: element ?? '-' };
}

async function importWarningsOfMain(xml) {
  const [{ Doc }, { reportedImportWarnings }] = await Promise.all([mainModule('index.js'), mainModule('domain/editing/utils/decision-link-warnings.js')]);
  try {
    return reportedImportWarnings(await Doc.fromXml(xml));
  } catch {
    return [];
  }
}

function mainSide(project, model) {
  return {
    async findings(xml, platform) {
      const [{ projectBpmnlint }, { Doc }] = await Promise.all([mainModule('node.js'), mainModule('index.js')]);
      const file = join(LINT_DIR, model.slice('lint/'.length));
      const validator = await projectBpmnlint(file, { lintProjectCode: true });
      const findings = await validator.validate(xml, { phase: 'check', platform, file, doc: () => Doc.fromXml(xml) });
      return { rows: findings.map(row) };
    },
  };
}

const linted = new Map();

export function projectLintAt(project, { ProjectLint }) {
  if (!linted.has(project)) {
    linted.set(project, ProjectLint.at(join(LINT_DIR, project.slice('lint/'.length), '.bpmnlintrc')));
  }
  return linted.get(project);
}

function subjectSide(project, bundle) {
  return {
    async findings(xml, platform) {
      const importWarnings = await importWarningsOfMain(xml);
      const findings = await projectLintAt(project, bundle).run({ xml, platform, importWarnings });
      return { rows: findings.map(row) };
    },
  };
}

export const openLintBundle = () => import(pathToFileURL(BUNDLE).href);
export const lintProjectOf = (model) => LINT_PROJECT.exec(model)?.[0];
export const projectFolder = (project) => join(LINT_DIR, project.slice('lint/'.length));
export const nothingToCompare = { main: ANSWERS_NOTHING, subject: ANSWERS_NOTHING };

export default {
  name: 'lint',
  describes: "ProjectLint against main's projectBpmnlint, over corpus/lint/",
  probes: ['findings'],
  open: openLintBundle,
  sidesFor({ model }, bundle) {
    const project = lintProjectOf(model);
    return project ? { main: mainSide(project, model), subject: subjectSide(project, bundle) } : nothingToCompare;
  },
};
