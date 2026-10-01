import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1,
  reporter: 'list', outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5174',
    launchOptions: { executablePath, args: ['--no-sandbox'] }, screenshot: 'only-on-failure'
  },
  webServer: [
    {
      command: 'npx tsx server/index.ts', url: 'http://127.0.0.1:40531/api/status', reuseExistingServer: false,
      env: { NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '40531', APP_ORIGIN: 'http://127.0.0.1:5174',
        ADMIN_PASSWORD: 'local-browser-test-password', ENCRYPTION_KEY: '24'.repeat(32), DATABASE_PATH: '.playwright/browser.db' }
    },
    { command: 'npx vite --host 127.0.0.1 --port 5174 --strictPort', url: 'http://127.0.0.1:5174', reuseExistingServer: false, env: { API_PROXY_TARGET: 'http://127.0.0.1:40531' } }
  ]
});
