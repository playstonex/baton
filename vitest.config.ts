import { defineConfig } from 'vitest/config';

export default defineConfig({
  // React Native injects __DEV__ at bundle time; under Node it is simply
  // absent, so any mobile module guarding dev-only logging throws on import.
  define: { __DEV__: 'false' },
  test: {
    include: ['packages/*/src/__tests__/**/*.test.ts'],
    exclude: ['packages/daemon/**'],
  },
});
