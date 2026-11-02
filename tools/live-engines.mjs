import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const CORPUS_DIR = join(REPO_ROOT, 'corpus');
const WORK_DIR = join(REPO_ROOT, '.work');

const RUNTIME = 'podman';
const READY_TIMEOUT_MS = 300_000;
const READY_POLL_MS = 2_000;
const ACCEPTED_FEEL_PER_FILE = 100;
const C7_TABLE = /^(c7-|camunda7-)/;

const C8_SETTINGS = [
  'SPRING_PROFILES_ACTIVE=broker,consolidated-auth',
  'CAMUNDA_DATA_SECONDARYSTORAGE_TYPE=rdbms',
  'CAMUNDA_DATA_SECONDARYSTORAGE_RDBMS_URL=jdbc:h2:mem:live;DB_CLOSE_DELAY=-1;MODE=PostgreSQL',
  'CAMUNDA_DATA_SECONDARYSTORAGE_RDBMS_USERNAME=sa',
  'CAMUNDA_DATA_SECONDARYSTORAGE_RDBMS_PASSWORD=',
  'CAMUNDA_SECURITY_AUTHENTICATION_UNPROTECTEDAPI=true',
  'CAMUNDA_SECURITY_AUTHORIZATIONS_ENABLED=false',
  'ZEEBE_BROKER_DATA_DISK_ENABLEMONITORING=false',
];

const C7_API = { rest: '/engine-rest', readyPath: '/version', isReady: () => true };
const C8_API = { rest: '/v2', readyPath: '/topology', isReady: ({ brokers }) => brokers?.[0]?.partitions?.[0]?.health === 'healthy' };

const ENGINES = [
  { name: 'camunda7', image: 'docker.io/camunda/camunda-bpm-platform:run-7.24.0', platform: 'c7', ...C7_API },
  { name: 'cibseven', image: 'docker.io/cibseven/cibseven:run-2.2.0', platform: 'c7', ...C7_API },
  { name: 'operaton', image: 'docker.io/operaton/operaton:2.1.5', platform: 'c7', ...C7_API, readsOperaton: true },
  { name: 'camunda8', image: 'docker.io/camunda/camunda:8.9.22', platform: 'c8', ...C8_API, env: C8_SETTINGS },
];

const readJson = (path) => JSON.parse(readFileSync(join(CORPUS_DIR, path), 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const runtime = (...words) => execFileSync(RUNTIME, words, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function verdictRows(platform) {
  const tables = readdirSync(join(CORPUS_DIR, 'engine', 'verdicts')).filter((name) => name.endsWith('.json'));
  const picked = tables.filter((name) => C7_TABLE.test(name) === (platform === 'c7'));
  const rows = picked.flatMap((name) => readJson(join('engine', 'verdicts', name)));
  return platform === 'c8' ? [...rows, ...readJson(join('engine', 'fixed', 'c8-ops.json'))] : rows;
}

function modelText({ model, deployRewrite }) {
  const text = readFileSync(join(CORPUS_DIR, 'engine', model), 'utf8');
  return deployRewrite ? text.replaceAll(deployRewrite.from, deployRewrite.to) : text;
}

function startContainer(engine) {
  const name = `bpmn-cli-live-${engine.name}-${process.pid}`;
  const environment = (engine.env ?? []).flatMap((setting) => ['--env', setting]);
  runtime('run', '--detach', '--rm', '--name', name, '--publish', '127.0.0.1::8080', ...environment, engine.image);
  const port = runtime('port', name, '8080/tcp').split(':').at(-1);
  return { name, root: `http://127.0.0.1:${port}${engine.rest}` };
}

async function waitUntilReady(root, engine) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const answer = await fetch(`${root}${engine.readyPath}`).then((response) => (response.ok ? response.json() : undefined), () => undefined);
    if (answer && engine.isReady(answer)) {
      return;
    }
    await sleep(READY_POLL_MS);
  }
  throw new Error(`${engine.name} did not answer within ${READY_TIMEOUT_MS / 1000} s`);
}

async function deployC7(root, name, text, startKey) {
  const form = new FormData();
  form.append('deployment-name', name);
  form.append('deployment-source', 'bpmn-cli-live');
  form.append('enable-duplicate-filtering', 'false');
  form.append('data', new Blob([text], { type: 'application/octet-stream' }), `${name}.bpmn`);
  const response = await fetch(`${root}/deployment/create`, { method: 'POST', body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.id !== 'string') {
    return { accepted: false, message: body.message ?? String(response.status) };
  }
  const started = startKey ? (await fetch(`${root}/process-definition/key/${startKey}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).ok : undefined;
  await fetch(`${root}/deployment/${body.id}?cascade=true`, { method: 'DELETE' });
  return { accepted: true, started };
}

async function deployC8(root, name, text) {
  const form = new FormData();
  form.append('resources', new Blob([text], { type: 'application/octet-stream' }), `${name}.bpmn`);
  const response = await fetch(`${root}/deployments`, { method: 'POST', body: form, headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { accepted: false, message: body.detail ?? String(response.status) };
  }
  const keys = (body.deployments ?? []).map(({ processDefinition }) => processDefinition?.processDefinitionKey).filter(Boolean);
  await Promise.all(keys.map((key) => fetch(`${root}/resources/${key}/deletion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })));
  return { accepted: true };
}

async function rowDifference(engine, root, row, index) {
  const name = `bpmn-cli-live-${index}`;
  const expected = engine.readsOperaton ? (row.operaton ?? row.engine) : row.engine;
  const result = engine.platform === 'c7' ? await deployC7(root, name, modelText(row), row.run ? row.startProcessKey : undefined) : await deployC8(root, name, modelText(row));
  if (result.accepted !== (expected === 'accept')) {
    return `${row.model}: recorded ${expected}, ${engine.name} ${result.accepted ? 'accepts' : `refuses: ${result.message}`}`;
  }
  if (row.run && result.accepted && result.started !== (row.run === 'ok')) {
    return `${row.model}: recorded run ${row.run}, ${engine.name} ${result.started ? 'starts it' : 'fails to start it'}`;
  }
  return undefined;
}

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function feelFlow(condition, index) {
  return `<bpmn:sequenceFlow id="S${index}" sourceRef="G" targetRef="End${index}"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${escapeXml(condition)}</bpmn:conditionExpression></bpmn:sequenceFlow><bpmn:endEvent id="End${index}" />`;
}

function feelModel(processId, conditions) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.9.0" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${processId}" isExecutable="true">
    <bpmn:startEvent id="Start" /><bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="G" />
    <bpmn:exclusiveGateway id="G" default="SD" /><bpmn:sequenceFlow id="SD" sourceRef="G" targetRef="EndD" /><bpmn:endEvent id="EndD" />
    ${conditions.map(feelFlow).join('\n    ')}
  </bpmn:process>
</bpmn:definitions>`;
}

async function feelDifferences(root) {
  const rows = readJson(join('engine', 'feel', 'verdicts.json'));
  const accepted = rows.filter((row) => row.accepted).map(({ expression }) => `= ${expression}`);
  const differences = [];
  for (let index = 0; index < accepted.length; index += ACCEPTED_FEEL_PER_FILE) {
    const batch = accepted.slice(index, index + ACCEPTED_FEEL_PER_FILE);
    const { accepted: deployed, message } = await deployC8(root, `bpmn-cli-live-feel-${index}`, feelModel(`P_bpmn_cli_feel_ok_${index}`, batch));
    if (!deployed) {
      differences.push(`feel batch ${index}: recorded accept, camunda8 refuses: ${message}`);
    }
  }
  for (const { expression } of rows.filter((row) => !row.accepted)) {
    if ((await deployC8(root, 'bpmn-cli-live-feel-refused', feelModel('P_bpmn_cli_feel_bad', [`= ${expression}`]))).accepted) {
      differences.push(`feel ${JSON.stringify(expression)}: recorded reject, camunda8 accepts`);
    }
  }
  return { differences, checked: rows.length };
}

async function judgeEngine(engine) {
  const container = startContainer(engine);
  try {
    await waitUntilReady(container.root, engine);
    const rows = verdictRows(engine.platform);
    const differences = [];
    for (const [index, row] of rows.entries()) {
      const difference = await rowDifference(engine, container.root, row, index);
      if (difference) {
        differences.push(difference);
      }
    }
    const feel = engine.platform === 'c8' ? await feelDifferences(container.root) : { differences: [], checked: 0 };
    return { engine: engine.name, image: engine.image, verdicts: rows.length, feel: feel.checked, differences: [...differences, ...feel.differences] };
  } finally {
    runtime('rm', '--force', container.name);
  }
}

function pickedEngines(words) {
  const flag = words.indexOf('--engine');
  const picked = flag === -1 ? ENGINES : ENGINES.filter(({ name }) => name === words[flag + 1]);
  if (!picked.length) {
    throw new Error(`no engine ${words[flag + 1]}; there are ${ENGINES.map(({ name }) => name).join(', ')}`);
  }
  return picked;
}

const results = [];
for (const engine of pickedEngines(process.argv.slice(2))) {
  const result = await judgeEngine(engine);
  results.push(result);
  console.log(`${result.engine} (${result.image}): ${result.verdicts} verdicts, ${result.feel} FEEL expressions, ${result.differences.length} differences`);
  result.differences.forEach((difference) => console.log(`  ${difference}`));
}
mkdirSync(WORK_DIR, { recursive: true });
writeFileSync(join(WORK_DIR, 'live-engines.json'), JSON.stringify(results, null, 2));
process.exitCode = results.some(({ differences }) => differences.length) ? 1 : 0;
