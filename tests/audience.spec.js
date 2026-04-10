// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

// The Demo presentation (id=1, owned by admin) is seeded by migrations with
// access_mode='public' (the column default), so anonymous users can reach it.
// GET /admin/1:
//   - unauthenticated → renders audience.html (this spec's focus)
//   - authenticated as owner/editor/controller → renders stage.html
const AUDIENCE_URL = '/admin/1';
const STAGE_URL = '/admin/1';   // same path; template depends on auth

// ---------------------------------------------------------------------------
// Page structure — anonymous user receives audience.html
// ---------------------------------------------------------------------------
test.describe('audience page structure - anonymous user', () => {
    // audience.html is the base template. stage.html extends it and adds
    // stage-only elements (#qrToggle, #qrOverlay, recording controls).
    // An unauthenticated visitor must get the base template only.

    test('page loads for anonymous user without redirecting (HTTP 200)', async ({ page }) => {
        const response = await page.goto(AUDIENCE_URL);
        expect(response?.status()).toBe(200);
    });

    test('page title includes the presentation name', async ({ page }) => {
        await page.goto(AUDIENCE_URL);
        await expect(page).toHaveTitle(/Demo/);
    });

    test('#currentSlide has aria-live="polite"', async ({ page }) => {
        await page.goto(AUDIENCE_URL);
        await expect(page.locator('#currentSlide')).toHaveAttribute('aria-live', 'polite');
    });

    test('#currentSlide has aria-label "Current slide"', async ({ page }) => {
        await page.goto(AUDIENCE_URL);
        await expect(page.locator('#currentSlide')).toHaveAttribute('aria-label', 'Current slide');
    });

    test('initial slide is server-rendered — presentation name appears as h1 in #currentSlide', async ({ page }) => {
        await page.goto(AUDIENCE_URL);
        // render_slide() on the server prepends <h1>{pres_name}</h1> before the slide HTML.
        // This must be present on page load, before any WebSocket message arrives.
        await expect(page.locator('#currentSlide h1')).toHaveText('Demo');
    });

    test('initial slide is server-rendered — a slide heading (h2) is present in #currentSlide', async ({ page }) => {
        await page.goto(AUDIENCE_URL);
        // Confirms that initial_slide is non-empty and the Markdown was rendered
        // into at least one h2. The exact slide depends on in-memory state, which
        // other test suites may have modified, so we only assert presence.
        await expect(page.locator('#currentSlide h2')).toBeAttached();
    });

    test('#ws-status is hidden on initial load', async ({ page }) => {
        await page.goto(AUDIENCE_URL);
        // The banner becomes visible only when the socket disconnects.
        await expect(page.locator('#ws-status')).toBeHidden();
    });

    test('#pres-name element is present and contains the presentation name', async ({ page }) => {
        await page.goto(AUDIENCE_URL);
        // audience.js reads this element via getPresName() to prefix each slide
        // with the presentation name as h1 on every WebSocket slide update.
        await expect(page.locator('#pres-name')).toHaveText('Demo');
    });

    test('breadcrumb has two items with aria-current on last', async ({ page }) => {
        await page.goto(AUDIENCE_URL);
        // audience.html breadcrumb: Home → {pres.name} (current)
        // This is two levels, unlike stage.html which has three.
        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible();
        const items = nav.locator('li');
        await expect(items).toHaveCount(2);
        await expect(items.last()).toHaveAttribute('aria-current', 'page');
    });

    test('#qrToggle is absent in the audience view', async ({ page }) => {
        await page.goto(AUDIENCE_URL);
        // #qrToggle lives in stage.html's {% block stage %}, which audience.html
        // does not fill. An anonymous visitor must not see it.
        await expect(page.locator('#qrToggle')).not.toBeAttached();
    });

    test('#markdown-input is absent in the audience view', async ({ page }) => {
        await page.goto(AUDIENCE_URL);
        await expect(page.locator('#markdown-input')).not.toBeAttached();
    });
});

// ---------------------------------------------------------------------------
// QR toggle — audience.js handles this button; it only exists on stage.html
// ---------------------------------------------------------------------------
test.describe('QR toggle (audience.js behavior, tested on stage view)', () => {
    // #qrToggle and #qrOverlay are rendered in stage.html's {% block stage %}.
    // audience.js wires up the click handler. accessibility.spec.js already covers
    // the live-region announcement; these tests cover the overlay visibility and
    // aria-pressed state transitions that are not tested elsewhere.

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto(STAGE_URL);
        // Ensure the page is ready (stage heading receives focus on load).
        await expect(page.locator('#stage-heading')).toBeFocused();
    });

    test('#qrOverlay is hidden on page load', async ({ page }) => {
        await expect(page.locator('#qrOverlay')).toBeHidden();
    });

    test('#qrToggle has aria-pressed="false" on page load', async ({ page }) => {
        await expect(page.locator('#qrToggle')).toHaveAttribute('aria-pressed', 'false');
    });

    test('clicking #qrToggle makes the QR overlay visible', async ({ page }) => {
        await page.locator('#qrToggle').click();
        await expect(page.locator('#qrOverlay')).toBeVisible();
    });

    test('clicking #qrToggle sets aria-pressed="true"', async ({ page }) => {
        await page.locator('#qrToggle').click();
        await expect(page.locator('#qrToggle')).toHaveAttribute('aria-pressed', 'true');
    });

    test('clicking #qrToggle a second time hides the QR overlay', async ({ page }) => {
        await page.locator('#qrToggle').click();
        await expect(page.locator('#qrOverlay')).toBeVisible();
        await page.locator('#qrToggle').click();
        await expect(page.locator('#qrOverlay')).toBeHidden();
    });

    test('clicking #qrToggle a second time resets aria-pressed to "false"', async ({ page }) => {
        await page.locator('#qrToggle').click();
        await page.locator('#qrToggle').click();
        await expect(page.locator('#qrToggle')).toHaveAttribute('aria-pressed', 'false');
    });

    test('QR overlay contains a link to the audience URL', async ({ page }) => {
        await page.locator('#qrToggle').click();
        // The link in the overlay lets the presenter share the audience URL.
        const link = page.locator('#qrOverlay a');
        await expect(link).toHaveAttribute('href', '/admin/1');
    });

    test('QR overlay contains a QR code image with a meaningful alt attribute', async ({ page }) => {
        await page.locator('#qrToggle').click();
        const img = page.locator('#qrOverlay img');
        await expect(img).toBeVisible();
        // Alt text must be non-empty so screen reader users know what the image contains.
        const alt = await img.getAttribute('alt');
        expect(alt).toBeTruthy();
        expect(alt?.trim().length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Slide rendering via WebSocket — audience.js handleUpdate
// ---------------------------------------------------------------------------
test.describe('audience slide rendering via WebSocket', () => {
    test.describe.configure({ mode: 'serial' });

    // When the WebSocket sends a Slide message, audience.js re-renders #currentSlide
    // with an h1 (presentation name) followed by the slide's own elements.
    // This test verifies both the h1 prefix and the h2 slide heading are present,
    // matching the same pattern as render_slide() on the server side.
    test('WS slide update renders presentation name as h1 in #currentSlide', async ({ browser }) => {
        const presCtx = await browser.newContext();
        const presPage = await presCtx.newPage();
        await loginAsAdmin(presPage);
        await presPage.goto(STAGE_URL);
        await expect(presPage.locator('#goTo option')).not.toHaveCount(0);

        // Reset to slide 0 to establish a known state.
        await presPage.selectOption('#goTo', '0');
        await expect(presPage.locator('#currentSlide h2')).toHaveText('Introduction to the Problem');

        const audCtx = await browser.newContext();
        const audPage = await audCtx.newPage();
        await audPage.goto(AUDIENCE_URL);

        // Trigger a slide change via the presenter.
        await presPage.selectOption('#goTo', '1');

        // handleUpdate in audience.js must render h1 (pres name) + h2 (slide heading).
        await expect(audPage.locator('#currentSlide h2')).toHaveText('What is SyncSlide?');
        await expect(audPage.locator('#currentSlide h1')).toHaveText('Demo');

        await presCtx.close();
        await audCtx.close();
    });

    // When the presenter renames the presentation, audience.js receives a
    // {"type":"name","data":"..."} message and must update:
    //   - the hidden #pres-name element (used for subsequent slide h1 prefixes)
    //   - the document.title
    test('WS name message updates #pres-name and page title on the audience view', async ({ page }) => {
        await page.goto(AUDIENCE_URL);

        // Wait for the WebSocket to reach OPEN state before sending a synthetic message.
        await page.waitForFunction(() => window.socket && window.socket.readyState === WebSocket.OPEN);

        // Deliver a synthetic name update the same way a real WS message would arrive.
        await page.evaluate(() => {
            window.socket.onmessage(
                new MessageEvent('message', {
                    data: JSON.stringify({ type: 'name', data: 'Renamed Presentation' }),
                })
            );
        });

        // audience.js name handler: presNameEl.textContent = message.data
        await expect(page.locator('#pres-name')).toHaveText('Renamed Presentation');

        // audience.js name handler: document.title = `${message.data} - SyncSlide`
        // (presPageMode is undefined on the audience view, so no "– Stage" suffix)
        await expect(page).toHaveTitle('Renamed Presentation - SyncSlide');
    });

    // After a slide update, #currentSlide h1 must reflect the current #pres-name,
    // not the stale initial value. This verifies getPresName() is called on each
    // slide message rather than captured once at startup.
    test('WS slide update uses current presentation name for h1 after a name change', async ({ page }) => {
        await page.goto(AUDIENCE_URL);
        await page.waitForFunction(() => window.socket && window.socket.readyState === WebSocket.OPEN);

        // First, send a name update to change the presentation name in memory.
        await page.evaluate(() => {
            window.socket.onmessage(
                new MessageEvent('message', {
                    data: JSON.stringify({ type: 'name', data: 'Updated Name' }),
                })
            );
        });

        // Then, send a text message (to populate TEXT_TO_RENDER) followed by a slide message.
        await page.evaluate(() => {
            window.socket.onmessage(
                new MessageEvent('message', {
                    data: JSON.stringify({ type: 'text', data: '## Slide One\nContent here.\n\n## Slide Two\nMore content.' }),
                })
            );
            window.socket.onmessage(
                new MessageEvent('message', {
                    data: JSON.stringify({ type: 'slide', data: 0 }),
                })
            );
        });

        // The h1 in #currentSlide must use the updated name, not "Demo".
        await expect(page.locator('#currentSlide h1')).toHaveText('Updated Name');
        await expect(page.locator('#currentSlide h2')).toHaveText('Slide One');
    });
});
