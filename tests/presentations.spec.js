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

// Helper — opens the Actions menu for a given presentation ID.
async function openActionsMenu(page, presId) {
    await page.locator(`#actions-btn-${presId}`).click();
    await expect(page.locator(`#actions-menu-${presId}`)).toBeVisible();
}

async function openManageDialog(page, presId) {
    await openActionsMenu(page, presId);
    await page.locator(`#actions-menu-${presId} [role="menuitem"]`)
        .filter({ hasText: 'Manage access' }).click();
    await expect(page.locator(`#manage-access-${presId}`)).toBeVisible();
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
        await openActionsMenu(page, 1);
        await page.locator('#actions-menu-1 [role="menuitem"]').filter({ hasText: 'Delete' }).click();
        // The dialog must be open and its heading must be announced.
        const dialog = page.locator('#delete-pres-1');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('h1')).toHaveText('Delete Demo?');
    });

    // The Cancel button in the delete dialog closes it without navigating away.
    test('cancel button closes delete dialog', async ({ page }) => {
        await page.goto('/user/presentations');
        await openActionsMenu(page, 1);
        await page.locator('#actions-menu-1 [role="menuitem"]').filter({ hasText: 'Delete' }).click();
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
        await openActionsMenu(page, 1);
        await page.locator('#actions-menu-1 [role="menuitem"]').filter({ hasText: 'Delete' }).click();
        const heading = page.locator('#delete-pres-1 h1');
        await expect(heading).toBeFocused();
    });

    // The delete-presentation dialog must follow APG order: heading first, cancel last.
    test('delete-pres dialog has heading before cancel button', async ({ page }) => {
        await page.goto('/user/presentations');
        await openActionsMenu(page, 1);
        await page.locator('#actions-menu-1 [role="menuitem"]').filter({ hasText: 'Delete' }).click();
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

    test('actions button is present with correct ARIA attributes', async ({ page }) => {
        await page.goto('/user/presentations');
        const btn = page.locator('#actions-btn-1');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
        await expect(btn).toHaveAttribute('aria-expanded', 'false');
    });

    test('actions menu opens on click and focuses first item', async ({ page }) => {
        await page.goto('/user/presentations');
        await page.locator('#actions-btn-1').click();
        await expect(page.locator('#actions-menu-1')).toBeVisible();
        await expect(page.locator('#actions-menu-1 [role="menuitem"]').first()).toBeFocused();
    });

    test('ArrowDown moves focus to next menu item', async ({ page }) => {
        await page.goto('/user/presentations');
        await page.locator('#actions-btn-1').click();
        await expect(page.locator('#actions-menu-1 [role="menuitem"]').first()).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#actions-menu-1 [role="menuitem"]').nth(1)).toBeFocused();
    });

    test('Escape closes actions menu and returns focus to button', async ({ page }) => {
        await page.goto('/user/presentations');
        await page.locator('#actions-btn-1').click();
        await expect(page.locator('#actions-menu-1 [role="menuitem"]').first()).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.locator('#actions-menu-1')).not.toBeVisible();
        await expect(page.locator('#actions-btn-1')).toBeFocused();
    });

    test('closing delete dialog returns focus to actions button', async ({ page }) => {
        await page.goto('/user/presentations');
        await openActionsMenu(page, 1);
        await page.locator('#actions-menu-1 [role="menuitem"]').filter({ hasText: 'Delete' }).click();
        const dialog = page.locator('#delete-pres-1');
        await expect(dialog).toBeVisible();
        await dialog.locator('button[data-close-dialog="delete-pres-1"]').click();
        await expect(dialog).not.toBeVisible();
        await expect(page.locator('#actions-btn-1')).toBeFocused();
    });

    test('clipboard live region is present in DOM', async ({ page }) => {
        await page.goto('/user/presentations');
        await expect(page.locator('#clipboard-status')).toBeAttached();
    });

    // The manage dialog must open with the correct heading first.
    test('manage access dialog opens with heading first', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('h1')).toContainText('Manage access for');
    });

    test('manage dialog table has 2 columns and a caption', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        await expect(dialog.locator('table caption')).toContainText('Co-presenters');
        const headers = dialog.locator('thead th');
        await expect(headers).toHaveCount(2);
        await expect(headers.nth(0)).toContainText('Username');
        await expect(headers.nth(1)).toContainText('Role');
    });

    test('manage dialog has Add person button in table', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        await expect(dialog.locator('td .add-copres-btn')).toBeAttached();
        await expect(dialog.locator('.add-copres-btn')).toContainText('Add person');
    });

    test('manage dialog opens with focus on h1', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        await expect(page.locator('#manage-access-1 h1')).toBeFocused();
    });

    // The Close button in the manage dialog must be the last focusable element (DOM order).
    test('manage dialog close button is last in DOM order', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        const inOrder = await dialog.evaluate(function (el) {
            var closeBtn = el.querySelector('.manage-access-close');
            var addBtn = el.querySelector('.add-copres-btn');
            // DOCUMENT_POSITION_FOLLOWING means addBtn precedes closeBtn in DOM
            return !!(addBtn.compareDocumentPosition(closeBtn) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        expect(inOrder).toBe(true);
    });

    test('Add button inserts a new row and focuses username input', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        await dialog.locator('.add-copres-btn').click();
        const input = dialog.locator('tr.new-row input[type="text"]');
        await expect(input).toHaveCount(1);
        await expect(input).toBeFocused();
    });

    test('Add button is disabled while new row username is empty', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        await dialog.locator('.add-copres-btn').click();
        await expect(dialog.locator('.add-copres-btn')).toBeDisabled();
    });

    test('Add button re-enables when new row username is filled', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        await dialog.locator('.add-copres-btn').click();
        await dialog.locator('tr.new-row input[type="text"]').fill('someuser');
        await expect(dialog.locator('.add-copres-btn')).toBeEnabled();
    });

    test('username blur with own name shows owner error', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        await dialog.locator('.add-copres-btn').click();
        const input = dialog.locator('tr.new-row input[type="text"]');
        await input.fill('admin');
        await input.blur();
        await expect(dialog.locator('tr.new-row [aria-live]')).toContainText('owner');
        await expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    test('username blur with nonexistent user shows User not found', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        await dialog.locator('.add-copres-btn').click();
        const input = dialog.locator('tr.new-row input[type="text"]');
        await input.fill('xyzzy_no_such_user_abc123');
        await input.blur();
        await expect(dialog.locator('tr.new-row [aria-live]')).toContainText('User not found');
        await expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    test('duplicate username across two new rows shows Already a co-presenter', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        // Add first row and fill it (enabling the Add button again)
        await dialog.locator('.add-copres-btn').click();
        await dialog.locator('tr.new-row input[type="text"]').first().fill('uniqueuser123');
        // Add second row (clicking Add button also blurs the first input, firing its validation)
        await dialog.locator('.add-copres-btn').click();
        const secondInput = dialog.locator('tr.new-row input[type="text"]').last();
        await secondInput.fill('uniqueuser123');
        await secondInput.blur();
        await expect(secondInput).toHaveAttribute('aria-invalid', 'true');
        await expect(dialog.locator('tr.new-row').last().locator('[aria-live]'))
            .toContainText('Already added');
    });

    test('typing in errored input clears the error', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        await dialog.locator('.add-copres-btn').click();
        const input = dialog.locator('tr.new-row input[type="text"]');
        await input.fill('admin');
        await input.blur();
        await expect(input).toHaveAttribute('aria-invalid', 'true');
        await input.pressSequentially('x');
        await expect(input).toHaveAttribute('aria-invalid', 'false');
    });

    test('Close with no pending changes closes dialog immediately', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        await dialog.locator('.manage-access-close').click();
        await expect(dialog).not.toBeVisible();
        await expect(page.locator('#actions-btn-1')).toBeFocused();
    });

    test('Close with pending changes shows unsaved prompt and focuses Save', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        await dialog.locator('.add-copres-btn').click(); // creates a pending new row
        await dialog.locator('.manage-access-close').click();
        await expect(dialog.locator('.unsaved-prompt')).toBeVisible();
        await expect(dialog.locator('.unsaved-save')).toBeFocused();
    });

    test('Discard resets state and closes dialog', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        await dialog.locator('.add-copres-btn').click();
        await dialog.locator('.manage-access-close').click();
        await dialog.locator('.unsaved-discard').click();
        await expect(dialog).not.toBeVisible();
        await expect(page.locator('#actions-btn-1')).toBeFocused();
    });

    test('Escape with pending changes shows unsaved prompt', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        await dialog.locator('.add-copres-btn').click();
        await page.keyboard.press('Escape');
        await expect(dialog.locator('.unsaved-prompt')).toBeVisible();
        await expect(dialog.locator('.unsaved-save')).toBeFocused();
    });

    test('Escape while prompt visible dismisses prompt and focuses Close button', async ({ page }) => {
        await page.goto('/user/presentations');
        await openManageDialog(page, 1);
        const dialog = page.locator('#manage-access-1');
        await dialog.locator('.add-copres-btn').click();
        await page.keyboard.press('Escape'); // shows prompt
        await page.keyboard.press('Escape'); // dismisses prompt
        await expect(dialog.locator('.unsaved-prompt')).not.toBeVisible();
        await expect(dialog.locator('.manage-access-close')).toBeFocused();
    });

    test('manage access dialog has Visibility combobox defaulting to Public', async ({ page }) => {
        await page.goto('/user/presentations');
        await openActionsMenu(page, 1);
        await page.locator('#actions-menu-1 [role="menuitem"]').filter({ hasText: 'Manage access' }).click();
        const dialog = page.locator('#manage-access-1');
        await expect(dialog.locator('.visibility-select')).toHaveValue('public');
    });

    test('changing Visibility combobox shows unsaved prompt', async ({ page }) => {
        await page.goto('/user/presentations');
        await openActionsMenu(page, 1);
        await page.locator('#actions-menu-1 [role="menuitem"]').filter({ hasText: 'Manage access' }).click();
        const dialog = page.locator('#manage-access-1');
        await dialog.locator('.visibility-select').selectOption('private');
        await expect(dialog.locator('.unsaved-prompt')).toBeVisible();
    });

    test('audience role option appears in new row role select', async ({ page }) => {
        await page.goto('/user/presentations');
        await openActionsMenu(page, 1);
        await page.locator('#actions-menu-1 [role="menuitem"]').filter({ hasText: 'Manage access' }).click();
        const dialog = page.locator('#manage-access-1');
        const addBtn = dialog.locator('.add-copres-btn');
        await addBtn.click();
        const newRowSelect = dialog.locator('tr.new-row select');
        await expect(newRowSelect.locator('option[value="audience"]')).toHaveCount(1);
    });

    test('Shared as audience filter checkbox is present and checked', async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto('/user/presentations');
        await page.click('#filter-toggle');
        const panel = page.locator('#filter-panel');
        const audienceBox = panel.locator('input[data-filter-role="audience"]');
        await expect(audienceBox).toBeVisible();
        await expect(audienceBox).toBeChecked();
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

test('filter panel has four checkboxes all checked', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/user/presentations');
    await page.click('#filter-toggle');
    const panel = page.locator('#filter-panel');
    const boxes = panel.locator('input[type="checkbox"]');
    await expect(boxes).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
        await expect(boxes.nth(i)).toBeChecked();
    }
});

test('result count live region is present', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/user/presentations');
    const liveRegion = page.locator('#filter-count');
    await expect(liveRegion).toBeAttached();
});
