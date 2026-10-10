import { Doc } from '../src/document.js';

export const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

/** Wraps process XML body into a full definitions document (no DI). */
export function definitionsXml(processBody: string, opts: { processId?: string; extraRoots?: string; nsDecl?: string } = {}): string {
  const id = opts.processId ?? 'Process_1';
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="${BPMN_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${opts.nsDecl ?? ''} id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${id}" isExecutable="true">
${processBody}
  </bpmn:process>
${opts.extraRoots ?? ''}
</bpmn:definitions>`;
}

/** start -> task -> end, with incoming/outgoing maintained. */
export const LINEAR = definitionsXml(`
    <bpmn:startEvent id="Start" name="Started"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Task_A" name="Do A"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="End" name="Done"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Task_A" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_A" targetRef="End" />`);

export async function docFromXml(xml: string): Promise<Doc> {
  return Doc.fromXml(xml);
}

export async function linearDoc(): Promise<Doc> {
  return docFromXml(LINEAR);
}

/** The id of the sequence / message flow from `source` to `target`. */
export function flowBetween(doc: Doc, source: string, target: string): string {
  for (const el of doc.byId().values()) {
    if (el.$type !== 'bpmn:SequenceFlow' && el.$type !== 'bpmn:MessageFlow') continue;
    if (el.get<{ id: string } | undefined>('sourceRef')?.id === source && el.get<{ id: string } | undefined>('targetRef')?.id === target) return el.get<string>('id');
  }
  throw new Error(`no flow ${source} -> ${target}`);
}
