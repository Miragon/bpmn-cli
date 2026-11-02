import { join } from 'node:path';
import { readCorpus } from './lib/corpus.mjs';
import { mapOperations } from './operation-map.mjs';

const CORPUS = 'design-iq';
const FUNCTIONS_OF_THE_REPORT = ['mutationSummary'];
const DRAWING_OPERATIONS = new Set(['place', 'align', 'color', 'label', 'route', 'space', 'tidy', 'compact', 'layout']);

function recorded(path) {
  return readCorpus(join(CORPUS, path));
}

function documentOf(argument) {
  return typeof argument === 'string' ? argument : recorded(argument.file);
}

function stubbedValidators(call) {
  const answers = call.validators.map((answer) => ({ ...answer }));
  const validate = (name) => (_xml, { phase }) => {
    const index = answers.findIndex((answer) => answer.validator === name && answer.phase === phase);
    return index < 0 ? [] : answers.splice(index, 1)[0].findings;
  };
  const named = call.args.flatMap((argument) => argument?.validators ?? []);
  return named.map(({ name, detail, blocks }) => ({ name, detail, blocks, validate: validate(name) }));
}

function sortedRows(findings) {
  return findings.map(({ code, element }) => `${code} ${element ?? '-'}`).sort();
}

function findingRows(findings) {
  return findings.map(({ code, severity, element }) => `${code} ${severity ?? 'warning'} ${element ?? '-'}`).sort();
}

function writeFacts({ xml, created, changed, removed, added, preexisting }) {
  return { write: { xml, created, changed, removed }, compared: { 'host findings added': sortedRows(added), 'host findings from before': sortedRows(preexisting) } };
}

function factsOfMainWrite({ xml, result }) {
  const reports = result.validation.validators ?? [];
  return writeFacts({
    xml: typeof xml === 'string' ? xml : recorded(xml.file),
    ...result,
    added: reports.flatMap(({ errors, warnings }) => [...errors, ...warnings]),
    preexisting: reports.flatMap(({ preexisting }) => preexisting),
  });
}

function factsOfRebuildWrite({ findings, preexisting, ...result }) {
  return writeFacts({ ...result, added: findings.filter(({ validator }) => validator), preexisting });
}

function textFacts(text, xml) {
  const ids = [...new Set([...xml.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id))];
  return { compared: { 'ids named': ids.filter((id) => new RegExp(`(?<![\\w.-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`).test(text)).sort() } };
}

function hitFacts(hits) {
  return { compared: { hits: hits.map(({ id, kind, name, match }) => ({ id, kind, name, match })) } };
}

function kindFacts(kinds, triggers) {
  return { compared: { kinds: kinds.map(({ kind }) => kind), triggers } };
}

function mainTriggers(triggers) {
  return Object.entries(triggers).map(([trigger, { keys, kinds }]) => ({ trigger, keys: keys.filter((key) => key !== 'timerKind'), kinds }));
}

function rebuildTriggers(triggers) {
  return triggers.map(({ trigger, keys, kinds }) => ({ trigger, keys, kinds }));
}

const FACTS_OF_MAIN = {
  applyToXml: factsOfMainWrite,
  layoutXml: factsOfMainWrite,
  showXml: (answer, call) => textFacts(answer, documentOf(call.args[0])),
  findXml: hitFacts,
  validateXml: ({ errors, warnings }) => ({ compared: { findings: findingRows([...errors.map((finding) => ({ ...finding, severity: 'error' })), ...warnings]) } }),
  kindsJson: ({ kinds, triggers }) => kindFacts(kinds, mainTriggers(triggers)),
};

function expansionOperations({ expand = [], collapse = [] }) {
  return [...expand.map((id) => ({ op: 'set', id, set: { expanded: true } })), ...collapse.map((id) => ({ op: 'set', id, set: { expanded: false } }))];
}

function layoutOperations(options) {
  if (options.tidy) {
    return [{ op: 'tidy' }];
  }
  const expansions = expansionOperations(options);
  return expansions.length ? expansions : [{ op: 'layout' }];
}

function showOptions({ id, around, depth, scope }) {
  return { ...(id !== undefined ? { id } : {}), ...(around !== undefined ? { around } : {}), ...(depth !== undefined ? { depth } : {}), ...(scope !== undefined ? { in: scope } : {}) };
}

const CALLS_ON_REBUILD = {
  applyToXml: async (api, xml, [operations, { validators } = {}], stubs) => factsOfRebuildWrite(await api.applyToXml(xml, mapOperations(operations), { validators: validators && stubs })),
  layoutXml: async (api, xml, [options = {}], stubs) => factsOfRebuildWrite(await api.applyToXml(xml, layoutOperations(options), { validators: options.validators && stubs })),
  showXml: async (api, xml, [options = {}]) => textFacts((await api.showXml(xml, showOptions(options))).text, xml),
  findXml: async (api, xml, [text]) => hitFacts((await api.findXml(xml, { text })).hits),
  validateXml: async (api, xml) => ({ compared: { findings: findingRows((await api.validateXml(xml)).findings) } }),
};

function refusalOf(error) {
  return { refused: error.code ?? error.name, reason: error.message };
}

function drawingBeforeModel(operations) {
  const firstDrawing = operations.findIndex(({ op }) => DRAWING_OPERATIONS.has(op));
  return firstDrawing >= 0 && operations.slice(firstDrawing).some(({ op }) => !DRAWING_OPERATIONS.has(op));
}

function refusalOnMain({ function: name, args, refused }) {
  const refusedAsUsage = name === 'applyToXml' && refused.code === 'E_NOT_FOUND' && drawingBeforeModel(args[1]);
  return { refused: refusedAsUsage ? 'E_USAGE' : refused.code, reason: refused.message };
}

export function designIqCalls() {
  const { calls } = JSON.parse(recorded('calls.json'));
  return calls.flatMap((call, index) => (FUNCTIONS_OF_THE_REPORT.includes(call.function) ? [] : [{ id: `design-iq/${index}:${call.function}`, call }]));
}

function namesOf(references) {
  return references.map(({ $ref }) => $ref.split('/').at(-1));
}

function readsOfSchema(schema) {
  const { $defs: definitions } = schema;
  const operations = namesOf(definitions.op.oneOf);
  return { operations: operations.filter((name) => definitions[name]?.properties && definitions[name]?.required) };
}

export function recordedSchema() {
  const { formatOperations, reads } = JSON.parse(recorded('schema-reads.json'));
  const operations = reads.filter(({ path }) => path.at(-1) === '$ref').map(({ value }) => value.split('/').at(-1));
  return { operations, drawing: formatOperations };
}

export function schemaFacts(schema) {
  return { ...readsOfSchema(schema), drawing: namesOf(schema.$defs.drawingOp.oneOf) };
}

export function recordedFacts(call) {
  return call.refused ? refusalOnMain(call) : FACTS_OF_MAIN[call.function](call.answer, call);
}

export async function onRebuild(api, call) {
  try {
    if (call.function === 'kindsJson') {
      const { kinds, triggers } = api.kindsJson();
      return kindFacts(kinds, rebuildTriggers(triggers));
    }
    const [document, ...rest] = call.args;
    return await CALLS_ON_REBUILD[call.function](api, documentOf(document), rest, stubbedValidators(call));
  } catch (error) {
    return refusalOf(error);
  }
}

export async function onMain(api, call) {
  try {
    const [document, ...rest] = call.args;
    const withStubs = rest.map((argument) => (argument?.validators ? { ...argument, validators: stubbedValidators(call) } : argument));
    const answer = call.function === 'kindsJson' ? api.kindsJson() : await api[call.function](documentOf(document), ...withStubs);
    return FACTS_OF_MAIN[call.function](answer, call);
  } catch (error) {
    return refusalOnMain({ ...call, refused: { code: error.code ?? error.name, message: error.message } });
  }
}
