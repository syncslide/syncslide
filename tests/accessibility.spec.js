// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

// WCAG A and AA (both 2.0 and 2.1), plus AAA additions from WCAG 2.1,
// plus best-practice rules. Note: axe-core does not have a 'wcag2aaa' tag —
// its AAA coverage is under 'wcag21aaa'. Not all AAA criteria are automatable;
// this catches what axe-core can detect.
const WCAG_TAGS = [
    'wcag2a', 'wcag2aa', 'wcag21aa',
    'wcag21aaa',
    'best-practice',
];

// Helper: logs in as admin/admin and resolves when on /.
async function loginAsAdmin(page) {
    await page.goto('/auth/login');
    await page.fill('[name="username"]', 'admin');
    await page.fill('[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
}

// Helper: runs axe on the current page and asserts no violations.
// On failure, formats the violations list for readable output.
async function assertNoViolations(page) {
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

// Public pages — no auth needed.
for (const url of ['/', '/auth/login', '/join', '/demo']) {
    test(`${url} has no axe violations`, async ({ page }) => {
        await page.goto(url);
        await assertNoViolations(page);
    });
}

// Protected pages — require a valid session.
test.describe('authenticated pages', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test('/user/presentations has no axe violations', async ({ page }) => {
        await page.goto('/user/presentations');
        await assertNoViolations(page);
    });

    test('/create has no axe violations', async ({ page }) => {
        await page.goto('/create');
        await assertNoViolations(page);
    });

    test('/user/change_pwd has no axe violations', async ({ page }) => {
        await page.goto('/user/change_pwd');
        await assertNoViolations(page);
    });
});
