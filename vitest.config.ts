import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // App-side (api) tests. The plugin has its own vitest run via its package.
    include: ['api/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@lingua-franca/tools-world': fileURLToPath(
        new URL('./packages/tools-world/src/index.ts', import.meta.url),
      ),
    },
  },
});
