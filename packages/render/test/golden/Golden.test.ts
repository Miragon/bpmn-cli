import { describe, expect, it } from 'vitest';
import { DiagramRenderer, type SvgOptions } from '../../src/index.js';
import { CorpusModel } from './CorpusModel.js';

const GOLDEN: Array<[name: string, model: string, options?: SvgOptions]> = [
  ['gallery', 'models/render/gallery.bpmn'],
  ['gallery-collapsed', 'models/render/gallery.bpmn', { plane: 'Activity_CollapsedSubProcess' }],
  ['gallery-adhoc', 'models/render/gallery.bpmn', { plane: 'Activity_AdHocSubProcess' }],
  ['gallery-fit', 'models/render/gallery.bpmn', { fit: ['Activity_InnerTask', 'Event_InnerStart'] }],
  ['gallery-badges', 'models/render/gallery.bpmn', { badges: [{ n: 1, ids: ['Gateway_WhichPath'] }, { n: 2, ids: ['Gateway_WhichPath'] }, { n: 12, ids: ['Flow_WhichPathToRejected'] }] }],
  ['gallery-small', 'models/render/gallery.bpmn', { maxSize: 800 }],
  ['long', 'models/render/long.bpmn'],
  ['long-scaled', 'models/render/long.bpmn', { scale: 0.5 }],
  ['styled', 'models/roundtrip/styled.bpmn'],
  ['orders-colours', 'models/incremental/orders.bpmn'],
  ['vertical-lanes', 'models/incremental/vertical.bpmn'],
  ['two-views', 'models/incremental/twoviews.bpmn'],
  ['pool', 'models/incremental/pool.bpmn'],
  ['two-pools', 'models/step1/two-pools.bpmn'],
  ['lane-sub-process', 'models/incremental/lanesub.bpmn'],
  ['nested', 'models/step1/nested.bpmn'],
  ['groups', 'models/incremental/groups.bpmn'],
  ['collaboration-note', 'models/incremental/collabnote.bpmn'],
  ['diagonal-association', 'models/step1/diagonal-assoc.bpmn'],
  ['broken-coordinates', 'models/incremental/nan.bpmn'],
];

describe('golden SVGs', () => {
  it.each(GOLDEN)('%s keeps its bytes', async (name, model, options) => {
    const diagram = await DiagramRenderer.fromXml(CorpusModel.xml(model));
    await expect(diagram.svg(options).svg).toMatchFileSnapshot(`${name}.svg`);
  });
});
