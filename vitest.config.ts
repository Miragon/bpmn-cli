import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

interface CoverageFloor {
  lines: number;
  branches: number;
}

const budgets: { coverage: Record<string, CoverageFloor> } = JSON.parse(readFileSync('budgets.json', 'utf8'));

const coverageThresholds = Object.fromEntries(
  Object.entries(budgets.coverage).map(([sourceFolder, floor]) => [`${sourceFolder}/**`, floor]),
);

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'packages/*/src/**/*.ts'],
      reporter: ['text'],
      thresholds: coverageThresholds,
    },
  },
});
