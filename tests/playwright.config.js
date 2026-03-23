// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5003',
    trace: 'on-first-retry',
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
