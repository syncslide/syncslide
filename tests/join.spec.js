// @ts-check
const { test, expect } = require('@playwright/test');

// -- Page load --

test('join page loads with correct h1', async ({ page }) => {
    await page.goto('/join');
    await expect(page.locator('main h1')).toHaveText('Join Presentation');
});

test('join page has correct document title', async ({ page }) => {
    await page.goto('/join');
    await expect(page).toHaveTitle(/Join Presentation/);
});

// -- Form structure --

test('join form has username and code fields with correct labels', async ({ page }) => {
    await page.goto('/join');
    await expect(page.locator('label[for="uname"]')).toHaveText('Username');
    await expect(page.locator('label[for="code"]')).toHaveText('Presentation Code');
    await expect(page.locator('#uname')).toBeVisible();
    await expect(page.locator('#code')).toBeVisible();
    await expect(page.locator('#joinForm button[type="submit"]')).toBeVisible();
});

test('username and code fields have the required attribute', async ({ page }) => {
    await page.goto('/join');
    await expect(page.locator('#uname')).toHaveAttribute('required', '');
    await expect(page.locator('#code')).toHaveAttribute('required', '');
});

// -- Successful join --

test('submitting username and code navigates to /{uname}/{code}', async ({ page }) => {
    // admin/1 is seeded by migrations (admin user, Demo presentation).
    await page.goto('/join');
    await page.fill('#uname', 'admin');
    await page.fill('#code', '1');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/1$/);
    // Audience page loads — #currentSlide is the live region for slide content.
    await expect(page.locator('#currentSlide')).toBeAttached();
});

test('usernames and codes are URL-encoded in the redirect', async ({ page }) => {
    // A username with a space encodes to %20 in the path.
    await page.goto('/join');
    await page.fill('#uname', 'first last');
    await page.fill('#code', '1');
    await page.click('button[type="submit"]');
    // join.js uses encodeURIComponent, so spaces become %20.
    await page.waitForURL(/\/first%20last\/1$/);
});

// -- Invalid / nonexistent presentation --

test('joining a nonexistent presentation navigates to the URL and shows audience page', async ({ page }) => {
    // The server returns the generic audience view for unknown presentation IDs.
    // Title is "Audience" when no presentation context is available.
    await page.goto('/join');
    await page.fill('#uname', 'admin');
    await page.fill('#code', '9999');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/9999$/);
    await expect(page).toHaveTitle(/Audience/);
});

// -- Client-side validation (empty fields) --

test('submitting with empty code field stays on /join', async ({ page }) => {
    // The code field has required; browser validation prevents navigation.
    await page.goto('/join');
    await page.fill('#uname', 'admin');
    // leave #code empty
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/join');
    const codeInvalid = await page.locator('#code').evaluate(
        (/** @type {HTMLInputElement} */ el) => !el.validity.valid
    );
    expect(codeInvalid).toBe(true);
});

test('submitting with empty username field stays on /join', async ({ page }) => {
    await page.goto('/join');
    // leave #uname empty
    await page.fill('#code', '1');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/join');
    const unameInvalid = await page.locator('#uname').evaluate(
        (/** @type {HTMLInputElement} */ el) => !el.validity.valid
    );
    expect(unameInvalid).toBe(true);
});

test('whitespace-only code does not navigate away', async ({ page }) => {
    // Browser required validation passes for whitespace, but join.js trims the
    // value and skips navigation when the result is empty.
    await page.goto('/join');
    await page.fill('#uname', 'admin');
    await page.fill('#code', '   ');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/join');
});

// -- Focus order --

test('tab order through join form: username → code → submit', async ({ page }) => {
    await page.goto('/join');
    await page.locator('#uname').focus();
    await expect(page.locator('#uname')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#code')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#joinForm button[type="submit"]')).toBeFocused();
});

// -- Breadcrumb --

test('join page breadcrumb has two items with aria-current on last', async ({ page }) => {
    await page.goto('/join');
    const nav = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(nav).toBeVisible();
    const items = nav.locator('li');
    await expect(items).toHaveCount(2);
    await expect(items.last()).toHaveAttribute('aria-current', 'page');
});

test('join page breadcrumb first item links to home', async ({ page }) => {
    await page.goto('/join');
    await expect(
        page.locator('nav[aria-label="Breadcrumb"] li').first().locator('a')
    ).toHaveAttribute('href', '/');
});
