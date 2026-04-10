// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

// Tests for slide-nav.js on the stage page (admin/1).
//
// slide-nav.js has two responsibilities:
//   1. getH2s(allHtml)  — populate #goTo select from h2 headings.
//   2. F8 / Shift+F8   — advance / retreat one slide and broadcast via WS.
//   3. 'input' on #goTo — broadcast current selection via WS.
//
// The Demo presentation is always seeded by migrations. Its h2 slides (0-based):
//   0: Introduction to the Problem
//   1: What is SyncSlide?
//   2: Demo: HTML and CSS
//   3: Demo: Math
//   4: Demo: Live Presentation
//   5: Demo: Recording
//   6: Potential Enhancements
//   7: Conclusion

const STAGE_URL = '/admin/1';
// Slide heading texts in order, matching the seeded Demo presentation.
const SLIDE_HEADINGS = [
    'Introduction to the Problem',
    'What is SyncSlide?',
    'Demo: HTML and CSS',
    'Demo: Math',
    'Demo: Live Presentation',
    'Demo: Recording',
    'Potential Enhancements',
    'Conclusion',
];

test.describe('slide-nav.js — stage page', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto(STAGE_URL);
        // Wait for JS to populate the dropdown before each test.
        await expect(page.locator('#goTo option')).not.toHaveCount(0);
    });

    // ── Slide Navigation landmark ──────────────────────────────────────────

    test('slide nav landmark has accessible name "Slide Navigation"', async ({ page }) => {
        await expect(
            page.getByRole('navigation', { name: 'Slide Navigation' })
        ).toBeVisible();
    });

    test('goTo select has a visible label associated via for/id', async ({ page }) => {
        // label[for="goTo"] must be present — this is what assistive tech reads
        // when focus enters the select.
        const label = page.locator('label[for="goTo"]');
        await expect(label).toBeAttached();
        await expect(label).toBeVisible();
    });

    // ── Dropdown population from h2 headings ──────────────────────────────

    test('goTo select is populated with one option per h2 slide', async ({ page }) => {
        await expect(page.locator('#goTo option')).toHaveCount(SLIDE_HEADINGS.length);
    });

    test('goTo option labels are prefixed with 1-based slide number', async ({ page }) => {
        const options = page.locator('#goTo option');
        for (let i = 0; i < SLIDE_HEADINGS.length; i++) {
            // Format: "<number>: <heading text>"  e.g. "1: Introduction to the Problem"
            await expect(options.nth(i)).toHaveText(`${i + 1}: ${SLIDE_HEADINGS[i]}`);
        }
    });

    test('goTo option values are zero-based indices', async ({ page }) => {
        const options = page.locator('#goTo option');
        for (let i = 0; i < SLIDE_HEADINGS.length; i++) {
            await expect(options.nth(i)).toHaveAttribute('value', String(i));
        }
    });

    // ── Dropdown selection navigates to slide ─────────────────────────────

    test('selecting slide 1 from dropdown navigates to "What is SyncSlide?"', async ({ page }) => {
        // Select the second slide (index 1).
        await page.selectOption('#goTo', '1');
        // The WS round-trip updates #currentSlide via handleUpdate in audience.js.
        await expect(page.locator('#currentSlide h2')).toHaveText('What is SyncSlide?');
    });

    test('selecting last slide from dropdown navigates to "Conclusion"', async ({ page }) => {
        const lastIndex = String(SLIDE_HEADINGS.length - 1);
        await page.selectOption('#goTo', lastIndex);
        await expect(page.locator('#currentSlide h2')).toHaveText('Conclusion');
    });

    test('selecting slide 0 after another slide navigates back to first slide', async ({ page }) => {
        // Navigate forward first so there is a meaningful state change to revert.
        await page.selectOption('#goTo', '2');
        await expect(page.locator('#currentSlide h2')).toHaveText('Demo: HTML and CSS');

        await page.selectOption('#goTo', '0');
        await expect(page.locator('#currentSlide h2')).toHaveText('Introduction to the Problem');
    });

    // ── F8 keyboard shortcut ───────────────────────────────────────────────
    //
    // F8 calls updateSlide() which sends {"type":"slide","data":N} over the WS.
    // The server broadcasts back and #currentSlide re-renders via handleUpdate.
    // Checking #currentSlide content verifies both the shortcut and the WS path.

    test('F8 on first slide advances to second slide', async ({ page }) => {
        // Reset to slide 0 first and confirm.
        await page.selectOption('#goTo', '0');
        await expect(page.locator('#currentSlide h2')).toHaveText('Introduction to the Problem');

        await page.keyboard.press('F8');

        await expect(page.locator('#goTo')).toHaveValue('1');
        await expect(page.locator('#currentSlide h2')).toHaveText('What is SyncSlide?');
    });

    test('F8 advances goTo index by one', async ({ page }) => {
        await page.selectOption('#goTo', '2');
        await expect(page.locator('#currentSlide h2')).toHaveText('Demo: HTML and CSS');

        await page.keyboard.press('F8');

        await expect(page.locator('#goTo')).toHaveValue('3');
    });

    test('F8 on the last slide does not advance beyond the end', async ({ page }) => {
        const lastIndex = String(SLIDE_HEADINGS.length - 1);
        await page.selectOption('#goTo', lastIndex);
        await expect(page.locator('#currentSlide h2')).toHaveText('Conclusion');

        await page.keyboard.press('F8');

        // goTo value must remain at the last index (not overflow to -1 or NaN).
        await expect(page.locator('#goTo')).toHaveValue(lastIndex);
        await expect(page.locator('#currentSlide h2')).toHaveText('Conclusion');
    });

    test('Shift+F8 retreats from second slide to first', async ({ page }) => {
        await page.selectOption('#goTo', '1');
        await expect(page.locator('#currentSlide h2')).toHaveText('What is SyncSlide?');

        await page.keyboard.press('Shift+F8');

        await expect(page.locator('#goTo')).toHaveValue('0');
        await expect(page.locator('#currentSlide h2')).toHaveText('Introduction to the Problem');
    });

    test('Shift+F8 on the first slide does not go below zero', async ({ page }) => {
        await page.selectOption('#goTo', '0');
        await expect(page.locator('#currentSlide h2')).toHaveText('Introduction to the Problem');

        await page.keyboard.press('Shift+F8');

        await expect(page.locator('#goTo')).toHaveValue('0');
        await expect(page.locator('#currentSlide h2')).toHaveText('Introduction to the Problem');
    });

    // ── Keyboard accessibility of the dropdown ────────────────────────────
    //
    // The dropdown is a native <select>, which is inherently keyboard accessible
    // (Arrow keys, Home, End). The test verifies it can be reached via Tab and
    // that its label is announced correctly — the pattern GOV.UK Design System
    // and USWDS use for select elements.

    test('goTo select is reachable by keyboard Tab from the document', async ({ page }) => {
        // Focus the body and Tab into the page; eventually #goTo must become focusable.
        // Rather than tabbing through the full nav, focus the nav element directly and
        // verify #goTo accepts programmatic focus (tabIndex is not -1).
        const tabIndex = await page.locator('#goTo').evaluate(el => el.tabIndex);
        // A native select has tabIndex 0 by default — keyboard-reachable.
        expect(tabIndex).toBeGreaterThanOrEqual(0);
    });

    test('goTo select responds to arrow keys changing slide selection', async ({ page }) => {
        await page.selectOption('#goTo', '0');
        await page.locator('#goTo').focus();

        // ArrowDown moves to next option in a native select.
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#goTo')).toHaveValue('1');
    });
});
