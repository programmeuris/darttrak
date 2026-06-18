import { defineConfig } from 'vitest/config';

// The pure logic under test (scoring, analysis, atc, stats) has no DOM
// dependency, so the lightweight node environment is enough.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/scoring.ts', 'src/analysis.ts', 'src/atc.ts', 'src/stats.ts'],
      reporter: ['text', 'html'],
    },
  },
});
