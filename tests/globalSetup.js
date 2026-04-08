// @ts-check
// Runs once before the test suite, after the webServer is up.
//
// Performs a real POST /auth/login as admin and saves the resulting session
// cookies to tests/.auth/admin.json. helpers.js#loginAsAdmin then injects those
// cookies into each test's context instead of POSTing again, which keeps the
// whole suite under the 5-login/minute rate limit configured in main.rs:1869.
//
// The admin session in tower-sessions is DB-backed and stays valid for the
// lifetime of the webServer process — the DB is freshly wiped at webServer
// start (see playwright.config.js#webServer.command), so this captured session
// is guaranteed to exist and not collide with anything from a prior run.
//
// Tests that deliberately end a session (auth.spec.js logout tests) use
// loginAs() instead to POST their own throwaway session, so the cached admin
// session is never invalidated mid-suite.
// Use the bare `playwright` package (not `@playwright/test`) so this config
// file never touches the test runner module. Loading `@playwright/test` here
// poisons the transitive require graph: any test file whose dependencies
// share cached modules with the config gets rejected with "calling
// test.describe() in a file imported by the configuration file."
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// IMPORTANT: This path is duplicated in helpers.js on purpose. Sharing it via
// a require()'d module would make that module "config-side" in Playwright's
// view — and then test files transitively importing it would be rejected with
// "calling test.describe() in a file imported by the configuration file."
const ADMIN_STATE_PATH = path.join(__dirname, '.auth', 'admin.json');

module.exports = async function globalSetup(config) {
    const { baseURL } = config.projects[0].use;
    fs.mkdirSync(path.dirname(ADMIN_STATE_PATH), { recursive: true });

    const browser = await chromium.launch();
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    try {
        await page.goto('/auth/login');
        await page.fill('[name="username"]', 'admin');
        await page.fill('[name="password"]', 'admin');
        await page.click('button[type="submit"]');
        await page.waitForURL('/');
        await context.storageState({ path: ADMIN_STATE_PATH });
    } finally {
        await browser.close();
    }
};

