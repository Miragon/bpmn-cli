import { projectFiles } from 'archunit';
import { describe, expect, it } from 'vitest';

const ENTRIES = /^src\/(api|cli|index|node)\.ts$/;
const ADAPTERS = ['in/cli', 'in/report', 'out/bpmnlint', 'out/document', 'out/files', 'out/memory', 'out/render'];
const ADAPTER_USES: Record<string, string[]> = { 'in/cli': ['in/report'], 'out/files': ['out/bpmnlint', 'out/document'], 'out/memory': ['out/document'] };

const FORBIDDEN_LAYER_ACCESS: Record<string, string[]> = {
  'src/domain/**': ['src/application/**', 'src/adapters/**'],
  'src/application/**': ['src/adapters/**'],
  'src/adapters/in/**': ['src/application/service/**'],
};

describe('architecture', () => {
  for (const [layer, forbiddenLayers] of Object.entries(FORBIDDEN_LAYER_ACCESS)) {
    it(`${layer} depends on no outer layer`, async () => {
      for (const forbidden of forbiddenLayers) await expect(projectFiles().inFolder(layer).shouldNot().dependOnFiles().inFolder(forbidden)).toPassAsync();
      await expect(projectFiles().inFolder(layer).shouldNot().dependOnFiles().inPath(ENTRIES)).toPassAsync();
    });
  }

  for (const adapter of ADAPTERS) {
    it(`adapters/${adapter} uses only the adapters it is allowed to`, async () => {
      const forbidden = ADAPTERS.filter((other) => other !== adapter && !(ADAPTER_USES[adapter] ?? []).includes(other));
      for (const other of forbidden) await expect(projectFiles().inFolder(`src/adapters/${adapter}/**`).shouldNot().dependOnFiles().inFolder(`src/adapters/${other}/**`)).toPassAsync();
    });
  }

  it('only the adapters and the entries import node builtins', async () => {
    const rule = projectFiles()
      .inFolder('src/{domain,application}/**')
      .should()
      .adhereTo((file) => !/(?:from|import)\s*\(?\s*'node:/.test(file.content), 'imports a node builtin');
    await expect(rule).toPassAsync();
  });

  it('the root of src/ holds only the entries', async () => {
    await expect(projectFiles().inFolder('src').should().haveName(/^(api|cli|index|node)\.ts$/)).toPassAsync();
  });

  it('application/ holds only the ports and the services', async () => {
    await expect(projectFiles().inFolder('src/application/**').should().beInPath(/^src\/application\/(port\/(in|out)|service)\//)).toPassAsync();
    await expect(projectFiles().inFolder('src/application/port/in/**').should().haveName(/(UseCase|DocumentSource)\.ts$/)).toPassAsync();
    await expect(projectFiles().inFolder('src/application/port/out/**').should().haveName(/Port\.ts$/)).toPassAsync();
    await expect(projectFiles().inFolder('src/application/service/**').should().haveName(/Service\.ts$/)).toPassAsync();
  });

  it('only the entries import api.ts and index.ts', async () => {
    await expect(projectFiles().inFolder('src/*/**').shouldNot().dependOnFiles().inPath(/^src\/(api|index)\.ts$/)).toPassAsync();
  });
});
