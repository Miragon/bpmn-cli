import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { designIqCalls, recordedFacts } from '../design-iq-map.mjs';
import { corpusEdits, readCorpus } from '../lib/corpus.mjs';
import { CORPUS_DIR } from '../lib/paths.mjs';

const WALKS = join(CORPUS_DIR, 'walks');
const NAMESPACES_OF_THE_DRAWING = /^xmlns:(bioc|color|bpmndi|dc|di)=/;
const DRAWING_OPERATIONS = new Set(['place', 'align', 'color', 'label', 'route', 'space', 'tidy', 'compact', 'layout']);
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#10;': '\n', '&#xA;': '\n', '&#xa;': '\n' };

function decoded(text) {
  return text.replace(/&(?:lt|gt|amp|quot|apos|#10|#xA|#xa);/g, (entity) => ENTITIES[entity]).trim();
}

function attributesOf(tag) {
  const pairs = [...tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([, name, double, single]) => `${name}=${decoded(double ?? single)}`);
  return pairs.filter((pair) => !NAMESPACES_OF_THE_DRAWING.test(pair)).sort().join(' ');
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

function refusalDifference(id, mainResult, subjectResult) {
  return `${id}: refusal: main ${mainResult.refused ?? 'answers'}, subject ${subjectResult.refused ?? 'answers'} (${subjectResult.reason ?? mainResult.reason ?? ''})`;
}

export function differencesOf(id, mainResult, subjectResult) {
  if (mainResult.refused !== subjectResult.refused) {
    return [refusalDifference(id, mainResult, subjectResult)];
  }
  if (mainResult.refused) {
    return [];
  }
  if (mainResult.needsForce !== undefined && mainResult.needsForce !== subjectResult.needsForce) {
    return [`${id}: E_VALIDATION: main ${mainResult.needsForce ? 'refuses' : 'writes'}, subject ${subjectResult.needsForce ? 'refuses' : 'writes'}`];
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

function comparedLines(value) {
  return (Array.isArray(value) ? value : [value]).map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
}

export function differencesOfCall(id, mainFacts, subjectFacts) {
  if (mainFacts.refused !== subjectFacts.refused) {
    return [refusalDifference(id, mainFacts, subjectFacts)];
  }
  if (mainFacts.refused) {
    return [];
  }
  const written = mainFacts.write ? differencesOf(id, mainFacts.write, subjectFacts.write) : [];
  const compared = Object.entries(mainFacts.compared).flatMap(([field, value]) => {
    const found = firstDifference(comparedLines(value), comparedLines(subjectFacts.compared[field]));
    return found ? [`${id}: ${field}: ${found}`] : [];
  });
  return [...written, ...compared];
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
    const { model, start, steps = [] } = JSON.parse(readFileSync(path, 'utf8'));
    let before = start ?? readCorpus(model);
    return steps.map(({ ops, after }, index) => {
      const input = { id: `${path.slice(WALKS.length + 1)}#${index}`, ops, xml: before };
      before = after ?? before;
      return input;
    });
  });
}

export default {
  name: 'edits',
  inputs() {
    return [...benchInputs(), ...walkInputs(), ...designIqCalls()];
  },
  async compare({ id, model, ops, xml, call }, { main, subject }) {
    if (call) {
      return { differences: differencesOfCall(id, recordedFacts(call), await subject.designIq(call)), measures: { refused: call.refused ? 1 : 0 } };
    }
    const original = xml ?? readCorpus(model);
    const modelOps = ops.filter(({ op }) => !DRAWING_OPERATIONS.has(op));
    const [mainResult, subjectResult] = [await main.semanticEdit(original, modelOps), await subject.semanticEdit(original, modelOps)];
    return { differences: differencesOf(id, mainResult, subjectResult), measures: { refused: mainResult.refused ? 1 : 0 } };
  },
  conclude(measures) {
    return { measures: { refused: measures.reduce((sum, { refused }) => sum + refused, 0) } };
  },
};
