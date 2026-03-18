// @ts-check
const { test, expect } = require('@playwright/test');

// The Demo presentation is always seeded by migrations.
// admin owns it; navigating as admin → stage.html; anonymous → audience.html.
const STAGE_URL = '/admin/1';

// Helper — logs in as admin/admin in the given page.
async function loginAsAdmin(page) {
    await page.goto('/auth/login');
    await page.fill('[name="username"]', 'admin');
    await page.fill('[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
}

test.describe('websocket sync', () => {
    // An audience member connecting after the presenter has already navigated
    // to a particular slide must receive that slide — not always slide 0.
    // The server holds current slide state in memory and sends it on every
    // new WebSocket connection (Text + Slide messages).
    //
    // This verifies that #currentSlide (aria-live="polite") announces the correct
    // current slide to a screen reader user who joins mid-presentation.
    test('audience receives current slide state on connect', async ({ browser }) => {
        // Presenter connects and navigates to slide 1.
        const presCtx = await browser.newContext();
        const presPage = await presCtx.newPage();
        await loginAsAdmin(presPage);
        await presPage.goto(STAGE_URL);

        // Wait for #goTo options to be populated by JS (getH2s runs on load).
        await expect(presPage.locator('#goTo option')).not.toHaveCount(0);

        // Navigate presenter to slide 1 (index 1 = "What is SyncSlide?").
        // handlers.js sends {"type":"slide","data":1} on the 'input' event.
        await presPage.selectOption('#goTo', '1');

        // Wait for the WS round-trip to complete: the server broadcasts back
        // to the presenter, which re-renders #currentSlide on the stage page.
        // When this assertion passes, the server's in-memory state is slide 1.
        await expect(presPage.locator('#currentSlide h2')).toHaveText('What is SyncSlide?');

        // Audience connects now — server HTTP handler reads current_slide_index (1)
        // for the server-rendered initial_slide, and WS delivers Slide(1) on connect.
        const audCtx = await browser.newContext();
        const audPage = await audCtx.newPage();
        await audPage.goto(STAGE_URL);

        // #currentSlide must show slide 1 (the current slide), not slide 0.
        await expect(audPage.locator('#currentSlide h2')).toHaveText('What is SyncSlide?');

        await presCtx.close();
        await audCtx.close();
    });
});
