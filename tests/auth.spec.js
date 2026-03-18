// @ts-check
const { test, expect } = require('@playwright/test');

// Reusable helper — logs in as admin/admin and returns after the redirect to /.
async function loginAsAdmin(page) {
    await page.goto('/auth/login');
    await page.fill('[name="username"]', 'admin');
    await page.fill('[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
}

// Correct credentials → redirected to /.
test('login with correct credentials redirects to home', async ({ page }) => {
    await page.goto('/auth/login');
    await page.fill('[name="username"]', 'admin');
    await page.fill('[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
    // First element announced on arrival: the page's h1.
    await expect(page.locator('main h1')).toBeVisible();
});

// Wrong password → stays on login page, login form is still present.
// The app currently re-renders the login page without an explicit error message.
// This is a WCAG 3.3.1 (Error Identification, Level A) violation — the user is
// given no feedback about what went wrong. The accessibility.spec.js axe audit
// may not catch this automatically (axe cannot detect absent text). A separate
// task should add an error message to the login template; once that is done,
// this test should be updated to assert the error is present.
test('login with wrong password stays on login page', async ({ page }) => {
    await page.goto('/auth/login');
    await page.fill('[name="username"]', 'admin');
    await page.fill('[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/auth/login');
    // Login form must remain visible so the user can try again.
    await expect(page.locator('form[action="/auth/login"]')).toBeVisible();
});

// No session → visiting a protected route redirects to login.
test('accessing protected page without session redirects to login', async ({ page }) => {
    await page.goto('/user/presentations');
    await expect(page).toHaveURL('/auth/login');
});

// Valid session → protected page loads.
test('valid session grants access to presentations page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/user/presentations');
    await expect(page).toHaveURL('/user/presentations');
    await expect(page.locator('main h1')).toHaveText('Your Presentations');
});

// Logout → session ended → login link visible in nav.
test('logout ends session and login link appears in nav', async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('nav a[href="/auth/logout"]');
    // Wait for the redirect to complete before asserting nav state.
    await page.waitForURL('/');
    // After logout, the login link must appear in the navigation.
    await expect(page.locator('nav a[href="/auth/login"]')).toBeVisible();
});

// After logout, protected pages redirect to login again.
test('after logout, protected pages redirect to login', async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('nav a[href="/auth/logout"]');
    await page.waitForURL('/');
    await page.goto('/user/presentations');
    await expect(page).toHaveURL('/auth/login');
});
