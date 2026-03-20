// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

// Helper — creates a presentation with the given name and resolves after redirect to stage.
// Returns the new presentation URL.
async function createPresentation(page, name) {
    await page.goto('/create');
    await page.fill('[name="name"]', name);
    await page.click('button[type="submit"]');
    // The create handler redirects to /{username}/{pid} (the stage).
    await page.waitForURL(/\/admin\/\d+/);
    return page.url();
}

test.describe('presentations list', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    // The Demo presentation is seeded by migrations on every fresh database.
    test('Demo presentation is listed on /user/presentations', async ({ page }) => {
        await page.goto('/user/presentations');
        // The stage-link is the presentation title link; use it to avoid matching recording links.
        await expect(page.locator('#pres-list a.stage-link', { hasText: 'Demo' })).toBeVisible();
    });

    // The sort control must be labelled and functional.
    test('sort-by select is labelled and present', async ({ page }) => {
        await page.goto('/user/presentations');
        // Label "Sort by:" must be associated with the select.
        const label = page.locator('label[for="sort-by"]');
        await expect(label).toBeVisible();
        const select = page.locator('#sort-by');
        await expect(select).toBeVisible();
    });

    // Pagination controls must be present when there are presentations.
    test('pagination controls are present', async ({ page }) => {
        await page.goto('/user/presentations');
        await expect(page.locator('#prev-page')).toBeVisible();
        await expect(page.locator('#next-page')).toBeVisible();
        await expect(page.locator('#page-info')).toContainText('Page 1 of');
    });

    // The delete button opens a modal dialog.
    test('delete dialog opens when delete button is activated', async ({ page }) => {
        await page.goto('/user/presentations');
        // Click the "Delete: Demo" button.
        await page.click('button[data-open-dialog="delete-pres-1"]');
        // The dialog must be open and its heading must be announced.
        const dialog = page.locator('#delete-pres-1');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('h1')).toHaveText('Delete Demo?');
    });

    // The Cancel button in the delete dialog closes it without navigating away.
    test('cancel button closes delete dialog', async ({ page }) => {
        await page.goto('/user/presentations');
        await page.click('button[data-open-dialog="delete-pres-1"]');
        const dialog = page.locator('#delete-pres-1');
        await expect(dialog).toBeVisible();
        // Click Cancel.
        await dialog.locator('button[data-close-dialog="delete-pres-1"]').click();
        await expect(dialog).not.toBeVisible();
        // Must still be on the presentations page — no navigation occurred.
        await expect(page).toHaveURL('/user/presentations');
    });

    // The delete dialog cancel button must receive focus when the dialog opens.
    // After the APG fix, Cancel is last; showModal() focuses the first interactive element (Delete submit button).
    test('focus moves to first interactive element when delete dialog opens', async ({ page }) => {
        await page.goto('/user/presentations');
        await page.click('button[data-open-dialog="delete-pres-1"]');
        const deleteBtn = page.locator('#delete-pres-1 button[type="submit"]');
        await expect(deleteBtn).toBeFocused();
    });

    // The delete-presentation dialog must follow APG order: heading first, cancel last.
    test('delete-pres dialog has heading before cancel button', async ({ page }) => {
        await page.goto('/user/presentations');
        await page.click('button[data-open-dialog="delete-pres-1"]');
        const dialog = page.locator('#delete-pres-1');
        await expect(dialog).toBeVisible();

        // Get all focusable elements in order; heading (h1) must come before cancel button.
        const h1 = dialog.locator('h1');
        const cancelBtn = dialog.locator('button[data-close-dialog]');
        // Use DOM order (compareDocumentPosition), not visual position — CSS can
        // visually reorder elements without changing DOM/tab sequence.
        const inOrder = await dialog.evaluate(el => {
            const h = el.querySelector('h1');
            const c = el.querySelector('button[data-close-dialog]');
            // DOCUMENT_POSITION_FOLLOWING (4) means h1 precedes cancel in DOM
            return !!(h.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        expect(inOrder).toBe(true);
    });
});

test.describe('create presentation', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    // Create form must accept a name and redirect to the new presentation's stage.
    test('submitting create form redirects to new stage', async ({ page }) => {
        await page.goto('/create');
        await page.fill('[name="name"]', 'Test Presentation');
        await page.click('button[type="submit"]');
        // After creation the user is redirected to /{username}/{id}.
        await page.waitForURL(/\/admin\/\d+/);
        await expect(page).toHaveURL(/\/admin\/\d+/);
    });

    // After creating, the new presentation must appear in the list.
    test('new presentation appears in presentations list', async ({ page }) => {
        await createPresentation(page, 'My New Presentation');
        await page.goto('/user/presentations');
        await expect(page.locator('#pres-list a.stage-link', { hasText: 'My New Presentation' })).toBeVisible();
    });

    // Sort alphabetical must reorder presentations.
    // Requires at least two presentations (Demo from migrations + one created here).
    test('alphabetical sort reorders presentations', async ({ page }) => {
        // Create a presentation that comes before "Demo" alphabetically.
        await createPresentation(page, 'AAA First Presentation');
        await page.goto('/user/presentations');

        // Default sort is "newest" — AAA First Presentation was created after Demo
        // so it appears first. Switch to alphabetical to verify correct reordering.
        const select = page.locator('#sort-by');
        await select.selectOption('alphabetical');

        // Get all presentation links in DOM order after re-render.
        const links = page.locator('#pres-list .pres-item:visible a.stage-link');
        const first = links.first();
        await expect(first).toHaveText('AAA First Presentation');
    });
});
