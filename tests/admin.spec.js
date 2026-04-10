// @ts-check
// E2E tests for admin user-management flows:
//   • GET/POST /user/new       – add a new system user (POST is admin-only)
//   • POST /user/presentations/{pid}/access/change-role – change a shared user's role (owner-only)
//
// Both routes are authorization-sensitive with zero prior E2E coverage.
//
// Reference: GOV.UK Design System and its companion test suite (govuk-frontend on
// GitHub) test every admin-gated page with explicit authorization checks in each
// scenario, never relying on shared auth state between tests.
//
// NOTE — known gap found during test authoring (reported separately to Engineering
// Lead): GET /user/new renders the form for ANY authenticated user, not just admins.
// Only the POST handler enforces the admin group check. A non-admin can see the
// "Add User" form but receives a 404 on submit — a confusing and potentially
// information-leaking UX.
//
// AUTH STRATEGY:
// POST /auth/login is rate-limited to burst=5 / replenish=1 per 12 s.
// To stay well within that budget, a single file-level test.beforeAll captures
// all required sessions (admin, non-admin, non-owner) before any tests run.
// Every test injects the appropriate saved cookies into its fresh page via
// page.context().addCookies(), avoiding repeated login requests entirely.
// This pattern keeps the total login count at 3 for the entire file, regardless
// of how many tests run or how many retries occur.

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAs, assertNoViolations } = require('./helpers');

const BASE = 'http://localhost:5003';

// Fixed usernames so the file-level beforeAll creates them exactly once.
// Unique enough for a fresh test DB; collide gracefully if the DB is pre-seeded.
const NON_ADMIN_USER = 'admin_spec_nonadmin';
const NON_ADMIN_PASS = 'nonadminpass1';
const NON_OWNER_USER = 'admin_spec_nonowner';
const NON_OWNER_PASS = 'noownerpass1';

// ---------------------------------------------------------------------------
// Shared session state — populated once in beforeAll, reused in every test.
// ---------------------------------------------------------------------------
/** @type {import('@playwright/test').Cookie[]} */
let adminCookies;
/** @type {import('@playwright/test').Cookie[]} */
let nonAdminCookies;
/** @type {import('@playwright/test').Cookie[]} */
let nonOwnerCookies;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Logs in and returns the cookies for re-use.  One call per user, not per test.
 */
async function captureCookies(browser, username, password) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, username, password);
    const cookies = await ctx.cookies();
    await ctx.close();
    return cookies;
}

/**
 * Creates a fresh user account via the admin API (POST /user/new).
 * Caller's page must have an active admin session.
 */
async function adminCreateUser(page, username, password) {
    return page.request.post('/user/new', {
        form: {
            name: username,
            email: `${username}@example.com`,
            password,
        },
    });
}

/**
 * Creates a presentation via the UI and returns its numeric id.
 * Caller's page must have an active admin session.
 */
async function createPresentation(page, name) {
    await page.goto('/create');
    await page.fill('[name="name"]', name);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/\d+/);
    const match = page.url().match(/\/admin\/(\d+)/);
    if (!match) throw new Error(`Could not extract pid from URL: ${page.url()}`);
    return parseInt(match[1], 10);
}

/**
 * Adds a user to a presentation via the API.
 * Caller's page must be the presentation owner's session.
 */
async function addAccess(page, pid, username, role) {
    const resp = await page.request.post(`/user/presentations/${pid}/access/add`, {
        form: { username, role },
    });
    expect(resp.ok()).toBeTruthy();
}

// ---------------------------------------------------------------------------
// File-level setup — runs once before any test in this file.
// Establishes all sessions needed by the tests (3 logins total).
// ---------------------------------------------------------------------------
test.beforeAll(async ({ browser }) => {
    // Login 1: admin session.
    // loginAsAdmin uses 'admin'/'admin' — seeded by migrations.
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await loginAsAdmin(adminPage);
    adminCookies = await adminCtx.cookies();

    // Create the helper accounts using the already-open admin session.
    await adminPage.request.post('/user/new', {
        form: { name: NON_ADMIN_USER, email: `${NON_ADMIN_USER}@example.com`, password: NON_ADMIN_PASS },
    });
    await adminPage.request.post('/user/new', {
        form: { name: NON_OWNER_USER, email: `${NON_OWNER_USER}@example.com`, password: NON_OWNER_PASS },
    });
    await adminCtx.close();

    // Login 2: non-admin session.
    nonAdminCookies = await captureCookies(browser, NON_ADMIN_USER, NON_ADMIN_PASS);

    // Login 3: non-owner session.
    nonOwnerCookies = await captureCookies(browser, NON_OWNER_USER, NON_OWNER_PASS);
});

// ---------------------------------------------------------------------------
// Suite: POST /user/new — admin creates a new user
// ---------------------------------------------------------------------------

test.describe('add_user — admin creates a new system user', () => {
    test.beforeEach(async ({ page }) => {
        // Inject saved admin session cookies — no login request needed.
        await page.context().addCookies(adminCookies);
    });

    // 1. Happy path: admin creates a user and the user can be looked up afterwards.
    // "User appears in user list" is verified via GET /users/exists, the dedicated
    // lookup endpoint, since there is no admin user-list page.
    test('admin can add a new user — user is queryable via /users/exists', async ({ page }) => {
        const username = `newu_${Date.now()}`;

        const resp = await adminCreateUser(page, username, 'securepass1');
        // Success: server redirects to /user/presentations; Playwright follows
        // redirects so the final status is 200.
        expect(resp.ok()).toBeTruthy();

        // Verify the user record exists.
        const exists = await page.request.get(`/users/exists?username=${username}`);
        expect(exists.status()).toBe(200);
    });

    // 2. Non-admin POST is denied — the backend hides the route with a 404 so that
    // non-admin users cannot even confirm the endpoint exists.
    test('non-admin cannot POST /user/new — receives 404', async ({ browser }) => {
        // Use pre-captured non-admin session — no new login request.
        const nonAdminCtx = await browser.newContext();
        const nonAdminPage = await nonAdminCtx.newPage();
        await nonAdminPage.context().addCookies(nonAdminCookies);

        try {
            const resp = await nonAdminPage.request.post('/user/new', {
                form: {
                    name: `denied_${Date.now()}`,
                    email: `denied_${Date.now()}@example.com`,
                    password: 'denypass',
                },
            });
            // 404: the backend hides the admin-only endpoint from non-admin callers.
            expect(resp.status()).toBe(404);
        } finally {
            await nonAdminCtx.close();
        }
    });

    // 3. Duplicate username: the second attempt must fail.
    // Current backend behaviour: returns 500 (no user-facing error page yet).
    test('creating a duplicate username returns a server error', async ({ page }) => {
        const username = `dup_${Date.now()}`;

        const first = await adminCreateUser(page, username, 'pass1');
        expect(first.ok()).toBeTruthy();

        const second = await adminCreateUser(page, username, 'pass2');
        expect(second.status()).toBe(500);
    });

    // 4. Browser-level validation: the form uses `required` on every input.
    // Submitting with all fields empty must keep the user on /user/new (the
    // browser blocks the request before it reaches the server).
    // WCAG 3.3.1 Error Identification (Level A): users must be informed of errors.
    test('submitting the add-user form with empty fields stays on the form', async ({ page }) => {
        await page.goto('/user/new');
        await page.click('button[type="submit"]');
        // Browser validation must prevent navigation.
        await expect(page).toHaveURL('/user/new');
        // The name input must be marked invalid by the constraint validation API.
        const nameInvalid = await page.locator('#name').evaluate(
            (/** @type {HTMLInputElement} */ el) => !el.validity.valid
        );
        expect(nameInvalid).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Suite: POST /user/presentations/{pid}/access/change-role — owner changes a role
// ---------------------------------------------------------------------------

test.describe('change_role — presentation owner changes a shared user\'s role', () => {
    /** @type {number} */
    let pid;
    /** @type {string} */
    let sharedUser;

    test.beforeEach(async ({ page }) => {
        // Inject admin cookies — no login request.
        await page.context().addCookies(adminCookies);
        // Create a fresh presentation owned by admin so tests are isolated.
        pid = await createPresentation(page, `Role Test ${Date.now()}`);
        // Create a user to share the presentation with (unique per test).
        sharedUser = `shared_${Date.now()}`;
        await adminCreateUser(page, sharedUser, 'sharedpass1');
        // Grant them "editor" access to start with.
        await addAccess(page, pid, sharedUser, 'editor');
    });

    // 3. Owner changes a shared user's role — the Manage Access dialog reflects
    // the new role after the page reloads, confirming the DB was updated.
    // This exercises the full UI path: select → Close → Save → reload → verify.
    test('owner changes a shared user\'s role via the Manage Access dialog', async ({ page }) => {
        await page.goto('/user/presentations');

        // Open the Manage Access dialog for the test presentation.
        await page.locator(`#actions-btn-${pid}`).click();
        await page.locator(`#actions-menu-${pid} [role="menuitem"]`)
            .filter({ hasText: 'Manage access' }).click();
        const dialog = page.locator(`#manage-access-${pid}`);
        await expect(dialog).toBeVisible();

        // Change the role from "editor" to "controller".
        const roleSelect = dialog.locator(`select[aria-label="Role for ${sharedUser}"]`);
        await expect(roleSelect).toHaveValue('editor');
        await roleSelect.selectOption('controller');

        // Close with pending changes → unsaved confirm must appear.
        await dialog.locator('.manage-access-close').click();
        await expect(dialog.locator('.unsaved-confirm')).toBeVisible();

        // Save → page reloads.
        await dialog.locator('.unsaved-save').click();
        await page.waitForURL('/user/presentations');
        await page.waitForLoadState('domcontentloaded');

        // Reopen the dialog and confirm the role is now "controller".
        await page.locator(`#actions-btn-${pid}`).click();
        await page.locator(`#actions-menu-${pid} [role="menuitem"]`)
            .filter({ hasText: 'Manage access' }).click();
        await expect(dialog).toBeVisible();
        await expect(dialog.locator(`select[aria-label="Role for ${sharedUser}"]`))
            .toHaveValue('controller');
    });

    // 4. Non-owner cannot change roles — the backend returns 404 to hide which
    // presentations exist, consistent with the ownership-check pattern elsewhere.
    test('non-owner cannot change roles on a presentation they do not own', async ({ browser }) => {
        // Use pre-captured non-owner session — no new login request.
        const nonOwnerCtx = await browser.newContext();
        const nonOwnerPage = await nonOwnerCtx.newPage();
        await nonOwnerPage.context().addCookies(nonOwnerCookies);

        try {
            // Attempt to change a role on a presentation they do not own.
            // user_id=1 corresponds to the seeded admin user in a fresh test DB.
            const resp = await nonOwnerPage.request.post(
                `/user/presentations/${pid}/access/change-role`,
                { form: { user_id: '1', role: 'controller' } }
            );
            // 404: backend hides ownership information from non-owners.
            expect(resp.status()).toBe(404);
        } finally {
            await nonOwnerCtx.close();
        }
    });
});

// ---------------------------------------------------------------------------
// Suite: accessibility — /user/new form
// ---------------------------------------------------------------------------

test.describe('add_user form — accessibility', () => {
    test.beforeEach(async ({ page }) => {
        // Inject admin cookies — no login request.
        await page.context().addCookies(adminCookies);
    });

    // 6a. Axe-core audit: the page must not introduce regressions against the
    // WCAG 2.x and best-practice tags that the rest of the test suite enforces.
    test('/user/new has no axe violations', async ({ page }) => {
        await page.goto('/user/new');
        await assertNoViolations(page);
    });

    // 6b. All form inputs must have programmatic label associations.
    // WCAG 1.3.1 Info and Relationships (Level A).
    test('all form inputs have associated <label> elements', async ({ page }) => {
        await page.goto('/user/new');
        const inputs = page.locator('form input:not([type="hidden"])');
        const count = await inputs.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
            const id = await inputs.nth(i).getAttribute('id');
            if (id) {
                await expect(page.locator(`label[for="${id}"]`)).toBeAttached();
            }
        }
    });

    // 6c. Tab sequence must follow DOM order: Name → Email → Password → Submit.
    // WCAG 2.4.3 Focus Order (Level A): focus must follow a meaningful sequence.
    // Reference: GOV.UK Design System forms always use natural DOM tab order and
    // never override it with positive tabindex values.
    test('tab order through the form follows DOM order', async ({ page }) => {
        await page.goto('/user/new');

        // Move to the Name field and step through the form.
        await page.locator('#name').focus();
        await expect(page.locator('#name')).toBeFocused();

        await page.keyboard.press('Tab');
        await expect(page.locator('#email')).toBeFocused();

        await page.keyboard.press('Tab');
        await expect(page.locator('#password')).toBeFocused();

        await page.keyboard.press('Tab');
        await expect(page.locator('button[type="submit"]')).toBeFocused();
    });
});
