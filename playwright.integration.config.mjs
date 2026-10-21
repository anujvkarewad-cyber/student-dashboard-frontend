import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './test-browser', testMatch: 'local-integration.spec.mjs', workers: 1, timeout: 60000, reporter: 'list', outputDir: '/home/user/workbook-receipts/verification/integration/artifacts', use: { headless: true, baseURL: 'http://127.0.0.1:18102', viewport: { width: 1000, height: 900 } } });
