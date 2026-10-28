import { Doc } from '../../src/domain/document/Doc.js';
import type { CliUseCases } from '../../src/adapters/in/cli/Cli.js';
import { BpmnlintProjectSettings } from '../../src/adapters/out/files/BpmnlintProjectSettings.js';
import { FileDocumentStore } from '../../src/adapters/out/files/FileDocumentStore.js';
import { FileImageWriter } from '../../src/adapters/out/files/FileImageWriter.js';
import { EditDocumentService } from '../../src/application/service/EditDocumentService.js';
import { CreateDocumentService } from '../../src/application/service/CreateDocumentService.js';
import { RelayoutDiagramService } from '../../src/application/service/RelayoutDiagramService.js';
import { ValidateDocumentService } from '../../src/application/service/ValidateDocumentService.js';
import { ReadDocumentService } from '../../src/application/service/ReadDocumentService.js';
import { ShowConventionsService } from '../../src/application/service/ShowConventionsService.js';
import { RenderDiagramService } from '../../src/application/service/RenderDiagramService.js';
import { ShowModelService } from '../../src/application/service/ShowModelService.js';
import { FindElementsService } from '../../src/application/service/FindElementsService.js';
import { AnalyzeLayoutService } from '../../src/application/service/AnalyzeLayoutService.js';
import { RunCommandsService } from '../../src/application/service/RunCommandsService.js';

const files = new FileDocumentStore();
const project = new BpmnlintProjectSettings();

/** The use cases on the file system, as src/cli.ts wires them. */
export const FILE_USE_CASES: CliUseCases = {
  editDocument: new EditDocumentService(project, files),
  createDocument: new CreateDocumentService(project, files),
  relayoutDiagram: new RelayoutDiagramService(project, files),
  validateDocument: new ValidateDocumentService(project, files),
  readDocument: new ReadDocumentService(files),
  showModel: new ShowModelService(),
  showConventions: new ShowConventionsService(project),
  findElements: new FindElementsService(),
  analyzeLayout: new AnalyzeLayoutService(),
  runCommands: new RunCommandsService(),
  renderDiagram: new RenderDiagramService(files, new FileImageWriter()),
};

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
