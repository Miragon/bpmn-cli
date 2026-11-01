import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { corpusEdits, readCorpus } from '../lib/corpus.mjs';
import { CORPUS_DIR } from '../lib/paths.mjs';

const WALKS = join(CORPUS_DIR, 'walks');
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#10;': '\n', '&#xA;': '\n', '&#xa;': '\n' };

function decoded(text) {
  return text.replace(/&(?:lt|gt|amp|quot|apos|#10|#xA|#xa);/g, (entity) => ENTITIES[entity]).trim();
}

function attributesOf(tag) {
  const pairs = [...tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([, name, double, single]) => `${name}=${decoded(double ?? single)}`);
  return pairs.sort().join(' ');
}

function isDiagramTag(tag) {
  return /^<\/?[\w-]*:?BPMNDiagram[\s/>]/.test(tag);
}

function semanticLines(xml) {
  const lines = [];
  const open = [];
  let skipping = 0;
  const tokens = xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, '').matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>|<[^>]+>|[^<]+/g);
  for (const [token, cdata] of tokens) {
    if (isDiagramTag(token)) {
      skipping += token.startsWith('</') ? -1 : token.endsWith('/>') ? 0 : 1;
    } else if (skipping === 0) {
      if (cdata !== undefined || !token.startsWith('<')) {
        const text = cdata ?? decoded(token);
        if (text.trim() && lines.length) {
          lines[lines.length - 1] += ` text=${text.trim()}`;
        }
      } else if (token.startsWith('</')) {
        open.pop();
      } else {
        lines.push(`${open.length} ${/^<([^\s/>]+)/.exec(token)[1]} ${attributesOf(token)}`);
        if (!token.endsWith('/>')) {
          open.push(token);
        }
      }
    }
  }
  return lines;
}

function entries(changes) {
  return changes.map(({ id, kind, detail }) => `${id} ${kind}${detail ? ` ${detail}` : ''}`);
}

function firstDifference(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    if (left[index] !== right[index]) {
      return `main: ${left[index] ?? '(nothing)'} | subject: ${right[index] ?? '(nothing)'}`;
    }
  }
  return undefined;
}

function differencesOf(id, mainResult, subjectResult) {
  if (mainResult.refused !== subjectResult.refused) {
    return [`${id}: refusal: main ${mainResult.refused ?? 'writes'}, subject ${subjectResult.refused ?? 'writes'} (${subjectResult.reason ?? mainResult.reason ?? ''})`];
  }
  if (mainResult.refused) {
    return [];
  }
  const compared = [
    ['semantics', semanticLines(mainResult.xml), semanticLines(subjectResult.xml)],
    ...['created', 'changed', 'removed'].map((field) => [field, entries(mainResult[field]), entries(subjectResult[field])]),
  ];
  return compared.flatMap(([field, left, right]) => {
    const found = firstDifference(left, right);
    return found ? [`${id}: ${field}: ${found}`] : [];
  });
}

function benchInputs() {
  return corpusEdits().flatMap(({ model, bench }) => Object.entries(bench?.edits ?? {})
    .filter(([, { ops }]) => Array.isArray(ops))
    .map(([name, { ops }]) => ({ id: `${model}#${name}`, model, ops })));
}

function walkFiles(folder) {
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walkFiles(path) : name.endsWith('.json') ? [path] : [];
  });
}

function walkInputs() {
  return walkFiles(WALKS).flatMap((path) => {
    const { steps = [] } = JSON.parse(readFileSync(path, 'utf8'));
    return steps.map(({ ops, before, xml }, index) => ({ id: `${path.slice(WALKS.length + 1)}#${index}`, ops, xml: before ?? xml }));
  });
}

export default {
  name: 'edits',
  inputs() {
    return [...benchInputs(), ...walkInputs()];
  },
  async compare({ id, model, ops, xml }, { main, subject }) {
    const original = xml ?? readCorpus(model);
    const [mainResult, subjectResult] = [await main.semanticEdit(original, ops), await subject.semanticEdit(original, ops)];
    return { differences: differencesOf(id, mainResult, subjectResult), measures: { refused: mainResult.refused ? 1 : 0 } };
  },
  conclude(measures) {
    return { measures: { refused: measures.reduce((sum, { refused }) => sum + refused, 0) } };
  },
};
