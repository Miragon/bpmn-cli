import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Extractor, ExtractorConfig } from '@microsoft/api-extractor';
import { build } from 'esbuild';
import { bundlesOf } from './bundles.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DIST = join(ROOT, 'dist');
const DECLARATIONS = join(ROOT, '.api', 'build');
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

function emitDeclarations() {
  rmSync(DECLARATIONS, { recursive: true, force: true });
  const { status } = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.api.json', '--outDir', DECLARATIONS], { cwd: ROOT, stdio: 'inherit' });
  if (status !== 0) {
    process.exit(status ?? 1);
  }
}

function rollUpDeclarations() {
  const config = ExtractorConfig.prepare({
    configObject: {
      projectFolder: ROOT,
      mainEntryPointFilePath: join(DECLARATIONS, 'src', 'index.d.ts'),
      bundledPackages: ['@miragon/bpmn-render'],
      newlineKind: 'lf',
      compiler: { tsconfigFilePath: join(ROOT, 'tsconfig.api.json') },
      apiReport: { enabled: false },
      docModel: { enabled: false },
      dtsRollup: { enabled: true, untrimmedFilePath: join(DIST, 'index.d.ts') },
      tsdocMetadata: { enabled: false },
      messages: { extractorMessageReporting: { default: { logLevel: 'none' } }, tsdocMessageReporting: { default: { logLevel: 'none' } } },
    },
    packageJsonFullPath: join(ROOT, 'package.json'),
  });
  const { succeeded } = Extractor.invoke(config, { localBuild: true, messageCallback: (message) => { message.handled = message.logLevel !== 'error'; } });
  if (!succeeded) {
    process.exit(1);
  }
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
const { library, cli } = bundlesOf(ROOT);
await Promise.all([build(library), build(cli)]);
emitDeclarations();
rollUpDeclarations();
