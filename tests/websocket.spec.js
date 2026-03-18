// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

// The Demo presentation is always seeded by migrations.
// admin owns it; navigating as admin → stage.html; anonymous → audience.html.
const STAGE_URL = '/admin/1';

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

    // When the presenter changes slide during a live session, the audience's
    // #currentSlide (aria-live="polite") must update immediately.
    // This is the core sync guarantee: screen reader users tracking the presentation
    // on their own device hear the new slide announced without any manual action.
    test('presenter slide change propagates to connected audience', async ({ browser }) => {
        // Both contexts connect to the same stage URL simultaneously.
        const presCtx = await browser.newContext();
        const presPage = await presCtx.newPage();
        await loginAsAdmin(presPage);
        await presPage.goto(STAGE_URL);

        // Presenter resets to slide 0 first — prior tests may have left the
        // server's in-memory state at a different slide.  Wait for the round-trip
        // to complete before the audience connects, so both the server state and
        // the DB current_slide_index are known-good when the audience page loads.
        await expect(presPage.locator('#goTo option')).not.toHaveCount(0);
        await presPage.selectOption('#goTo', '0');
        await expect(presPage.locator('#currentSlide h2')).toHaveText('Introduction to the Problem');

        // Audience connects after the reset is confirmed.
        const audCtx = await browser.newContext();
        const audPage = await audCtx.newPage();
        await audPage.goto(STAGE_URL);

        // Wait for the audience's WS to deliver initial state and render #currentSlide.
        await expect(audPage.locator('#currentSlide h2')).toBeVisible();

        // Confirm audience starts on slide 0 ("Introduction to the Problem").
        await expect(audPage.locator('#currentSlide h2')).toHaveText('Introduction to the Problem');

        // Presenter navigates to slide 1.
        await presPage.selectOption('#goTo', '1');

        // The server broadcasts Slide(1) to all connected clients.
        // Audience's handleUpdate re-renders #currentSlide with slide 1 content.
        await expect(audPage.locator('#currentSlide h2')).toHaveText('What is SyncSlide?');

        await presCtx.close();
        await audCtx.close();
    });
});
