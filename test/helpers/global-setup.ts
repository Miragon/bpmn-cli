/**
 * vitest globalSetup: no .bpmnlintrc applies to the temporary directories the
 * tests write their models to, nor to the repository. A stray one (in a
 * parent directory of either, inside a git repository; outside one only the
 * model's own directory counts) would run bpmnlint in every CLI test and
 * change what they print, so the run stops and names it.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findUp } from '../../src/adapters/out/files/utils/find-up.js';

export default function setup(): void {
  for (const dir of [tmpdir(), join(import.meta.dirname, '..', '..')]) {
    const found = findUp(dir, ['.bpmnlintrc'], { stopAtGitRoot: true });
    if (found) {
      throw new Error(`${join(found.dir, found.name)} applies to the test directories (bpmn-cli would run it in every test): move it away`);
    }
  }
}
