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

    test('slide dialog opens with "Add Slide" heading when Add Slide clicked', async ({ page }) => {
        await page.locator('#addSlide').click();
        await expect(page.locator('#slideDialog')).toBeVisible();
        await expect(page.locator('#slideDialogHeading')).toHaveText('Add Slide');
        await expect(page.locator('#slideDialogApply')).toHaveText('Add');
    });

    test('slide dialog cancel button closes dialog without changes', async ({ page }) => {
        const initialRows = await page.locator('#slideTableBody tr').count();
        await page.locator('#addSlide').click();
        await expect(page.locator('#slideDialog')).toBeVisible();
        await page.locator('#slideDialogCancel').click();
        await expect(page.locator('#slideDialog')).not.toBeVisible();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows);
    });

    test('inserting a slide adds a row to the slide table', async ({ page }) => {
        // Save original markdown to restore DB state after the test.
        const originalMarkdown = await page.locator('#markdown-input').inputValue();
        const initialRows = await page.locator('#slideTableBody tr').count();
        await page.locator('#addSlide').click();
        await expect(page.locator('#slideDialog')).toBeVisible();
        await page.fill('#insertTitle', 'My New Slide');
        await page.locator('#slideDialogApply').click();
        await expect(page.locator('#slideDialog')).not.toBeVisible();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows + 1);
        await expect(page.locator('#slideTableBody td').filter({ hasText: 'My New Slide' })).toBeVisible();
        // Restore: fill textarea with original markdown and blur to trigger updateMarkdown → WS → DB.
        await page.fill('#markdown-input', originalMarkdown);
        await page.locator('#markdown-input').dispatchEvent('blur');
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows);
    });

    test('slide table actions edit opens dialog with "Edit Slide" heading and pre-filled data', async ({ page }) => {
        // Select "Edit" from the first slide's actions dropdown
        const firstSelect = page.locator('#slideTableBody tr').first().locator('select');
        await firstSelect.selectOption('edit');
        await expect(page.locator('#slideDialog')).toBeVisible();
        await expect(page.locator('#slideDialogHeading')).toHaveText('Edit Slide');
        await expect(page.locator('#slideDialogApply')).toHaveText('Apply');
        // Title field must be pre-filled with the slide's title
        const titleValue = await page.locator('#insertTitle').inputValue();
        expect(titleValue.trim().length).toBeGreaterThan(0);
        // Position fieldset must be hidden in edit mode
        await expect(page.locator('#slideDialogPosition')).toBeHidden();
    });

    test('Escape closes the slide dialog', async ({ page }) => {
        await page.locator('#addSlide').click();
        await expect(page.locator('#slideDialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#slideDialog')).not.toBeVisible();
    });

    test('Tab key wraps within the slide dialog', async ({ page }) => {
        await page.locator('#addSlide').click();
        await expect(page.locator('#slideDialog')).toBeVisible();
        // The dialog h1 has tabindex="-1" — it is NOT in the tab sequence.
        // Tab sequence: #slideDialogCancel → radios → ref select → title input → body textarea → #slideDialogApply
        // Tab from #slideDialogApply should wrap back to #slideDialogCancel.
        await page.locator('#slideDialogApply').focus();
        await page.keyboard.press('Tab');
        await expect(page.locator('#slideDialogCancel')).toBeFocused();
    });

    test('delete slide via actions select triggers native confirm and removes row on accept', async ({ page }) => {
        // Save original markdown to restore DB state after the test.
        const originalMarkdown = await page.locator('#markdown-input').inputValue();
        // Accept the native confirm dialog that appears on delete
        page.on('dialog', dialog => dialog.accept());
        const initialRows = await page.locator('#slideTableBody tr').count();
        const firstSelect = page.locator('#slideTableBody tr').first().locator('select');
        await firstSelect.selectOption('delete');
        // After accept, row count decreases
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows - 1);
        // Restore: fill textarea with original markdown and blur to trigger updateMarkdown → WS → DB.
        await page.fill('#markdown-input', originalMarkdown);
        await page.locator('#markdown-input').dispatchEvent('blur');
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows);
    });
});
