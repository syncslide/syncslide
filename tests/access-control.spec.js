// @ts-check
// Tests for presentation access-mode enforcement.
//
// The `access_mode` column controls who may reach GET /{uname}/{pid}:
//   public   → anyone (anonymous or authenticated)
//   audience → authenticated users with the 'audience' role only; anonymous denied
//   private  → owner / editor / controller only; all others denied (HTTP 403)
//
// These tests set the mode via the API and via the Manage Access dialog UI,
// then verify enforcement by requesting the presentation from a separate
// browser context that does not share the admin session.
//
// Reference: the GOV.UK Design System and Google Docs both treat access-gating
// as a security property requiring explicit test coverage, not just UI smoke tests.
//
// Design note: admin is logged in ONCE via test.beforeAll (using a shared context)
// to avoid burning through the login rate limit (burst=5, 1 per 12s).
// Separate user logins are kept to the minimum needed.

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAs } = require('./helpers');

const BASE = 'http://localhost:5003';
const PRES_URL = `${BASE}/admin/1`;   // Demo presentation (pid=1, owner=admin)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set access mode for a presentation via the API (requires authenticated request). */
async function setAccessMode(request, pid, mode) {
    const resp = await request.post(`${BASE}/user/presentations/${pid}/access/mode`, {
        form: { mode },
    });
    // Success redirects to /user/presentations — final status is 200.
    expect(resp.ok()).toBeTruthy();
}

/** Add a user to a presentation with the given role (requires authenticated request). */
async function addAccess(request, pid, username, role) {
    const resp = await request.post(`${BASE}/user/presentations/${pid}/access/add`, {
        form: { username, role },
    });
    expect(resp.ok()).toBeTruthy();
}

/** Create a user account if it does not already exist (idempotent). */
async function ensureUser(request, username, password) {
    await request.post(`${BASE}/user/new`, {
        form: { name: username, email: `${username}@example.com`, password },
    });
    // POST /user/new returns 200 (redirect) on success and 500 if duplicate.
    // Either outcome is acceptable — we only need the account to exist.
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('access-mode enforcement', () => {
    // Each test in this suite modifies the Demo presentation (pid=1).
    // The admin browser context is shared across all tests via beforeAll to
    // avoid exceeding the login rate limit (burst=5 per 127.0.0.1).
    // afterEach resets access_mode to 'public' so sibling tests and other spec
    // files are not affected.

    let adminCtx;
    let adminRequest; // APIRequestContext from the authenticated admin context

    test.beforeAll(async ({ browser }) => {
        // Log in as admin ONCE for all five tests in this suite.
        adminCtx = await browser.newContext();
        const adminPage = await adminCtx.newPage();
        await adminPage.goto(BASE);
        await loginAsAdmin(adminPage);
        adminRequest = adminCtx.request;
    });

    test.afterAll(async () => {
        await adminCtx.close();
    });

    test.afterEach(async () => {
        await setAccessMode(adminRequest, 1, 'public');
    });

    // -----------------------------------------------------------------------
    // 1. Private mode — anonymous user
    // -----------------------------------------------------------------------
    test('private presentation returns 403 for anonymous user', async ({ browser }) => {
        await setAccessMode(adminRequest, 1, 'private');

        const anonCtx = await browser.newContext();
        try {
            const anonPage = await anonCtx.newPage();
            const response = await anonPage.goto(PRES_URL);
            expect(response?.status()).toBe(403);
        } finally {
            await anonCtx.close();
        }
    });

    // -----------------------------------------------------------------------
    // 2. Private mode — logged-in non-owner
    // -----------------------------------------------------------------------
    test('private presentation returns 403 for logged-in non-owner', async ({ browser }) => {
        await ensureUser(adminRequest, 'ac_viewer', 'viewpass');
        await setAccessMode(adminRequest, 1, 'private');

        const viewerCtx = await browser.newContext();
        try {
            const viewerPage = await viewerCtx.newPage();
            await viewerPage.goto(BASE);
            await loginAs(viewerPage, 'ac_viewer', 'viewpass');
            const response = await viewerPage.goto(PRES_URL);
            expect(response?.status()).toBe(403);
        } finally {
            await viewerCtx.close();
        }
    });

    // -----------------------------------------------------------------------
    // 3. Audience mode — anonymous user is denied
    // -----------------------------------------------------------------------
    test('audience-mode presentation returns 403 for anonymous user', async ({ browser }) => {
        await setAccessMode(adminRequest, 1, 'audience');

        const anonCtx = await browser.newContext();
        try {
            const anonPage = await anonCtx.newPage();
            const response = await anonPage.goto(PRES_URL);
            expect(response?.status()).toBe(403);
        } finally {
            await anonCtx.close();
        }
    });

    // -----------------------------------------------------------------------
    // 4. Audience mode — user with audience role can view
    // -----------------------------------------------------------------------
    test('audience-mode presentation allows user granted the audience role', async ({ browser }) => {
        await ensureUser(adminRequest, 'ac_audience', 'audpass');
        await setAccessMode(adminRequest, 1, 'audience');
        await addAccess(adminRequest, 1, 'ac_audience', 'audience');

        const audCtx = await browser.newContext();
        try {
            const audPage = await audCtx.newPage();
            await audPage.goto(BASE);
            await loginAs(audPage, 'ac_audience', 'audpass');
            const response = await audPage.goto(PRES_URL);
            expect(response?.status()).toBe(200);
            // Must render the audience view (not the stage):
            // #currentSlide is present on audience.html; #qrToggle is stage-only.
            await expect(audPage.locator('#currentSlide')).toBeVisible();
            await expect(audPage.locator('#qrToggle')).not.toBeAttached();
        } finally {
            await audCtx.close();
        }
    });

    // -----------------------------------------------------------------------
    // 5. Mode switch via UI — changing via the Manage Access dialog takes effect
    // -----------------------------------------------------------------------
    test('visibility select change to private takes effect after save', async ({ browser }) => {
        // Open a fresh admin browser page for UI interaction.
        const uiCtx = await browser.newContext();
        try {
            const uiPage = await uiCtx.newPage();
            await uiPage.goto(BASE);
            await loginAsAdmin(uiPage);

            // Open the Manage Access dialog for presentation 1.
            await uiPage.goto(`${BASE}/user/presentations`);
            await uiPage.locator('#actions-btn-1').click();
            await uiPage.locator('#actions-menu-1 [role="menuitem"]')
                .filter({ hasText: 'Manage access' }).click();
            const dialog = uiPage.locator('#manage-access-1');
            await expect(dialog).toBeVisible();

            // Change the visibility select to 'private'.
            await dialog.locator('.visibility-select').selectOption('private');

            // Clicking Close with unsaved changes must reveal the unsaved-confirm panel.
            await dialog.locator('.manage-access-close').click();
            await expect(dialog.locator('.unsaved-confirm')).toBeVisible();

            // Click Save to persist the mode change via fetch.
            await dialog.locator('.unsaved-save').click();
            await expect(dialog).not.toBeVisible();
        } finally {
            await uiCtx.close();
        }

        // An anonymous user must now be denied.
        const anonCtx = await browser.newContext();
        try {
            const anonPage = await anonCtx.newPage();
            const response = await anonPage.goto(PRES_URL);
            expect(response?.status()).toBe(403);
        } finally {
            await anonCtx.close();
        }
    });
});
