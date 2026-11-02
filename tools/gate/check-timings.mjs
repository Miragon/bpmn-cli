import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ensureMainBuilt, MAIN_ROOT } from '../shared/main-build.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const BIN = join(ROOT, 'bin', 'bpmn.js');
const MAIN_BIN = join(MAIN_ROOT, 'bin', 'bpmn.js');
const RUNS = 5;
const VERSION_BUDGET_MS = 60;
const MAIN_TOLERANCE = 1.2;
const NODES = 500;
const TASK_WIDTH = 100;
const TASK_HEIGHT = 80;
const COLUMN = 150;
const ROW = 120;
const COLUMNS = 25;
const INSERT_AFTER = `Task_${Math.floor(NODES / 2)}`;
const ABSOLUTE_BUDGET_IS_ADVISORY = process.env.CI !== undefined;

function positionOf(index) {
  return { x: 200 + (index % COLUMNS) * COLUMN, y: 100 + Math.floor(index / COLUMNS) * ROW };
}

function chainOf(ids) {
  const flows = ids.slice(1).map((target, index) => ({ id: `Flow_${index}`, source: ids[index], target }));
  const incoming = new Map(flows.map((flow) => [flow.target, flow.id]));
  const outgoing = new Map(flows.map((flow) => [flow.source, flow.id]));
  return { flows, incoming, outgoing };
}

function camunda8Model() {
  const ids = ['Start', ...Array.from({ length: NODES - 2 }, (_, index) => `Task_${index}`), 'End'];
  const { flows, incoming, outgoing } = chainOf(ids);
  const links = (id) => `${incoming.has(id) ? `<bpmn:incoming>${incoming.get(id)}</bpmn:incoming>` : ''}${outgoing.has(id) ? `<bpmn:outgoing>${outgoing.get(id)}</bpmn:outgoing>` : ''}`;
  const task = (id) => `<bpmn:serviceTask id="${id}" name="${id}"><bpmn:extensionElements><zeebe:taskDefinition type="${id}" /></bpmn:extensionElements>${links(id)}</bpmn:serviceTask>`;
  const nodes = ids.map((id) => {
    if (id === 'Start') {
      return `<bpmn:startEvent id="Start">${links(id)}</bpmn:startEvent>`;
    }
    return id === 'End' ? `<bpmn:endEvent id="End">${links(id)}</bpmn:endEvent>` : task(id);
  });
  const shapes = ids.map((id, index) => {
    const { x, y } = positionOf(index);
    const size = id.startsWith('Task_') ? [TASK_WIDTH, TASK_HEIGHT] : [36, 36];
    return `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="${y}" width="${size[0]}" height="${size[1]}" /></bpmndi:BPMNShape>`;
  });
  const edges = flows.map(({ id, source, target }) => {
    const [from, to] = [positionOf(ids.indexOf(source)), positionOf(ids.indexOf(target))];
    return `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}"><di:waypoint x="${from.x + 36}" y="${from.y + 18}" /><di:waypoint x="${to.x}" y="${to.y + 18}" /></bpmndi:BPMNEdge>`;
  });
  const sequence = flows.map(({ id, source, target }) => `<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn" modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.9.0">
<bpmn:process id="Process_1" isExecutable="true">
${[...nodes, ...sequence].join('\n')}
</bpmn:process>
<bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
${[...shapes, ...edges].join('\n')}
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

function milliseconds(bin, words) {
  const started = process.hrtime.bigint();
  const { status, stderr } = spawnSync(process.execPath, [bin, ...words], { encoding: 'utf8' });
  if (status !== 0) {
    throw new Error(`${bin} ${words.join(' ')} exited ${status}: ${stderr}`);
  }
  return Number(process.hrtime.bigint() - started) / 1e6;
}

function timedAdd(bin, model, extra) {
  const copy = `${model}.copy.bpmn`;
  copyFileSync(model, copy);
  return milliseconds(bin, ['add', copy, 'task', 'Audit', '--after', INSERT_AFTER, ...extra]);
}

function bestAddsInTurn(model) {
  const turns = Array.from({ length: RUNS }, () => [timedAdd(BIN, model, []), timedAdd(MAIN_BIN, model, [])]);
  return { add: Math.min(...turns.map(([ours]) => ours)), mainAdd: Math.min(...turns.map(([, main]) => main)) };
}

function report(line, passed, advisory = false) {
  console.log(`timings: ${passed ? 'ok' : advisory ? 'advisory' : 'FAIL'} ${line}`);
  return passed || advisory;
}

function run(work) {
  const model = join(work, 'c8-500.bpmn');
  writeFileSync(model, camunda8Model());
  const version = Math.min(...Array.from({ length: RUNS }, () => milliseconds(BIN, ['--version'])));
  const { add, mainAdd } = bestAddsInTurn(model);
  return [
    report(`--version ${version.toFixed(0)} ms, budget ${VERSION_BUDGET_MS} ms`, version <= VERSION_BUDGET_MS, ABSOLUTE_BUDGET_IS_ADVISORY),
    report(`add on Camunda 8, ${NODES} nodes: ${add.toFixed(0)} ms, main ${mainAdd.toFixed(0)} ms, best of ${RUNS} in turn, ${MAIN_TOLERANCE}× main allowed`, add <= mainAdd * MAIN_TOLERANCE),
  ].every(Boolean);
}

ensureMainBuilt();
const work = mkdtempSync(join(tmpdir(), 'bpmn-timings-'));
const passed = run(work);
rmSync(work, { recursive: true, force: true });
process.exit(passed ? 0 : 1);
