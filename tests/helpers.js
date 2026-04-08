// @ts-check
const { expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Path of the admin session cookies file that globalSetup.js writes.
// Duplicated from globalSetup.js on purpose — see the note there for why.
const ADMIN_STATE_PATH = path.join(__dirname, '.auth', 'admin.json');

/**
 * Attaches the admin session cookies captured by globalSetup.js to the current
 * page's context, then lands on / to verify the session is active.
 *
 * No POST /auth/login happens here — that would chew through the login rate
 * limit (burst 5, 1 token / 12 s) keyed by loopback IP. See main.rs:1869.
 *
 * Tests that need to destroy the session they log in with (auth.spec.js
 * logout tests) MUST use loginAs(page, 'admin', 'admin') instead, so they
 * create and kill a throwaway session rather than invalidating the shared
 * admin session used by every other test in the suite.
 */
async function loginAsAdmin(page) {
    const state = JSON.parse(fs.readFileSync(ADMIN_STATE_PATH, 'utf-8'));
    await page.context().addCookies(state.cookies);
    await page.goto('/');
    await expect(page).toHaveURL('/');
}

/** Logs in as the given user and waits for redirect to /. */
async function loginAs(page, username, password) {
    await page.goto('/auth/login');
    await page.fill('[name="username"]', username);
    await page.fill('[name="password"]', password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
}

/** Runs axe-core on the current page and asserts no violations.
 *
 * Tag coverage targets WCAG 2.2 Level AAA across the 2.0 / 2.1 / 2.2 editions.
 * Three AAA rules ship disabled in axe-core and must be enabled explicitly:
 *   - color-contrast-enhanced   (1.4.6 Contrast Enhanced, 7:1)
 *   - identical-links-same-purpose (2.4.9 Link Purpose, Link Only)
 *   - meta-refresh-no-exceptions   (2.2.4 Interruptions / 3.2.5 Change on Request)
 */
async function assertNoViolations(page) {
    const AxeBuilder = require('@axe-core/playwright').default;
    const WCAG_TAGS = [
        'wcag2a', 'wcag2aa', 'wcag2aaa',
        'wcag21aa', 'wcag21aaa',
        'wcag22aa',
        'best-practice',
    ];
    const results = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .options({
            rules: {
                'color-contrast-enhanced': { enabled: true },
                'identical-links-same-purpose': { enabled: true },
                'meta-refresh-no-exceptions': { enabled: true },
            },
        })
        .analyze();

    if (results.violations.length > 0) {
        const report = results.violations.map(v =>
            `[${v.impact}] ${v.id}: ${v.description}\n  Help: ${v.helpUrl}\n  Elements: ${v.nodes.map(n => n.html).join(', ')}`
        ).join('\n\n');
        throw new Error(`axe-core found ${results.violations.length} violation(s):\n\n${report}`);
    }
}

module.exports = { loginAsAdmin, loginAs, assertNoViolations };
