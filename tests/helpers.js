// @ts-check
const { expect } = require('@playwright/test');

/** Logs in as admin/admin and waits for redirect to /. */
async function loginAsAdmin(page) {
    await page.goto('/auth/login');
    await page.fill('[name="username"]', 'admin');
    await page.fill('[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
}

/** Runs axe-core on the current page and asserts no violations. */
async function assertNoViolations(page) {
    const AxeBuilder = require('@axe-core/playwright').default;
    const WCAG_TAGS = [
        'wcag2a', 'wcag2aa', 'wcag21aa',
        'wcag21aaa',
        'best-practice',
    ];
    const results = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();

    if (results.violations.length > 0) {
        const report = results.violations.map(v =>
            `[${v.impact}] ${v.id}: ${v.description}\n  Help: ${v.helpUrl}\n  Elements: ${v.nodes.map(n => n.html).join(', ')}`
        ).join('\n\n');
        throw new Error(`axe-core found ${results.violations.length} violation(s):\n\n${report}`);
    }
}

module.exports = { loginAsAdmin, assertNoViolations };
