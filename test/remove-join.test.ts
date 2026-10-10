/**
 * Audit #53: a plain `remove` of a join or merge (several incoming flows,
 * one outgoing) disconnected everything after it and flooded the output with
 * W_UNREACHABLE. Now a merge that does not synchronise (exclusive or
 * event-based gateway, any other node) is bridged from every predecessor
 * like `--bridge-all`; a synchronising join (parallel, inclusive, complex)
 * is refused with E_AMBIGUOUS_BRIDGE naming `--bridge-all` and `--no-bridge`
 * for it. Synthetic models only.
 */
import { describe, expect, it } from 'vitest';
import { applyToXml } from '../src/api.js';
import { CliError } from '../src/errors.js';
import { Doc } from '../src/document.js';
import { runOps } from '../src/ops/index.js';
import { definitionsXml } from './helpers.js';

/** Nodes `[tag, id, extra attrs]` and flows `[id, source, target]` (incoming / outgoing written). */
function model(nodes: Array<[string, string, string?]>, flows: Array<[string, string, string]>): string {
  const body = nodes.map(([tag, id, attrs]) => {
    const links = [...flows.filter((f) => f[2] === id).map((f) => `<bpmn:incoming>${f[0]}</bpmn:incoming>`), ...flows.filter((f) => f[1] === id).map((f) => `<bpmn:outgoing>${f[0]}</bpmn:outgoing>`)];
    return `<bpmn:${tag} id="${id}"${attrs ? ` ${attrs}` : ''}>${links.join('')}</bpmn:${tag}>`;
  });
  for (const [id, s, t] of flows) body.push(`<bpmn:sequenceFlow id="${id}" sourceRef="${s}" targetRef="${t}" />`);
  return definitionsXml(body.join('\n'));
}

/** S -> G (split) -> B1 -> J (join) -> C -> E; G -> D1 -> J. `split` / `join` name the gateway tags. */
const block = (split: string, join: string): string =>
  model(
    [
      ['startEvent', 'S'],
      [split, 'G'],
      ['task', 'B1', 'name="B one"'],
      ['task', 'D1', 'name="D one"'],
      [join, 'J'],
      ['task', 'C', 'name="C"'],
      ['endEvent', 'E'],
    ],
    [
      ['F1', 'S', 'G'],
      ['F2', 'G', 'B1'],
      ['F3', 'B1', 'J'],
      ['F4', 'G', 'D1'],
      ['F5', 'D1', 'J'],
      ['F6', 'J', 'C'],
      ['F7', 'C', 'E'],
    ],
  );

function failure(fn: () => unknown): CliError {
  try {
    fn();
  } catch (err) {
    if (err instanceof CliError) return err;
    throw err;
  }
  throw new Error('expected a failure');
}

const targetOf = (doc: Doc, id: string): string[] => doc.outgoing(doc.require(id)).map((f) => f.get<{ id: string }>('targetRef').id);

describe('a plain remove of a join or merge (audit #53)', () => {
  it('an exclusive merge is bridged from every predecessor, like --bridge-all; nothing after it is cut off', async () => {
    const xml = block('exclusiveGateway', 'exclusiveGateway');
    const doc = await Doc.fromXml(xml);
    const cs = runOps(doc, [{ op: 'remove', ids: ['J'] }]);
    expect([targetOf(doc, 'B1'), targetOf(doc, 'D1')]).toEqual([['C'], ['C']]);
    expect(cs.removed.map((r) => r.id)).toEqual(['F6', 'J']);
    expect(cs.notes).toContain('bridged all: B1, D1 -> C');
    const r = await applyToXml(xml, [{ op: 'remove', ids: ['J'] }], { layout: false });
    expect(r.result.warnings.added.map((w) => w.code)).not.toContain('W_UNREACHABLE');
    expect(r.result.warnings.added.map((w) => `${w.code} ${w.element}`)).toContain('W_IMPLICIT_JOIN C');
  });

  it('a task with two incoming flows (an implicit merge) is bridged the same way', async () => {
    const xml = model(
      [
        ['startEvent', 'S'],
        ['exclusiveGateway', 'G'],
        ['task', 'A'],
        ['task', 'M', 'name="Merge here"'],
        ['endEvent', 'E'],
      ],
      [
        ['F1', 'S', 'G'],
        ['F2', 'G', 'A'],
        ['F3', 'A', 'M'],
        ['F4', 'G', 'M'],
        ['F5', 'M', 'E'],
      ],
    );
    const doc = await Doc.fromXml(xml);
    runOps(doc, [{ op: 'remove', ids: ['M'] }]);
    expect([targetOf(doc, 'A'), targetOf(doc, 'G')]).toEqual([['E'], ['A', 'E']]);
  });

  it('a parallel or inclusive join is refused with the two exact commands; --bridge-all and --no-bridge say which', async () => {
    for (const [tag, kind] of [
      ['parallelGateway', 'parallel'],
      ['inclusiveGateway', 'inclusive'],
    ] as const) {
      const xml = block(tag, tag);
      const doc = await Doc.fromXml(xml);
      const e = failure(() => runOps(doc, [{ op: 'remove', ids: ['J'] }]));
      expect(e.code).toBe('E_AMBIGUOUS_BRIDGE');
      expect(e.message).toBe(`J is a ${kind} join of 2 paths (B1, D1): bridging them to C ends the synchronisation (C would run once per path), removing it without a bridge leaves C unconnected`);
      expect(e.details.hint).toBe('Say which: `bpmn remove <file> J --bridge-all` (each path runs on to C on its own), or `bpmn remove <file> J --no-bridge` and connect what should stay with `bpmn connect`.');
      expect(e.details.candidates).toEqual(['F3', 'F5']);
      const all = await Doc.fromXml(xml);
      runOps(all, [{ op: 'remove', ids: ['J'], bridgeAll: true }]);
      expect([targetOf(all, 'B1'), targetOf(all, 'D1')]).toEqual([['C'], ['C']]);
      const none = await Doc.fromXml(xml);
      runOps(none, [{ op: 'remove', ids: ['J'], bridge: false }]);
      expect([targetOf(none, 'B1'), none.incoming(none.require('C')).length]).toEqual([[], 0]);
    }
  });

  it('a split, a node without an outgoing flow and a 1:1 node keep their rules', async () => {
    const xml = block('exclusiveGateway', 'exclusiveGateway');
    // a split (one incoming, two outgoing) is not bridged: its branches lose their entry
    const split = await Doc.fromXml(xml);
    runOps(split, [{ op: 'remove', ids: ['G'] }]);
    expect([split.incoming(split.require('B1')).length, targetOf(split, 'S')]).toEqual([0, []]);
    // an end event with two incoming flows just goes
    const ends = model(
      [
        ['startEvent', 'S'],
        ['exclusiveGateway', 'G'],
        ['endEvent', 'E'],
      ],
      [
        ['F1', 'S', 'G'],
        ['F2', 'G', 'E'],
        ['F3', 'G', 'E'],
      ],
    );
    const end = await Doc.fromXml(ends);
    expect(runOps(end, [{ op: 'remove', ids: ['E'] }]).removed.map((r) => r.id)).toEqual(['F2', 'F3', 'E']);
    // a 1:1 node: the ordinary bridge
    const one = await Doc.fromXml(xml);
    expect(runOps(one, [{ op: 'remove', ids: ['C'] }]).notes).toContain('bridged: J -> E');
  });
});
