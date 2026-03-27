// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin, assertNoViolations } = require('./helpers');

test.describe('theme toggle — public pages', () => {
    test('toggle button exists in nav with correct label', async ({ page }) => {
        await page.goto('/');
        const btn = page.locator('#theme-toggle');
        await expect(btn).toBeVisible();
        const text = await btn.textContent();
        expect(['Enable dark mode', 'Enable light mode']).toContain(text.trim());
    });

    test('toggle button switches theme and updates label', async ({ page }) => {
        await page.goto('/');
        const btn = page.locator('#theme-toggle');
        const html = page.locator('html');

        // Record initial state
        const initialTheme = await html.getAttribute('data-theme');
        const initialText = await btn.textContent();

        // Toggle
        await btn.click();

        const newTheme = await html.getAttribute('data-theme');
        const newText = await btn.textContent();

        // Theme should have flipped
        expect(newTheme).not.toBe(initialTheme);
        expect(newText.trim()).not.toBe(initialText.trim());
        // Label should match new theme
        expect(newText.trim()).toBe(newTheme === 'dark' ? 'Enable light mode' : 'Enable dark mode');
    });

    test('theme persists across page navigation via localStorage', async ({ page }) => {
        await page.goto('/');
        // Clear localStorage once after first load — addInitScript would clear on every navigation
        await page.evaluate(() => { try { localStorage.clear(); } catch(e) {} });
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

    test('button label is correct after back-forward cache restore', async ({ page }) => {
        await page.goto('/');
        const btn = page.locator('#theme-toggle');

        // Set a known theme state by toggling to dark
        const initialTheme = await page.locator('html').getAttribute('data-theme');
        if (initialTheme !== 'dark') await btn.click();

        // Navigate away, then use browser back button (triggers bfcache restore
        // where DOMContentLoaded does not re-fire — only pageshow fires)
        await page.goto('/auth/login');
        await page.goBack();

        const themeAfter = await page.locator('html').getAttribute('data-theme');
        expect(themeAfter).toBe('dark');

        // Label must still reflect current theme
        const textAfter = await page.locator('#theme-toggle').textContent();
        expect(textAfter.trim()).toBe('Enable light mode');
    });

    test('theme toggle button has aria-pressed attribute', async ({ page }) => {
        await page.goto('/');
        const btn = page.locator('#theme-toggle');
        await expect(btn).toHaveAttribute('aria-pressed');
    });

    test('theme toggle aria-pressed reflects current state', async ({ page }) => {
        await page.goto('/');
        const btn = page.locator('#theme-toggle');
        const html = page.locator('html');

        // aria-pressed must match the current theme
        const theme = await html.getAttribute('data-theme');
        const pressed = await btn.getAttribute('aria-pressed');
        // dark mode = pressed (the button represents "dark mode is on")
        expect(pressed).toBe(theme === 'dark' ? 'true' : 'false');

        // Toggle and verify aria-pressed flips
        await btn.click();
        const newTheme = await html.getAttribute('data-theme');
        const newPressed = await btn.getAttribute('aria-pressed');
        expect(newPressed).toBe(newTheme === 'dark' ? 'true' : 'false');
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
