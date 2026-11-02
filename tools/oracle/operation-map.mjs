import { loadMainApi } from './lib/main-tools.mjs';

const KEYS_OF_THE_ELEMENT = ['timer', 'message', 'error', 'errorCode', 'signal', 'escalation', 'escalationCode', 'when', 'link', 'nonInterrupting', 'doc', 'text'];
const KEYS_OF_THE_CONNECTION = ['name', 'condition', 'language', 'default', 'message'];
const FLOW_KEYS_OF_A_MOVE = ['flowName', 'flowId', 'condition', 'language', 'default'];
const SELECTORS_OF_TIDY = ['path', 'via', 'kind', 'branch'];
const SELECTORS_OF_DRAWING = ['via', 'kind'];

function moved(operation, keys, extra = {}) {
  const taken = Object.entries(operation).filter(([key, value]) => keys.includes(key) && value !== undefined);
  const set = { ...Object.fromEntries(taken), ...operation.set, ...extra };
  const rest = Object.fromEntries(Object.entries(operation).filter(([key]) => !keys.includes(key) && key !== 'set'));
  return Object.keys(set).length ? { ...rest, set } : rest;
}

function without(operation, keys) {
  return Object.fromEntries(Object.entries(operation).filter(([key]) => !keys.includes(key)));
}

function mapElementKeys(operation) {
  const { collapsed, timerKind: _goes, ...kept } = operation;
  return moved(kept, KEYS_OF_THE_ELEMENT, collapsed ? { expanded: false } : {});
}

function mapSet({ values, unset, ...kept }) {
  const removed = Object.fromEntries((unset ?? []).map((key) => [key, '']));
  return { ...kept, set: { ...values, ...removed } };
}

function mapRemove({ bridge, bridgeAll, ...kept }) {
  if (bridgeAll) {
    return { ...kept, bridge: 'all' };
  }
  return bridge === false ? { ...kept, bridge: 'none' } : kept;
}

function mapSplit({ branches, ...kept }) {
  if (!Array.isArray(branches)) {
    return { ...kept, branches };
  }
  return { ...kept, branches: branches.map((branch) => (Array.isArray(branch?.nodes) ? { ...branch, nodes: branch.nodes.map(mapElementKeys) } : branch)) };
}

function mapAlign({ ids = [], axis, to }) {
  const reference = to ?? ids[0];
  const key = axis === 'row' ? 'rowOf' : 'columnOf';
  return ids.filter((id) => id !== reference).map((id) => ({ op: 'place', ids: [id], [key]: reference }));
}

const MAPPINGS = {
  add: mapElementKeys,
  retype: mapElementKeys,
  connect: (operation) => moved(operation, KEYS_OF_THE_CONNECTION),
  set: mapSet,
  remove: mapRemove,
  split: mapSplit,
  move: (operation) => without(operation, FLOW_KEYS_OF_A_MOVE),
  tidy: (operation) => without(operation, SELECTORS_OF_TIDY),
  place: (operation) => without(operation, SELECTORS_OF_DRAWING),
  color: (operation) => without(operation, SELECTORS_OF_DRAWING),
};

async function idsOfKind(xml, kind) {
  const { findXml } = await loadMainApi();
  return (await findXml(xml, '', { kind })).map(({ id }) => id);
}

export function resolveRowAlignsByKind(operations, xml) {
  return Promise.all(operations.map(async (operation) => {
    const { op, axis, kind, ...kept } = operation;
    return op === 'align' && axis === 'row' && kind ? { op, axis, ...kept, ids: await idsOfKind(xml, kind) } : operation;
  }));
}

export function mapOperations(operations) {
  return operations.flatMap((operation) => (operation.op === 'align' ? mapAlign(operation) : (MAPPINGS[operation.op]?.(operation) ?? operation)));
}
