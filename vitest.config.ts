import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // no .bpmnlintrc above the temporary directories or the repository (test/helpers/global-setup.ts)
    globalSetup: ['test/helpers/global-setup.ts'],
    testTimeout: 20000,
    globals: true,
  },
});
