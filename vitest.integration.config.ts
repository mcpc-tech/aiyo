import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Only run integration tests
    include: ['**/*.integration.test.ts'],
    // Longer timeout for real API calls
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
