import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORPUS_DIR } from '../lib/paths.mjs';
import { corpusModels } from '../lib/corpus.mjs';
import { placedProjectOf } from '../lib/lint-projects.mjs';
import { differencesOf } from './edits.mjs';

const SHARED_VARIANTS = [['-o', 'out.bpmn'], ['--dry-run'], ['--force']];
const COMMANDS_OF_MAIN = { diagram: 'metrics' };
const FLAG_OF_KEY = {
  add: { timer: '--timer', message: '--message', nonInterrupting: '--non-interrupting' },
  retype: { message: '--message' },
  connect: { name: '--name', condition: '--condition' },
  ext: { body: '--body' },
};
const FLAGS_OF_MAIN = { show: { '--in': '--scope' } };

function keyWord(flags, word) {
  const separator = word.indexOf('=');
  const flag = flags?.[word.slice(0, separator)];
  if (separator < 0 || !flag) {
    return [word];
  }
  const value = word.slice(separator + 1);
  return value === 'true' ? [flag] : [flag, value];
}

function bridgeFlags(words) {
  const at = words.indexOf('--bridge');
  if (at < 0) {
    return words;
  }
  return [...words.slice(0, at), words[at + 1] === 'all' ? '--bridge-all' : '--no-bridge', ...words.slice(at + 2)];
}

function nameOfNew([command, file, ...rest]) {
  const named = rest[0] && !rest[0].startsWith('-');
  return named ? [command, file, '--name', rest[0], ...rest.slice(1)] : [command, file, ...rest];
}

function withoutFlag(words, flag) {
  const at = words.indexOf(flag);
  return at < 0 ? words : [...words.slice(0, at), ...words.slice(at + 2)];
}

export function wordsOnMain(words) {
  const [command, ...rest] = words;
  if (command === 'conventions') {
    return ['show', ...rest, '--conventions'];
  }
  if (command === 'new') {
    return nameOfNew(words);
  }
  if (command === 'find') {
    return withoutFlag(words, '--in');
  }
  const renamed = rest.map((word) => FLAGS_OF_MAIN[command]?.[word] ?? word).flatMap((word) => keyWord(FLAG_OF_KEY[command], word));
  return bridgeFlags([COMMANDS_OF_MAIN[command] ?? command, ...renamed]);
}

function callInputs() {
  const calls = JSON.parse(readFileSync(join(CORPUS_DIR, 'cli', 'calls.json'), 'utf8'));
  return calls.flatMap(({ shared, ...call }) => [call, ...(shared ? SHARED_VARIANTS.map((variant) => ({ ...call, args: [...call.args, ...variant] })) : [])]);
}

function lintInputs() {
  return corpusModels('lint').map((model) => ({ id: `${model}#validate`, lintModel: model }));
}

function fieldDifferences(id, main, subject, cause = '') {
  const fields = ['exit', 'code', 'verdict', 'refusedAtDeploy'].filter((field) => main[field] !== subject[field]);
  return fields.map((field) => `${id}: ${field}: main ${main[field]}, subject ${subject[field]}${cause}`);
}

function errorsOnlyMainHas(rowsThatDiffer) {
  const elements = rowsThatDiffer.filter((row) => / main only: \S+ error /.test(row)).map((row) => row.split(' ').at(-1)).sort();
  return elements.length ? `, main's errors alone: ${elements.join(', ')}` : '';
}

function rowDifferences(id, main, subject) {
  const text = ({ code, severity, element }) => `${code} ${severity} ${element}`;
  const left = new Map();
  for (const row of (subject.rows ?? []).map(text)) {
    left.set(row, (left.get(row) ?? 0) + 1);
  }
  const mainOnly = (main.rows ?? []).map(text).filter((row) => {
    const count = left.get(row) ?? 0;
    left.set(row, count - 1);
    return count === 0;
  });
  const subjectOnly = [...left].flatMap(([row, count]) => Array(Math.max(count, 0)).fill(row));
  return [...mainOnly.map((row) => `${id}: main only: ${row}`), ...subjectOnly.map((row) => `${id}: subject only: ${row}`)];
}

function editDifferences(id, main, subject) {
  if (!main.xml || !subject.xml || main.exit !== 0 || subject.exit !== 0) {
    return [];
  }
  const result = ({ xml, created = [], changed = [], removed = [] }) => ({ xml, created, changed, removed });
  return differencesOf(id, result(main), result(subject));
}

export default {
  name: 'cli',
  inputs() {
    return [...callInputs().map((call) => ({ ...call, id: call.args.join(' ') + (call.model ? ` on ${call.model}` : '') })), ...lintInputs()];
  },
  async compare(input, { main, subject }) {
    const { id, lintModel } = input;
    const [mainFacts, subjectFacts] = lintModel ? await Promise.all([main.validateProject(placedProjectOf(lintModel)), subject.validateProject(placedProjectOf(lintModel))]) : await Promise.all([main.cli(input), subject.cli(input)]);
    const rows = rowDifferences(id, mainFacts, subjectFacts);
    return {
      differences: [...fieldDifferences(id, mainFacts, subjectFacts, lintModel ? errorsOnlyMainHas(rows) : ''), ...rows, ...editDifferences(id, mainFacts, subjectFacts)],
      measures: { calls: 1 },
    };
  },
  conclude(measures) {
    return { measures: { calls: measures.length } };
  },
};
