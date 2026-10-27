/**
 * `remove --with-branch` (a node or boundary event with its exclusive
 * downstream path) and `remove --bridge-all` (a join: every predecessor to
 * the successor). Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml } from '../../../src/api.js';
import { Doc } from '../../../src/domain/document/Doc.js';
import { runOps } from '../../../src/index.js';
import { definitionsXml } from '../../helpers/helpers.js';
import { ElementRemovalService } from '../../../src/domain/editing/ElementRemovalService.js';
import { EditContext } from '../../../src/domain/document/EditContext.js';
import { failure } from '../../helpers/errors.js';

/** Nodes `[tag, id, extra attrs]` and flows `[id, source, target]` (incoming / outgoing written). */
function model(nodes: Array<[string, string, string?]>, flows: Array<[string, string, string]>, extra = ''): string {
  const body = nodes.map(([tag, id, attrs]) => {
    const links = [...flows.filter((flow) => flow[2] === id).map((flow) => `<bpmn:incoming>${flow[0]}</bpmn:incoming>`), ...flows.filter((flow) => flow[1] === id).map((flow) => `<bpmn:outgoing>${flow[0]}</bpmn:outgoing>`)];
    return `<bpmn:${tag} id="${id}"${attrs ? ` ${attrs}` : ''}>${links.join('')}</bpmn:${tag}>`;
  });
  for (const [id, source, target] of flows) body.push(`<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`);
  return definitionsXml(body.join('\n') + extra);
}

/** S -> A -> G (split) -> B1 -> B2 -> J (join) -> C -> E; G -> D1 -> J; a timer on A -> T1 -> ET. */
const SPLIT = model(
  [
    ['startEvent', 'S'],
    ['task', 'A', 'name="A"'],
    ['exclusiveGateway', 'G', 'name="Ok?"'],
    ['task', 'B1', 'name="B1"'],
    ['task', 'B2', 'name="B2"'],
    ['task', 'D1', 'name="D1"'],
    ['exclusiveGateway', 'J'],
    ['task', 'C', 'name="C"'],
    ['endEvent', 'E', 'name="E"'],
    ['boundaryEvent', 'T', 'attachedToRef="A"><bpmn:timerEventDefinition id="TD" /'],
    ['task', 'T1', 'name="T1"'],
    ['endEvent', 'ET', 'name="ET"'],
  ],
  [
    ['F1', 'S', 'A'],
    ['F2', 'A', 'G'],
    ['F3', 'G', 'B1'],
    ['F4', 'B1', 'B2'],
    ['F5', 'B2', 'J'],
    ['F6', 'G', 'D1'],
    ['F7', 'D1', 'J'],
    ['F8', 'J', 'C'],
    ['F9', 'C', 'E'],
    ['F10', 'T', 'T1'],
    ['F11', 'T1', 'ET'],
  ],
);

async function removed(xml: string, ids: string[], opts: { withBranch?: boolean; bridgeAll?: boolean } = {}): Promise<{ doc: Doc; removed: string[]; notes: string[]; warnings: string[]; changed: string[] }> {
  const doc = await Doc.fromXml(xml);
  const cs = runOps(doc, [{ op: 'remove', ids, ...opts }]);
  return { doc, removed: cs.removed.map((change) => change.id), notes: cs.notes, warnings: cs.warnings.map((warning) => `${warning.code} ${warning.element}`), changed: cs.changed.map((change) => `${change.id}: ${change.detail}`) };
}

describe('remove --with-branch', () => {
  it('a boundary event goes with its exception path up to its end', async () => {
    const outcome = await removed(SPLIT, ['T'], { withBranch: true });
    expect(outcome.removed.filter((id) => !id.startsWith('F'))).toEqual(['T', 'TD', 'T1', 'ET']);
    expect(outcome.notes[0]).toBe('branch of T: 3 node(s) (T, T1, ET); it ends there');
    expect(['A', 'C', 'E'].every((id) => outcome.doc.has(id))).toBe(true);
  });

  it('a branch of a split goes up to the join another branch reaches; the join stays', async () => {
    const outcome = await removed(SPLIT, ['B1'], { withBranch: true });
    expect(outcome.removed.filter((id) => !id.startsWith('F'))).toEqual(['B1', 'B2']);
    expect(outcome.removed.filter((id) => id.startsWith('F')).sort()).toEqual(['F3', 'F4', 'F5']);
    expect(outcome.notes[0]).toBe('branch of B1: 2 node(s) (B1, B2); it stops before J, which other paths reach (they stay)');
    expect(outcome.doc.incoming(outcome.doc.require('J')).map((flow) => flow.get('id'))).toEqual(['F7']);
  });

  it('the downstream of a split goes with it (a join only its branches reach included); a host takes its boundary path along', async () => {
    const outcome = await removed(SPLIT, ['G'], { withBranch: true });
    expect(outcome.removed.filter((id) => !id.startsWith('F'))).toEqual(['G', 'B1', 'B2', 'D1', 'J', 'C', 'E']);
    const host = await removed(SPLIT, ['A'], { withBranch: true });
    expect(host.removed.filter((id) => !id.startsWith('F')).sort()).toEqual(['A', 'B1', 'B2', 'C', 'D1', 'E', 'ET', 'G', 'J', 'T', 'T1', 'TD']);
    expect(host.doc.has('S')).toBe(true);
  });

  it('a loop back stops the branch; a node several paths reach is refused', async () => {
    const loop = model(
      [
        ['startEvent', 'S'],
        ['task', 'A'],
        ['task', 'B'],
        ['exclusiveGateway', 'X'],
        ['endEvent', 'E'],
      ],
      [
        ['F1', 'S', 'A'],
        ['F2', 'A', 'B'],
        ['F3', 'B', 'X'],
        ['F4', 'X', 'A'],
        ['F5', 'X', 'E'],
      ],
    );
    const outcome = await removed(loop, ['B'], { withBranch: true });
    expect(outcome.removed.filter((id) => !id.startsWith('F'))).toEqual(['B', 'X', 'E']);
    expect(outcome.notes[0]).toMatch(/stops before A, which other paths reach/);
    const doc = await Doc.fromXml(SPLIT);
    const error = failure(() => runOps(doc, [{ op: 'remove', ids: ['J'], withBranch: true }]));
    expect([error.code, error.message]).toEqual(['E_AMBIGUOUS_BRANCH', 'J is reached by 2 paths (B2, D1); its downstream is not the branch of one path']);
    expect(error.details.hint).toMatch(/--bridge-all/);
    expect(doc.has('J')).toBe(true);
  });

  it('a compensation handler only its boundary event points to goes along', async () => {
    const xml = model(
      [
        ['startEvent', 'S'],
        ['task', 'A'],
        ['endEvent', 'E'],
        ['boundaryEvent', 'CB', 'attachedToRef="A"><bpmn:compensateEventDefinition id="CD" /'],
        ['task', 'H', 'isForCompensation="true"'],
      ],
      [
        ['F1', 'S', 'A'],
        ['F2', 'A', 'E'],
      ],
      '<bpmn:association id="AS" associationDirection="One" sourceRef="CB" targetRef="H" />',
    );
    const outcome = await removed(xml, ['CB'], { withBranch: true });
    expect(outcome.removed).toEqual(expect.arrayContaining(['CB', 'H', 'AS']));
    expect(outcome.doc.has('A')).toBe(true);
  });

  it('is an op of apply and a flag of the CLI; contradicting options are refused', async () => {
    const outcome = await applyToXml(SPLIT, [{ op: 'remove', ids: ['T'], withBranch: true }]);
    expect(outcome.result.removed.map((change) => change.id)).toContain('ET');
    const doc = await Doc.fromXml(SPLIT);
    expect(failure(() => runOps(doc, [{ op: 'remove', ids: ['T'], withBranch: true, bridge: false }])).message).toMatch(/drop --no-bridge/);
    expect(failure(() => runOps(doc, [{ op: 'remove', ids: ['J'], bridgeAll: true, bridge: false }])).message).toBe('--bridge-all and --no-bridge contradict each other');
  });

  it('branchOf reports the stops in document order', async () => {
    const doc = await Doc.fromXml(SPLIT);
    const branch = new ElementRemovalService(doc, new EditContext(doc)).branchOf(doc.require('D1'));
    expect(branch.nodes.map((node) => node.get('id'))).toEqual(['D1']);
    expect(branch.stops.map((node) => node.get('id'))).toEqual(['J']);
  });
});

describe('remove --bridge-all', () => {
  it('a join: every predecessor flows on to the successor (no duplicates, the flow ids that named their ends follow)', async () => {
    const outcome = await removed(SPLIT, ['J'], { bridgeAll: true });
    expect(outcome.removed).toEqual(['F8', 'J']);
    expect(outcome.changed).toEqual(['F5: B2 -> C (bridged J)', 'F7: D1 -> C (bridged J)']);
    expect(outcome.notes).toContain('bridged all: B2, D1 -> C');
    expect(outcome.warnings).toContain('W_IMPLICIT_JOIN C');
    // a flow whose id names its ends in the file's style (F_B2ToJ: the file's flows are F<n>) follows them
    const named = await removed(SPLIT.replace(/"F5"/g, '"F_B2ToJ"').replace(/>F5</g, '>F_B2ToJ<'), ['J'], { bridgeAll: true });
    expect(named.changed).toEqual(['F_B2ToC: B2 -> C (bridged J) (renamed from F_B2ToJ: its id named its old ends)', 'F7: D1 -> C (bridged J)']);
  });

  it('a parallel join loses its synchronisation: the warning says so', async () => {
    const outcome = await removed(SPLIT.replace('<bpmn:exclusiveGateway id="J">', '<bpmn:parallelGateway id="J">').replace(/<\/bpmn:exclusiveGateway>(\s*<bpmn:task id="C")/, '</bpmn:parallelGateway>$1'), ['J'], { bridgeAll: true });
    expect(outcome.warnings).toContain('W_IMPLICIT_JOIN C');
  });

  it('a split is refused (which predecessor to which successor?); one incoming flow is the ordinary bridge', async () => {
    const doc = await Doc.fromXml(SPLIT);
    const error = failure(() => runOps(doc, [{ op: 'remove', ids: ['G'], bridgeAll: true }]));
    expect([error.code, error.details.candidates]).toEqual(['E_AMBIGUOUS_BRIDGE', ['F3', 'F6']]);
    const outcome = await removed(SPLIT, ['C'], { bridgeAll: true });
    expect(outcome.changed).toEqual(['F8: J -> E (bridged C)']);
  });

  it('a predecessor that already flows to the successor gets no second flow', async () => {
    const xml = model(
      [
        ['startEvent', 'S'],
        ['exclusiveGateway', 'G'],
        ['task', 'A'],
        ['exclusiveGateway', 'J'],
        ['endEvent', 'E'],
      ],
      [
        ['F1', 'S', 'G'],
        ['F2', 'G', 'A'],
        ['F3', 'A', 'J'],
        ['F4', 'G', 'J'],
        ['F5', 'J', 'E'],
        ['F6', 'G', 'E'],
      ],
    );
    const outcome = await removed(xml, ['J'], { bridgeAll: true });
    expect(outcome.notes).toContain('not bridged: G already flows to E');
    expect(outcome.doc.outgoing(outcome.doc.require('G')).map((flow) => flow.get('id'))).toEqual(['F2', 'F6']);
    expect(outcome.doc.outgoing(outcome.doc.require('A')).map((flow) => flow.get<{ id: string }>('targetRef').id)).toEqual(['E']);
  });
});
