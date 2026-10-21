import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // clears BPMN_KEEP_FLOW_IDS of the shell for the tests and the CLIs they spawn
    setupFiles: ['test/setup.ts'],
    // no .bpmnlintrc above the temporary directories or the repository (test/global-setup.ts)
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 20000,
    globals: true,
  },
});
