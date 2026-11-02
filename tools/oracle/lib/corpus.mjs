import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { CORPUS_DIR } from './paths.mjs';

function filesBelow(dir, extension) {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return filesBelow(path, extension);
    }
    return name.endsWith(extension) ? [path] : [];
  });
}

export function corpusModels(...folders) {
  return folders
    .map((folder) => join(CORPUS_DIR, folder))
    .filter(existsSync)
    .flatMap((dir) => filesBelow(dir, '.bpmn'))
    .map((path) => relative(CORPUS_DIR, path));
}

export function readCorpus(path) {
  return readFileSync(join(CORPUS_DIR, path), 'utf8');
}

export function corpusEdits() {
  return filesBelow(join(CORPUS_DIR, 'edits'), '.json').map((path) => JSON.parse(readFileSync(path, 'utf8')));
}

export function copyModels(fromDir, folder) {
  const isBpmnOrFolder = (path) => statSync(path).isDirectory() || path.endsWith('.bpmn');
  cpSync(fromDir, join(CORPUS_DIR, folder), { recursive: true, filter: isBpmnOrFolder });
}

export function writeCorpus(path, text) {
  const target = join(CORPUS_DIR, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}
