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

    // When the delete dialog opens, focus must move to the dialog heading (tabindex="-1").
    // This keeps the destructive button out of initial focus and announces the dialog to screen readers.
    test('focus moves to dialog heading when delete dialog opens', async ({ page }) => {
        await page.goto('/user/presentations');
        await page.click('button[data-open-dialog="delete-pres-1"]');
        const heading = page.locator('#delete-pres-1 h1');
        await expect(heading).toBeFocused();
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

    // The "Manage co-presenters" button must be present on each owned presentation.
    test('manage co-presenters button is present', async ({ page }) => {
        await page.goto('/user/presentations');
        const manageBtn = page.locator('button[data-open-dialog="manage-access-1"]');
        await expect(manageBtn).toBeVisible();
    });

    // The manage dialog must open with the correct heading first.
    test('manage co-presenters dialog opens with heading first', async ({ page }) => {
        await page.goto('/user/presentations');
        await page.click('button[data-open-dialog="manage-access-1"]');
        const dialog = page.locator('#manage-access-1');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('h1')).toContainText('Co-presenters for');
    });

    // The Close button in the manage dialog must be the last focusable element (DOM order).
    test('manage dialog close button is last in DOM order', async ({ page }) => {
        await page.goto('/user/presentations');
        await page.click('button[data-open-dialog="manage-access-1"]');
        const dialog = page.locator('#manage-access-1');
        const inOrder = await dialog.evaluate(el => {
            const closeBtn = el.querySelector('button[data-close-dialog]');
            const submitBtn = el.querySelector('button[type="submit"]');
            // DOCUMENT_POSITION_FOLLOWING means submitBtn precedes closeBtn
            return !!(submitBtn.compareDocumentPosition(closeBtn) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        expect(inOrder).toBe(true);
    });

    // The "Set password" button must be present on each presentation item.
    test('set-password button is present for owned presentation', async ({ page }) => {
        await page.goto('/user/presentations');
        const setpwdBtn = page.locator('button[data-open-dialog="set-pwd-1"]');
        await expect(setpwdBtn).toBeVisible();
    });

    // The set-password dialog must open with heading first.
    test('set-password dialog opens with heading first', async ({ page }) => {
        await page.goto('/user/presentations');
        await page.click('button[data-open-dialog="set-pwd-1"]');
        const dialog = page.locator('#set-pwd-1');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('h1')).toContainText('Set password for');
    });

    // Show/hide toggle must change aria-pressed and input type.
    test('set-password show/hide toggle works', async ({ page }) => {
        await page.goto('/user/presentations');
        await page.click('button[data-open-dialog="set-pwd-1"]');
        const toggle = page.locator('#set-pwd-1 .show-pwd-toggle');
        const input = page.locator('#set-pwd-1 input[name="password"]');
        // Initially hidden
        await expect(input).toHaveAttribute('type', 'password');
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await toggle.click();
        await expect(input).toHaveAttribute('type', 'text');
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
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

// -- Role labels --
// A presentation owned by admin must NOT show a shared-with label.
test('owner presentation has no shared-with label', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/user/presentations');
    const item = page.locator('.pres-item[data-role="owner"]').first();
    await expect(item).toBeVisible();
    await expect(item.locator('.role-label')).not.toBeVisible();
});

// data-role="owner" must be present on owned presentations.
test('owned presentation has data-role owner', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/user/presentations');
    const item = page.locator('#pres-list li').first();
    await expect(item).toHaveAttribute('data-role', 'owner');
});

// -- Filter control --
test('filter button is present', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/user/presentations');
    const filterBtn = page.locator('#filter-toggle');
    await expect(filterBtn).toBeVisible();
    await expect(filterBtn).toContainText('Filter');
});

test('filter button has aria-expanded false by default', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/user/presentations');
    await expect(page.locator('#filter-toggle')).toHaveAttribute('aria-expanded', 'false');
});

test('clicking filter button expands the panel', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/user/presentations');
    await page.click('#filter-toggle');
    await expect(page.locator('#filter-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#filter-panel')).toBeVisible();
});

test('filter panel has three checkboxes all checked', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/user/presentations');
    await page.click('#filter-toggle');
    const panel = page.locator('#filter-panel');
    const boxes = panel.locator('input[type="checkbox"]');
    await expect(boxes).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
        await expect(boxes.nth(i)).toBeChecked();
    }
});

test('result count live region is present', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/user/presentations');
    const liveRegion = page.locator('#filter-count');
    await expect(liveRegion).toBeAttached();
});
