#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Cli } from './adapters/in/cli/Cli.js';
import { BpmnlintProjectSettings } from './adapters/out/files/BpmnlintProjectSettings.js';
import { FileDocumentStore } from './adapters/out/files/FileDocumentStore.js';
import { FileImageWriter } from './adapters/out/files/FileImageWriter.js';
import { EditDocumentService } from './application/service/EditDocumentService.js';
import { CreateDocumentService } from './application/service/CreateDocumentService.js';
import { RelayoutDiagramService } from './application/service/RelayoutDiagramService.js';
import { ValidateDocumentService } from './application/service/ValidateDocumentService.js';
import { ReadDocumentService } from './application/service/ReadDocumentService.js';
import { ShowModelService } from './application/service/ShowModelService.js';
import { ShowConventionsService } from './application/service/ShowConventionsService.js';
import { FindElementsService } from './application/service/FindElementsService.js';
import { RenderDiagramService } from './application/service/RenderDiagramService.js';
import { LayoutDebug } from './domain/diagram/layout/LayoutDebug.js';

// dist/cli.js and src/cli.ts both sit one level below package.json
const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

if (process.env['BPMN_LAYOUT_DEBUG']) LayoutDebug.setProcessSink((line) => process.stderr.write(`${line}\n`));

// a reader that closes early (`bpmn validate x.bpmn | head`) ends the output, not the command
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err;
  });
}

/**
 * Exiting right away cuts off a pipe beyond 64 KB on macOS; waiting for an empty event loop
 * hangs on a timer a project plugin left.
 */
function exitWhenWritten(): void {
  process.stdout.write('', () => process.stderr.write('', () => process.exit()));
}

const files = new FileDocumentStore();
const project = new BpmnlintProjectSettings();
const cli = new Cli(VERSION, {
  editDocument: new EditDocumentService(files, files, project),
  createDocument: new CreateDocumentService(files, project),
  relayoutDiagram: new RelayoutDiagramService(files, files, project),
  validateDocument: new ValidateDocumentService(files, project),
  readDocument: new ReadDocumentService(files),
  showModel: new ShowModelService(),
  showConventions: new ShowConventionsService(project),
  findElements: new FindElementsService(),
  renderDiagram: new RenderDiagramService(files, new FileImageWriter()),
});
void cli.run(process.argv).then(() => {
  process.exitCode = cli.exitCode;
  exitWhenWritten();
});
