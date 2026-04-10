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
        const originalMarkdown = await page.evaluate(() => document.getElementById('markdown-input').value);
        const initialRows = await page.locator('#slideTableBody tr').count();
        await page.locator('#addSlide').click();
        await expect(page.locator('#slideDialog')).toBeVisible();
        await page.fill('#insertTitle', 'My New Slide');
        await page.locator('#slideDialogApply').click();
        await expect(page.locator('#slideDialog')).not.toBeVisible();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows + 1);
        await expect(page.locator('#slideTableBody td').filter({ hasText: 'My New Slide' })).toBeVisible();
        // Restore: write markdown directly and call updateMarkdown to send via WS → DB.
        await page.evaluate((md) => {
            document.getElementById('markdown-input').value = md;
            updateMarkdown();
        }, originalMarkdown);
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows);
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

    test('slide table rows have action menu buttons instead of selects', async ({ page }) => {
        const firstRow = page.locator('#slideTableBody tr').first();
        await expect(firstRow.locator('button[aria-haspopup="menu"]')).toBeVisible();
        await expect(firstRow.locator('select')).not.toBeAttached();
    });

    test('action menu opens on click and arrow keys navigate items', async ({ page }) => {
        const btn = page.locator('#slideTableBody tr').first().locator('button[aria-haspopup="menu"]');
        await btn.click();
        const menu = page.locator('#slideTableBody tr').first().locator('[role="menu"]');
        await expect(menu).toBeVisible();
        // First item is focused on open
        const firstItem = menu.locator('[role="menuitem"]').first();
        await expect(firstItem).toBeFocused();
        // Arrow down moves to second item
        await page.keyboard.press('ArrowDown');
        const secondItem = menu.locator('[role="menuitem"]').nth(1);
        await expect(secondItem).toBeFocused();
        // Escape closes and returns focus to button
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(btn).toBeFocused();
    });

    test('slide table actions edit opens dialog with "Edit Slide" heading and pre-filled data', async ({ page }) => {
        // Open action menu on first row and click Edit
        const btn = page.locator('#slideTableBody tr').first().locator('button[aria-haspopup="menu"]');
        await btn.click();
        const menu = page.locator('#slideTableBody tr').first().locator('[role="menu"]');
        await menu.locator('[data-action="edit"]').click();
        await expect(page.locator('#slideDialog')).toBeVisible();
        await expect(page.locator('#slideDialogHeading')).toHaveText('Edit Slide');
        await expect(page.locator('#slideDialogApply')).toHaveText('Apply');
        // Title field must be pre-filled with the slide's title
        const titleValue = await page.locator('#insertTitle').inputValue();
        expect(titleValue.trim().length).toBeGreaterThan(0);
        // Position fieldset must be hidden in edit mode
        await expect(page.locator('#slideDialogPosition')).toBeHidden();
    });

    test('delete slide via action menu opens dialog and removes row on confirm', async ({ page }) => {
        const originalMarkdown = await page.evaluate(() => document.getElementById('markdown-input').value);
        const initialRows = await page.locator('#slideTableBody tr').count();
        // Open menu on first row
        const btn = page.locator('#slideTableBody tr').first().locator('button[aria-haspopup="menu"]');
        await btn.click();
        // Click Delete menu item
        const menu = page.locator('#slideTableBody tr').first().locator('[role="menu"]');
        await menu.locator('[data-action="delete"]').click();
        // Dialog opens
        const dialog = page.locator('#deleteSlideDialog');
        await expect(dialog).toBeVisible();
        await expect(page.locator('#deleteSlideHeading')).toBeFocused();
        // Confirm delete
        await page.locator('#deleteSlideConfirm').click();
        await expect(dialog).not.toBeVisible();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows - 1);
        // Restore via evaluate (textarea is inside a dialog, may not be visible)
        await page.evaluate((md) => {
            document.getElementById('markdown-input').value = md;
            updateMarkdown();
        }, originalMarkdown);
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows);
    });

    test('delete slide dialog cancel returns focus to action button', async ({ page }) => {
        const btn = page.locator('#slideTableBody tr').first().locator('button[aria-haspopup="menu"]');
        await btn.click();
        const menu = page.locator('#slideTableBody tr').first().locator('[role="menu"]');
        await menu.locator('[data-action="delete"]').click();
        await expect(page.locator('#deleteSlideDialog')).toBeVisible();
        await page.locator('#deleteSlideCancel').click();
        await expect(page.locator('#deleteSlideDialog')).not.toBeVisible();
        // Focus returns to the first row's action button (original was still row 0)
        await expect(page.locator('#slideTableBody tr').first().locator('button[aria-haspopup="menu"]')).toBeFocused();
    });

});

test.describe('edit page — markdown dialog', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto('/admin/1/edit');
        await expect(page.locator('#slideTableBody tr')).not.toHaveCount(0);
    });

    test('Edit Markdown button opens dialog with heading focused', async ({ page }) => {
        await page.locator('#editMarkdownBtn').click();
        const dialog = page.locator('#markdownDialog');
        await expect(dialog).toBeVisible();
        const heading = dialog.locator('#markdownDialogHeading');
        await expect(heading).toHaveText('Edit Markdown');
        await expect(heading).toBeFocused();
    });

    test('Save in markdown dialog sends changes and updates slide table', async ({ page }) => {
        const initialRows = await page.locator('#slideTableBody tr').count();
        await page.locator('#editMarkdownBtn').click();
        const textarea = page.locator('#markdownDialog #markdown-input');
        const current = await textarea.inputValue();
        await textarea.fill(current + '\n\n## Extra Slide\nContent here');
        await page.locator('#markdownSaveBtn').click();
        await expect(page.locator('#markdownDialog')).not.toBeVisible();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows + 1);
        await expect(page.locator('#editMarkdownBtn')).toBeFocused();
        // Restore
        await page.locator('#editMarkdownBtn').click();
        await page.locator('#markdownDialog #markdown-input').fill(current);
        await page.locator('#markdownSaveBtn').click();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows);
    });

    test('Close with no changes dismisses dialog immediately', async ({ page }) => {
        await page.locator('#editMarkdownBtn').click();
        await expect(page.locator('#markdownDialog')).toBeVisible();
        await page.locator('#markdownCloseBtn').click();
        await expect(page.locator('#markdownDialog')).not.toBeVisible();
        await expect(page.locator('#editMarkdownBtn')).toBeFocused();
    });

    test('Close with changes shows unsaved prompt, Discard reverts', async ({ page }) => {
        const initialRows = await page.locator('#slideTableBody tr').count();
        await page.locator('#editMarkdownBtn').click();
        const textarea = page.locator('#markdownDialog #markdown-input');
        const original = await textarea.inputValue();
        await textarea.fill(original + '\n\n## Temp Slide\ntemp');
        await page.locator('#markdownCloseBtn').click();
        // Unsaved prompt appears
        await expect(page.locator('#markdownUnsavedHeading')).toBeVisible();
        await expect(page.locator('#markdownUnsavedHeading')).toBeFocused();
        // Discard
        await page.locator('#markdownUnsavedDiscard').click();
        await expect(page.locator('#markdownDialog')).not.toBeVisible();
        // Slide table unchanged
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows);
    });

    test('Unsaved prompt Back returns to editing', async ({ page }) => {
        await page.locator('#editMarkdownBtn').click();
        const textarea = page.locator('#markdownDialog #markdown-input');
        const original = await textarea.inputValue();
        await textarea.fill(original + '\n\n## Temp\ntemp');
        await page.locator('#markdownCloseBtn').click();
        await expect(page.locator('#markdownUnsavedHeading')).toBeVisible();
        await page.locator('#markdownUnsavedBack').click();
        // Back to main dialog view
        await expect(page.locator('.markdown-dialog-main')).toBeVisible();
        await expect(page.locator('.markdown-unsaved')).toBeHidden();
        // Heading should be focused after returning from unsaved panel
        await expect(page.locator('#markdownDialogHeading')).toBeFocused();
        // Discard to clean up
        await page.locator('#markdownCloseBtn').click();
        await page.locator('#markdownUnsavedDiscard').click();
    });

    test('Escape with changes shows unsaved prompt', async ({ page }) => {
        await page.locator('#editMarkdownBtn').click();
        const textarea = page.locator('#markdownDialog #markdown-input');
        const original = await textarea.inputValue();
        await textarea.fill(original + '\n\n## Esc Test\nesc');
        await page.keyboard.press('Escape');
        await expect(page.locator('#markdownUnsavedHeading')).toBeVisible();
        // Discard to clean up
        await page.locator('#markdownUnsavedDiscard').click();
    });

    test('Unsaved prompt Save applies changes and closes', async ({ page }) => {
        const initialRows = await page.locator('#slideTableBody tr').count();
        await page.locator('#editMarkdownBtn').click();
        const textarea = page.locator('#markdownDialog #markdown-input');
        const original = await textarea.inputValue();
        await textarea.fill(original + '\n\n## Save Via Prompt\nprompt');
        await page.locator('#markdownCloseBtn').click();
        await expect(page.locator('#markdownUnsavedHeading')).toBeVisible();
        await page.locator('#markdownUnsavedSave').click();
        await expect(page.locator('#markdownDialog')).not.toBeVisible();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows + 1);
        // Restore
        await page.locator('#editMarkdownBtn').click();
        await page.locator('#markdownDialog #markdown-input').fill(original);
        await page.locator('#markdownSaveBtn').click();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows);
    });
});
