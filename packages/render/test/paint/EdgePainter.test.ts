import { describe, expect, it } from 'vitest';
import { EdgePainter } from '../../src/paint/EdgePainter.js';
import { CorpusModel } from '../golden/CorpusModel.js';

describe('EdgePainter', () => {
  const gallery = 'models/render/gallery.bpmn';
  const edges = '../packages/render/test/golden/fixtures/edges.bpmn';
  const painterOf = async (id: string, path = gallery): Promise<EdgePainter> => new EdgePainter(await CorpusModel.edge(path, id));

  it('ends a sequence flow in a filled arrow', async () => {
    expect((await painterOf('Flow_TwoDaysToTimedOut')).svg()).toContain('fill="#22242a" stroke="#22242a" stroke-width="1"');
  });

  it('slashes the default flow of a gateway', async () => {
    const svg = (await painterOf('Flow_WhichPathToRejected')).svg();
    expect(svg.match(/<path/g)).toHaveLength(3);
  });

  it('puts a diamond on a conditional flow out of a task', async () => {
    expect((await painterOf('Flow_Conditional', edges)).svg()).toContain('fill="#ffffff" stroke="#22242a" stroke-width="1.2"');
  });

  it('dashes a message flow and gives it a circle and a white arrow', async () => {
    const svg = (await painterOf('Flow_SendTaskToPartner')).svg();
    expect(svg).toContain('stroke-dasharray="10 6"');
    expect(svg).toContain('r="4"');
    expect(svg).toContain('fill="#ffffff" stroke="#22242a" stroke-width="1"');
  });

  it('draws the envelope of a message flow and sizes its box to hold it', async () => {
    const painter = await painterOf('Flow_Envelope', edges);
    expect(painter.svg()).toContain('data-message="Flow_Envelope"');
    expect(painter.box().height).toBeGreaterThanOrEqual(14);
    expect(painter.messageLabel()?.svg).toContain('Invoice');
  });

  it('fills the envelope of a non-initiating message', async () => {
    expect((await painterOf('Flow_Envelope', edges)).svg()).toContain('fill="#22242a" stroke="#ffffff"');
    expect((await painterOf('Flow_Initiating', edges)).svg()).toContain('fill="#ffffff" stroke="#22242a" stroke-width="1" stroke-linejoin');
  });

  it('dots a data association and ends it in an open arrow', async () => {
    const svg = (await painterOf('DataOutputAssociation_UserTaskToOrder')).svg();
    expect(svg).toContain('stroke-dasharray="0.5 4.5"');
    expect(svg).toContain('stroke-linecap="round"');
  });

  it('draws arrows on an association as its direction says', async () => {
    expect((await painterOf('Association_UndoToCompensation')).svg().match(/<path/g)).toHaveLength(2);
    expect((await painterOf('Association_Both', edges)).svg().match(/<path/g)).toHaveLength(3);
    expect((await painterOf('Association_None', edges)).svg().match(/<path/g)).toHaveLength(1);
  });

  it('rounds the corner of a flow with a quadratic curve, and leaves a tiny corner sharp', async () => {
    expect((await painterOf('Flow_Corner', edges)).svg()).toContain('Q');
    expect((await painterOf('Flow_Tiny', edges)).svg()).not.toContain('Q');
  });

  it('labels a flow at its DI bounds', async () => {
    const edge = await CorpusModel.edge(edges, 'Flow_Corner');
    expect(new EdgePainter(edge).label()?.box.y).toBe(Math.round(edge.label!.y));
  });

  it('puts a label without bounds above a horizontal middle segment and beside a vertical one', async () => {
    const horizontal = (await painterOf('Flow_Conditional', edges)).label();
    const vertical = (await painterOf('Flow_Tiny', edges)).label();
    expect(horizontal?.svg).toContain('Yes');
    expect(vertical?.svg).toContain('No');
  });

  it('gives an association no label, and a flow without a name none', async () => {
    expect((await painterOf('Association_UndoToCompensation')).label()).toBeUndefined();
    expect((await painterOf('Flow_SendTaskToPartner')).messageLabel()).toBeUndefined();
    expect((await painterOf('Flow_Both', edges)).label()).toBeUndefined();
  });

  it('draws an edge that points nowhere without an arrow', async () => {
    expect((await painterOf('Flow_Both', edges)).svg().match(/<path/g)).toHaveLength(1);
  });
});
