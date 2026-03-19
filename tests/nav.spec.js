// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

// -- Skip link --
test('skip link is first link in body and targets #main', async ({ page }) => {
    await page.goto('/');
    const skipLink = page.locator('body > a.skip-link').first();
    await expect(skipLink).toHaveAttribute('href', '#main');
});

test('#main has tabindex="-1" for reliable skip link focus', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#main')).toHaveAttribute('tabindex', '-1');
});

// -- Primary nav: logged-out --
test('primary nav link order when logged out', async ({ page }) => {
    await page.goto('/');
    const links = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link');
    const texts = await links.allTextContents();
    expect(texts).toEqual(['Home', 'Join presentation', 'Help', 'Login']);
});

// -- Primary nav: logged-in --
test('primary nav has correct links when logged in', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const links = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link');
    const texts = await links.allTextContents();
    expect(texts[0]).toBe('Home');
    expect(texts[1]).toBe('Join presentation');
    expect(texts[2]).toBe('Help');
    expect(texts[3]).toBe('Create presentation');
    // Presentations link includes pres count: "Presentations (N)"
    expect(texts[4]).toMatch(/^Presentations \(\d+\)$/);
    // Account-only links must not appear in Primary nav
    expect(texts).not.toContain('Login');
    expect(texts).not.toContain('Logout');
    expect(texts).not.toContain('Change Password');
});

// -- Account nav: logged-in --
test('account nav exists with username as disclosure trigger', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await expect(accountNav).toBeVisible();
    await expect(accountNav.locator('summary')).toContainText('admin');
});

test('account submenu reveals Change Password and Logout when opened', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await accountNav.locator('summary').click();
    await expect(accountNav.getByRole('link', { name: 'Change Password' })).toBeVisible();
    await expect(accountNav.getByRole('link', { name: 'Logout' })).toBeVisible();
});

test('account submenu reveals Add User link for admin users', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await accountNav.locator('summary').click();
    await expect(accountNav.getByRole('link', { name: 'Add User' })).toBeVisible();
});

// -- Account nav: logged-out --
test('no Account nav when logged out', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Account' })).toHaveCount(0);
});

// -- DOM order: theme toggle comes after nav elements --
test('theme toggle appears after Account nav in header DOM order (logged-in)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const isAfter = await page.evaluate(() => {
        const header = document.querySelector('header');
        const accountNav = header.querySelector('nav[aria-label="Account"]');
        const toggle = header.querySelector('#theme-toggle');
        if (!accountNav || !toggle) return false;
        // DOCUMENT_POSITION_FOLLOWING means toggle comes after accountNav
        return !!(accountNav.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(isAfter).toBe(true);
});

test('theme toggle appears after Primary nav in header DOM order (logged-out)', async ({ page }) => {
    await page.goto('/');
    const isAfter = await page.evaluate(() => {
        const header = document.querySelector('header');
        const primaryNav = header.querySelector('nav[aria-label="Primary navigation"]');
        const toggle = header.querySelector('#theme-toggle');
        if (!primaryNav || !toggle) return false;
        return !!(primaryNav.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(isAfter).toBe(true);
});
