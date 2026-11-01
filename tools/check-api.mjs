import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Extractor, ExtractorConfig, ExtractorLogLevel } from '@microsoft/api-extractor';

const ROOT = resolve('.');
const WORK = join(ROOT, '.api');
const UPDATE_REPORTS = process.argv.includes('--update');
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const ENTRIES = [
  { report: 'bpmn-cli', packageFolder: '.', declaration: 'src/index.d.ts' },
  { report: 'bpmn-render', packageFolder: 'packages/render', declaration: 'packages/render/src/index.d.ts' },
  { report: 'bpmn-render-png', packageFolder: 'packages/render', declaration: 'packages/render/src/png/index.d.ts' },
  { report: 'bpmn-render-png-node', packageFolder: 'packages/render', declaration: 'packages/render/src/png/node/index.d.ts' },
  { report: 'bpmn-render-text', packageFolder: 'packages/render', declaration: 'packages/render/src/text/index.d.ts' },
  { report: 'bpmn-lint', packageFolder: 'packages/lint', declaration: 'packages/lint/src/index.d.ts' },
];
const SILENT = { logLevel: ExtractorLogLevel.None };
const FATAL = { logLevel: ExtractorLogLevel.Error };

function emitDeclarations() {
  rmSync(WORK, { recursive: true, force: true });
  const { status } = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.api.json'], { cwd: ROOT, stdio: 'inherit' });
  if (status !== 0) {
    process.exit(status ?? 1);
  }
}

function configOf({ report, packageFolder, declaration }) {
  const reportTempFolder = join(WORK, 'reports');
  mkdirSync(reportTempFolder, { recursive: true });
  return ExtractorConfig.prepare({
    configObject: {
      projectFolder: ROOT,
      mainEntryPointFilePath: join(WORK, 'types', declaration),
      bundledPackages: ['@miragon/bpmn-render'],
      newlineKind: 'lf',
      compiler: { tsconfigFilePath: join(ROOT, 'tsconfig.api.json') },
      apiReport: { enabled: true, reportFileName: `${report}.api.md`, reportFolder: join(ROOT, packageFolder, 'api-report'), reportTempFolder },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      messages: {
        compilerMessageReporting: { default: FATAL },
        extractorMessageReporting: { default: SILENT, 'ae-forgotten-export': FATAL },
        tsdocMessageReporting: { default: SILENT },
      },
    },
    packageJsonFullPath: join(ROOT, packageFolder, 'package.json'),
  });
}

function extract(entry) {
  mkdirSync(join(ROOT, entry.packageFolder, 'api-report'), { recursive: true });
  const result = Extractor.invoke(configOf(entry), { localBuild: UPDATE_REPORTS });
  if (!result.succeeded) {
    console.error(`api: ${entry.report} changed its public API or broke a rule; run npm run api:update and commit the report if the change is meant`);
  }
  return result.succeeded;
}

emitDeclarations();
const results = ENTRIES.map(extract);
if (results.includes(false)) {
  process.exit(1);
}
console.log(`api: ${ENTRIES.length} reports match`);
