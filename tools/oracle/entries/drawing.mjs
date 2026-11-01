import { buildSync } from 'esbuild';
import { REPO_ROOT } from '../lib/paths.mjs';
import { mapOperations, resolveRowAlignsByKind } from '../operation-map.mjs';

const ENTRY_SOURCE = `
export { DiagramDrawing, DrawingSnapshot } from './src/drawing/index.ts';
export { ChangeSet, DocumentReader, DocumentWriter } from './src/model/index.ts';
export { OperationParser } from './src/operations/index.ts';
`;

const SELECTING_OPERATIONS = ['place', 'align', 'color', 'tidy'];

function loadDrawing() {
  const { outputFiles } = buildSync({ stdin: { contents: ENTRY_SOURCE, resolveDir: REPO_ROOT, loader: 'ts' }, bundle: true, platform: 'browser', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

async function attempt(action) {
  try {
    return await action();
  } catch (error) {
    return { refused: error.code ?? error.name, reason: error.message };
  }
}

function selectsByKind({ op, kind, via }) {
  return SELECTING_OPERATIONS.includes(op) && (kind || via);
}

async function drawnOperations({ OperationParser }, step) {
  const resolved = await resolveRowAlignsByKind(step.ops, step.before);
  if (resolved.some(selectsByKind)) {
    return undefined;
  }
  const mapped = mapOperations(resolved);
  const drawn = step.noLayout ? mapped.filter(({ op }) => op === 'order') : mapped;
  if (!drawn.length) {
    return [];
  }
  const { model, drawing } = new OperationParser().parse(drawn);
  return [...model, ...drawing];
}

function changesOf({ ChangeSet }, { created, changed, removed, relocated, expand, collapse }) {
  const changes = new ChangeSet();
  created.forEach((id) => changes.create({ id, kind: 'recorded' }));
  changed.forEach((id) => changes.change({ id, kind: 'recorded' }));
  removed.forEach((id) => changes.remove({ id, kind: 'recorded' }));
  changes.relocated.push(...relocated);
  expand.forEach((id) => changes.expansions.expand(id, true));
  collapse.forEach((id) => changes.expansions.expand(id, false));
  return changes;
}

function planeElementKey(plane, di, id) {
  return `${plane?.peek('id')}|${di.type}|${id}`;
}

function rebased(snapshot, document, renamed) {
  const idNow = new Map(renamed.map(({ from, to }) => [from, to]));
  const now = (id) => idNow.get(id) ?? id;
  const elementNow = (element) => document.tree.byId(now(element.id)) ?? element;
  const planeElements = document.diagram.planes().flatMap((plane) => plane.list('planeElement').map((di) => [planeElementKey(plane, di, di.peek('bpmnElement')?.id), di]));
  const byKey = new Map(planeElements);
  for (const [di, entry] of [...snapshot.byDi]) {
    snapshot.byDi.delete(di);
    const current = byKey.get(planeElementKey(entry.planeDi, di, now(entry.id)));
    if (current) {
      snapshot.byDi.set(current, { ...entry, planeDi: current.parent });
    }
  }
  for (const [id, element] of [...snapshot.els]) {
    snapshot.els.set(id, elementNow(element));
  }
  for (const [group, name] of [...snapshot.groupNames]) {
    snapshot.groupNames.delete(group);
    snapshot.groupNames.set(elementNow(group), name);
  }
  snapshot.stickies = snapshot.stickies.map((sticky) => ({ ...sticky, process: elementNow(sticky.process), node: elementNow(sticky.node) }));
  return snapshot;
}

function undoExpansionHints(snapshot, { expand, collapse }) {
  const requested = new Set([...expand, ...collapse]);
  for (const [di, { id, expanded }] of snapshot.byDi) {
    if (expanded !== undefined && requested.has(snapshot.currentId(id))) {
      di.set('isExpanded', expanded);
    }
  }
  return snapshot;
}

async function afterModelOperations(drawing, step) {
  const reader = new drawing.DocumentReader();
  const document = await reader.read(step.noLayout.file);
  const before = drawing.DrawingSnapshot.of(await reader.read(step.before));
  const snapshot = undoExpansionHints(rebased(before, document, step.noLayout.renamed), step.noLayout);
  return { document, snapshot, changes: changesOf(drawing, step.noLayout) };
}

async function onFileBefore(drawing, step) {
  const document = await new drawing.DocumentReader().read(step.before);
  return { document, snapshot: drawing.DrawingSnapshot.of(document), changes: new drawing.ChangeSet() };
}

function subjectOf(drawing) {
  const { DiagramDrawing, DocumentReader, DocumentWriter, DrawingSnapshot, ChangeSet } = drawing;
  return {
    layout: (xml) => attempt(async () => {
      const document = await new DocumentReader().read(xml);
      await new DiagramDrawing(document).update(DrawingSnapshot.of(document), new ChangeSet(), [{ op: 'layout' }]);
      return { xml: await new DocumentWriter().plain(document) };
    }),
    walkStep: (step) => attempt(async () => {
      const operations = await drawnOperations(drawing, step);
      if (!operations) {
        return { skipped: 'selects by kind, which 1.0 leaves to find' };
      }
      const { document, snapshot, changes } = await (step.noLayout ? afterModelOperations(drawing, step) : onFileBefore(drawing, step));
      await new DiagramDrawing(document).update(snapshot, changes, operations);
      return { xml: await new DocumentWriter().plain(document) };
    }),
  };
}

export default {
  name: 'drawing',
  describes: "DiagramDrawing without edit: the 115 scenarios drawn in full, each walk step's model operations placed from its layout: false file, each walk step of drawing operations run on its file before",
  probes: ['layout'],
  async open() {
    return subjectOf(await loadDrawing());
  },
};
