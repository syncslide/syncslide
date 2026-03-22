// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin, assertNoViolations } = require('./helpers');

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

    test('manage co-presenters dialog open state has no axe violations', async ({ page }) => {
        await page.goto('/user/presentations');
        await page.locator('#actions-btn-1').click();
        await page.locator('#actions-menu-1 [role="menuitem"]')
            .filter({ hasText: 'Manage co-presenters' }).click();
        await expect(page.locator('#manage-access-1')).toBeVisible();
        await assertNoViolations(page);
    });
});
