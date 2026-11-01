import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CORPUS_DIR } from './paths.mjs';

const WALKS_DIR = join(CORPUS_DIR, 'walks');

export function walkFiles() {
  return statSync(WALKS_DIR, { throwIfNoEntry: false }) ? readdirSync(WALKS_DIR).filter((name) => name.endsWith('.json')).sort() : [];
}

export function walkSteps(name) {
  return JSON.parse(readFileSync(join(WALKS_DIR, name), 'utf8')).steps.map((step, index) => ({ ...step, index }));
}
