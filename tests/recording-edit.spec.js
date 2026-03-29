// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

// Creates a recording for pres 1 (admin/Demo) and returns the recording edit URL.
// Requires the page to already be logged in.
async function createAndOpenRecordingEdit(page) {
    await page.goto('/admin/1');
    await expect(page.locator('#stage-heading')).toBeFocused();

    // Expand recording controls
    await page.locator('#record-toggle').click();
    await expect(page.locator('#record-section')).toBeVisible();

    // Start recording
    await page.locator('#recordStart').click();
    await expect(page.locator('#rec-status')).toHaveText('Recording', { timeout: 5000 });

    // Stop recording
    await page.locator('#recordStop').click();
    await expect(page.locator('#rec-status')).toHaveText('Stopped', { timeout: 5000 });

    // Navigate to presentations and find the newest recording for pres 1
    await page.goto('/user/presentations');
    // Expand recordings details for pres 1 (data-id="1")
    const presItem = page.locator('.pres-item[data-id="1"]');
    await presItem.locator('details summary').click();
    // Recordings are stored in ascending ID order (oldest first, newest last),
    // so use .last() to reliably target the recording just created.
    const firstRecBtn = presItem.locator('[id^="rec-actions-btn-"]').last();
    await firstRecBtn.click();
    const firstRecMenu = presItem.locator('[id^="rec-actions-menu-"]').last();
    await expect(firstRecMenu).toBeVisible();
    // Extract the edit URL from the menu item's data-edit-url attribute rather than
    // following the link (which opens in a new tab via window.open).
    const editMenuItem = firstRecMenu.locator('[role="menuitem"]').filter({ hasText: 'Edit Recording' });
    const editUrl = await editMenuItem.getAttribute('data-edit-url');
    if (!editUrl) throw new Error('Could not find data-edit-url on Edit Recording menu item');
    return editUrl;
}

test.describe('recording edit page', () => {
    test.describe.configure({ mode: 'serial' });
    let editUrl;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAsAdmin(page);
        editUrl = await createAndOpenRecordingEdit(page);
        await page.close();
    });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto(editUrl);
        await expect(page.locator('#edit-rec-heading')).toBeFocused();
    });

    test('page h1 receives focus on load', async ({ page }) => {
        await expect(page.locator('#edit-rec-heading')).toBeFocused();
    });

    test('recording name input is present and labelled', async ({ page }) => {
        const input = page.locator('#recName');
        await expect(input).toBeVisible();
        // Label wraps the input (implicit label)
        const label = page.locator('label:has(#recName)');
        await expect(label).toBeAttached();
    });

    test('rename status live region is present', async ({ page }) => {
        await expect(page.locator('#rename-status')).toBeAttached();
        const role = await page.locator('#rename-status').getAttribute('aria-live');
        expect(role).toBe('polite');
    });

    test('timing section has a visible heading', async ({ page }) => {
        await expect(page.locator('#timing-heading')).toBeVisible();
        await expect(page.locator('#timing-heading')).toHaveText('Edit Timing');
    });

    test('timing section has correct aria-labelledby', async ({ page }) => {
        const section = page.locator('section[aria-labelledby="timing-heading"]');
        await expect(section).toBeAttached();
    });

    test('files section has correct aria-labelledby', async ({ page }) => {
        const section = page.locator('section[aria-labelledby="files-heading"]');
        await expect(section).toBeAttached();
    });

    test('save and discard buttons are hidden on load', async ({ page }) => {
        await expect(page.locator('#saveTimingBtn')).toBeHidden();
        await expect(page.locator('#discardTimingBtn')).toBeHidden();
    });

    test('cue table has correct column headers', async ({ page }) => {
        const headers = page.locator('table:has(#cueTableBody) thead th');
        await expect(headers).toHaveCount(3);
        await expect(headers.nth(0)).toContainText('Slide');
        await expect(headers.nth(1)).toContainText('Title');
        await expect(headers.nth(2)).toContainText('Start Time');
    });

    test('timing status live region is present', async ({ page }) => {
        await expect(page.locator('#timing-status')).toBeAttached();
        const role = await page.locator('#timing-status').getAttribute('aria-live');
        expect(role).toBe('polite');
    });

    test('Replace Files section heading is visible', async ({ page }) => {
        await expect(page.locator('#files-heading')).toBeVisible();
        await expect(page.locator('#files-heading')).toHaveText('Replace Files');
    });

    test('video file input accepts video/* and is labelled', async ({ page }) => {
        const input = page.locator('#replaceFilesForm input[name="video"]');
        await expect(input).toBeVisible();
        await expect(input).toHaveAttribute('accept', 'video/*');
        const label = page.locator('label:has(input[name="video"])');
        await expect(label).toBeAttached();
    });

    test('captions file input accepts .vtt and is labelled', async ({ page }) => {
        const input = page.locator('#replaceFilesForm input[name="captions"]');
        await expect(input).toBeVisible();
        const accept = await input.getAttribute('accept');
        expect(accept).toContain('.vtt');
        const label = page.locator('label:has(input[name="captions"])');
        await expect(label).toBeAttached();
    });

    test('files status live region is present', async ({ page }) => {
        await expect(page.locator('#files-status')).toBeAttached();
        const role = await page.locator('#files-status').getAttribute('aria-live');
        expect(role).toBe('polite');
    });

    test('"Watch recording" link is present and links to playback page', async ({ page }) => {
        const link = page.locator('a').filter({ hasText: 'Watch recording' });
        await expect(link).toBeVisible();
        const href = await link.getAttribute('href');
        expect(href).toMatch(/\/admin\/1\/\d+$/);
    });

    test('breadcrumb has 5 items with aria-current on last', async ({ page }) => {
        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible();
        const items = nav.locator('li');
        await expect(items).toHaveCount(5);
        await expect(items.last()).toHaveAttribute('aria-current', 'page');
    });
});
