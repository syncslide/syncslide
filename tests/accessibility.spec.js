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

    test('manage access dialog open state has no axe violations', async ({ page }) => {
        await page.goto('/user/presentations');
        await page.locator('#actions-btn-1').click();
        await page.locator('#actions-menu-1 [role="menuitem"]')
            .filter({ hasText: 'Manage access' }).click();
        await expect(page.locator('#manage-access-1')).toBeVisible();
        await assertNoViolations(page);
    });

    test('stage page does not contain the markdown editor', async ({ page }) => {
        await page.goto('/admin/1');
        await expect(page.locator('#markdown-input')).not.toBeAttached();
    });
});

test.describe('stage and edit page H1 focus', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test('stage page H1 has tabindex=-1', async ({ page }) => {
        await page.goto('/admin/1');
        const h1 = page.locator('#stage-heading');
        await expect(h1).toHaveAttribute('tabindex', '-1');
    });

    test('edit page H1 has tabindex=-1', async ({ page }) => {
        await page.goto('/admin/1/edit');
        const h1 = page.locator('#edit-heading');
        await expect(h1).toHaveAttribute('tabindex', '-1');
    });

    test('edit page H1 receives focus on load', async ({ page }) => {
        await page.goto('/admin/1/edit');
        const h1 = page.locator('#edit-heading');
        await expect(h1).toBeFocused();
    });

    test('stage page H1 receives focus on load', async ({ page }) => {
        await page.goto('/admin/1');
        const h1 = page.locator('#stage-heading');
        await expect(h1).toBeFocused();
    });

    test('stage page breadcrumb has three items with aria-current on last', async ({ page }) => {
        await page.goto('/admin/1');
        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible();
        const items = nav.locator('li');
        await expect(items).toHaveCount(3);
        await expect(items.last()).toHaveAttribute('aria-current', 'page');
    });

    test('edit page breadcrumb has three items with aria-current on last', async ({ page }) => {
        await page.goto('/admin/1/edit');
        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible();
        const items = nav.locator('li');
        await expect(items).toHaveCount(3);
        await expect(items.last()).toHaveAttribute('aria-current', 'page');
    });
});

test.describe('markdown label syncs via WebSocket name update', () => {
    test('markdown label on second edit tab updates when name changes via WS', async ({ browser }) => {
        // Tab 1 — receives the WS name update
        const ctx1 = await browser.newContext();
        const page1 = await ctx1.newPage();
        await loginAsAdmin(page1);
        await page1.goto('/admin/1/edit');
        await expect(page1.locator('#edit-heading')).toBeFocused();

        // Tab 2 — sends the name change
        const ctx2 = await browser.newContext();
        const page2 = await ctx2.newPage();
        await loginAsAdmin(page2);
        await page2.goto('/admin/1/edit');

        // Change name on tab 2 (blur commits via onCommit)
        const newName = 'WS Label Sync Test ' + Date.now();
        await page2.fill('#presName', newName);
        await page2.locator('#presName').blur();

        // Wait for WS propagation and verify label on tab 1
        await expect(page1.locator('label[for="markdown-input"]')).toHaveText(newName, { timeout: 5000 });

        // Restore original name. The WS broadcast updates sibling tabs
        // immediately, but the DB commit happens separately via POST
        // /user/presentations/{pid}/name. We MUST wait for that 200 response
        // before closing contexts, otherwise Demo stays renamed on disk and
        // poisons sibling test files that expect the presentation to be
        // called "Demo". (handlers.js:142 fires the fetch; the handler at
        // main.rs:1420 awaits update_name() before replying 200.)
        const restorePost = page2.waitForResponse(resp =>
            resp.url().endsWith('/user/presentations/1/name') && resp.status() === 200
        );
        await page2.fill('#presName', 'Demo');
        await page2.locator('#presName').blur();
        await restorePost;

        await ctx1.close();
        await ctx2.close();
    });
});
