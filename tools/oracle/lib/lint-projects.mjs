import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { CORPUS_DIR, WORK_DIR } from './paths.mjs';

const LINT_DIR = join(WORK_DIR, 'lint');
const STAMP = '.corpus-stamp';
const PLUGINS = 'plugins';
const GIT_FILE = 'dot-git';
const LINT_PROJECT = /^lint\/(?:examples|cases)\/[^/]+/;

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

if (isMainThread) {
  placeProjects();
}

export function placedProjectOf(model) {
  const project = LINT_PROJECT.exec(model)[0];
  return { folder: join(LINT_DIR, project.slice('lint/'.length)), file: model.slice(project.length + 1) };
}

