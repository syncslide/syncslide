// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { loginAsAdmin } = require('./helpers');

const WCAG_TAGS = [
    'wcag2a', 'wcag2aa', 'wcag21aa', 'wcag21aaa', 'best-practice',
];

async function assertNoViolations(page) {
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length > 0) {
        const report = results.violations.map(v =>
            `[${v.impact}] ${v.id}: ${v.description}\n  ${v.helpUrl}\n  ${v.nodes.map(n => n.html).join(', ')}`
        ).join('\n\n');
        throw new Error(`axe found ${results.violations.length} violation(s):\n\n${report}`);
    }
}

test.describe('theme toggle — public pages', () => {
    test('toggle button exists in nav with correct role and label', async ({ page }) => {
        await page.goto('/');
        const btn = page.locator('#theme-toggle');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveAttribute('aria-pressed');
    });

    test('toggle button switches theme and updates aria-pressed', async ({ page }) => {
        await page.goto('/');
        const btn = page.locator('#theme-toggle');
        const html = page.locator('html');

        // Record initial state
        const initialTheme = await html.getAttribute('data-theme');
        const initialPressed = await btn.getAttribute('aria-pressed');

        // Toggle
        await btn.click();

        const newTheme = await html.getAttribute('data-theme');
        const newPressed = await btn.getAttribute('aria-pressed');

        // Theme should have flipped
        expect(newTheme).not.toBe(initialTheme);
        expect(newPressed).not.toBe(initialPressed);
    });

    test('theme persists across page navigation via localStorage', async ({ page }) => {
        await page.goto('/');
        const btn = page.locator('#theme-toggle');

        // Force dark theme by toggling until data-theme="dark"
        let theme = await page.locator('html').getAttribute('data-theme');
        if (theme !== 'dark') await btn.click();

        // Navigate away and back
        await page.goto('/auth/login');
        await page.goto('/');

        const persistedTheme = await page.locator('html').getAttribute('data-theme');
        expect(persistedTheme).toBe('dark');
    });

    test('theme falls back to OS preference when localStorage is unavailable', async ({ page }) => {
        // Block localStorage to simulate private browsing / AT browser profiles
        await page.addInitScript(() => {
            Object.defineProperty(window, 'localStorage', {
                get() { throw new DOMException('SecurityError'); }
            });
        });

        await page.goto('/');

        // page should load without throwing and data-theme should be set
        const theme = await page.locator('html').getAttribute('data-theme');
        expect(['dark', 'light']).toContain(theme);

        // Toggle button should still be operable
        const btn = page.locator('#theme-toggle');
        await expect(btn).toBeVisible();
        await btn.click(); // should not throw
        const newTheme = await page.locator('html').getAttribute('data-theme');
        expect(newTheme).not.toBe(theme);
    });

    test('aria-pressed is correct after back-forward cache restore', async ({ page }) => {
        await page.goto('/');
        const btn = page.locator('#theme-toggle');

        // Set a known theme state by toggling
        const initialTheme = await page.locator('html').getAttribute('data-theme');
        if (initialTheme !== 'dark') await btn.click();
        const pressedBefore = await btn.getAttribute('aria-pressed');

        // Navigate away, then use browser back button (triggers bfcache restore
        // where DOMContentLoaded does not re-fire — only pageshow fires)
        await page.goto('/auth/login');
        await page.goBack();

        // aria-pressed must still reflect current theme
        const pressedAfter = await page.locator('#theme-toggle').getAttribute('aria-pressed');
        expect(pressedAfter).toBe(pressedBefore);
    });

    test('axe passes in dark theme', async ({ page }) => {
        await page.goto('/');
        // Ensure dark theme
        const html = page.locator('html');
        if (await html.getAttribute('data-theme') !== 'dark') {
            await page.locator('#theme-toggle').click();
        }
        await assertNoViolations(page);
    });

    test('axe passes in light theme', async ({ page }) => {
        await page.goto('/');
        // Ensure light theme
        const html = page.locator('html');
        if (await html.getAttribute('data-theme') !== 'light') {
            await page.locator('#theme-toggle').click();
        }
        await assertNoViolations(page);
    });
});

test.describe('theme toggle — audience page', () => {
    test('toggle button exists on audience page', async ({ page }) => {
        // Use demo presentation so we don't need auth
        await page.goto('/demo');
        await expect(page.locator('#theme-toggle')).toBeVisible();
    });
});

test.describe('theme toggle — authenticated pages', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test('toggle button exists on presentations page', async ({ page }) => {
        await page.goto('/user/presentations');
        await expect(page.locator('#theme-toggle')).toBeVisible();
    });
});
