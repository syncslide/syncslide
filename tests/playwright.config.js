// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5003',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'cargo build 2>&1 && rm -f test.sqlite3 && APP_PORT=5003 APP_DB=sqlite://test.sqlite3 ./target/debug/syncslide-websocket',
    cwd: '../syncslide-websocket',
    url: 'http://localhost:5003/',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_PORT: '5003',
      APP_DB: 'sqlite://test.sqlite3',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // WebKit omitted: Playwright's Linux WebKit build requires libicu74, but
    // the VPS (Arch Linux) ships ICU 78 — the .so versions are incompatible.
    // WebKit on Linux does not replicate real Safari/VoiceOver behaviour anyway;
    // that requires macOS. Re-add when running on a supported OS or macOS CI.
  ],
});
