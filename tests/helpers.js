// @ts-check
const { expect } = require('@playwright/test');

/** Logs in as admin/admin and waits for redirect to /. */
async function loginAsAdmin(page) {
    await page.goto('/auth/login');
    await page.fill('[name="username"]', 'admin');
    await page.fill('[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
}

module.exports = { loginAsAdmin };
