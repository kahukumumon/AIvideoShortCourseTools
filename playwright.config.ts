import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    headless: true,
    video: 'off',
    screenshot: 'only-on-failure',
  },
  workers: 1,
});
