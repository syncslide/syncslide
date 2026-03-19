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
    await expect(accountNav.locator('button[aria-expanded]')).toContainText('admin');
});

test('account submenu reveals Change Password and Logout when opened', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await accountNav.locator('button[aria-expanded]').click();
    await expect(accountNav.getByRole('link', { name: 'Change Password' })).toBeVisible();
    await expect(accountNav.getByRole('link', { name: 'Logout' })).toBeVisible();
});

test('account submenu reveals Add User link for admin users', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await accountNav.locator('button[aria-expanded]').click();
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

// -- Hamburger: desktop --
test('hamburger button is not visible on desktop', async ({ page }) => {
    await page.goto('/');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await expect(hamburger).toBeHidden();
});

// -- Hamburger: mobile --
test('hamburger button is visible on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await expect(hamburger).toBeVisible();
});

test('primary nav links are hidden by default on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.locator('#primary-nav-list')).toBeHidden();
});

test('clicking hamburger shows primary nav links on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await hamburger.click();
    await expect(page.locator('#primary-nav-list')).toBeVisible();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
});

test('clicking hamburger again hides primary nav links on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await hamburger.click();
    await hamburger.click();
    await expect(page.locator('#primary-nav-list')).toBeHidden();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
});

// -- Keyboard: hamburger --
test('hamburger toggles with Enter key on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await hamburger.focus();
    await page.keyboard.press('Enter');
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
});

test('hamburger toggles with Space key on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await hamburger.focus();
    await page.keyboard.press('Space');
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
});

// -- Escape key --
test('Escape closes open hamburger menu and returns focus to hamburger', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await hamburger.click();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    await expect(hamburger).toBeFocused();
});

test('Escape closes open Account submenu', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountBtn = page.locator('nav[aria-label="Account"] button[aria-expanded]');
    await accountBtn.click();
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(accountBtn).toBeFocused();
});

test('Escape on desktop does not move focus to hidden hamburger', async ({ page }) => {
    // Desktop viewport: hamburger is display:none. Escape from Account submenu
    // must not send focus to the hidden hamburger element — focus stays on Account button.
    await loginAsAdmin(page);
    await page.goto('/');
    const accountBtn = page.locator('nav[aria-label="Account"] button[aria-expanded]');
    await accountBtn.click();
    await page.keyboard.press('Escape');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await expect(hamburger).not.toBeFocused();
    await expect(accountBtn).toBeFocused();
});

test('Escape while Account submenu open on mobile returns focus to hamburger', async ({ page }) => {
    // On mobile, both menus are visible. Escape from the Account submenu (without
    // opening the primary nav) must still return focus to the hamburger — the
    // spec defines the hamburger as the outermost trigger for focus return.
    await loginAsAdmin(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const accountBtn = page.locator('nav[aria-label="Account"] button[aria-expanded]');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await accountBtn.click();
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(hamburger).toBeFocused();
});

// -- Account submenu: aria-expanded state --
test('account button has aria-expanded="false" when submenu is closed', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountBtn = page.locator('nav[aria-label="Account"] button[aria-expanded]');
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'false');
});

test('account button has aria-expanded="true" when submenu is open', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountBtn = page.locator('nav[aria-label="Account"] button[aria-expanded]');
    await accountBtn.click();
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'true');
});

test('account submenu is hidden when closed', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    await expect(page.locator('#account-menu')).toBeHidden();
});

// -- role="list" on nav ULs --
test('primary nav ul has role="list"', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#primary-nav-list')).toHaveAttribute('role', 'list');
});

test('account menu ul has role="list"', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    await expect(page.locator('#account-menu')).toHaveAttribute('role', 'list');
});
