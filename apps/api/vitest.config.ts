import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://epc:epc@localhost:5432/epc_test', JWT_SECRET: 'test-secret-test-secret-test-secret-123', STORAGE_DIR: './storage-test' },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
