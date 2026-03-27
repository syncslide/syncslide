// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

test.describe('edit page — slide dialog', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto('/admin/1/edit');
        // Wait for the slide table to be populated by JS
        await expect(page.locator('#slideTableBody tr')).not.toHaveCount(0);
    });

    test('slide dialog h1 comes before cancel button in DOM', async ({ page }) => {
        await page.locator('#addSlide').click();
        const dialog = page.locator('#slideDialog');
        await expect(dialog).toBeVisible();

        const inOrder = await dialog.evaluate(el => {
            const h = el.querySelector('h1');
            const c = el.querySelector('#slideDialogCancel');
            // DOCUMENT_POSITION_FOLLOWING means h1 precedes cancel button
            return !!(h.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        expect(inOrder).toBe(true);
    });

    test('slide dialog focuses h1 when opened', async ({ page }) => {
        await page.locator('#addSlide').click();
        const dialog = page.locator('#slideDialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('h1')).toBeFocused();
    });
});
