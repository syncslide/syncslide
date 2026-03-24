// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAs } = require('./helpers');

// The Demo presentation is always seeded by migrations.
// admin owns it; navigating as admin → stage.html; anonymous → audience.html.
const STAGE_URL = '/admin/1';

test.describe.configure({ mode: 'serial' });
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
        // Presenter connects first and resets to slide 0.
        // Prior tests may have left the server's in-memory state at a different slide.
        // The round-trip wait ensures server state is known before the audience connects.
        const presCtx = await browser.newContext();
        const presPage = await presCtx.newPage();
        await loginAsAdmin(presPage);
        await presPage.goto(STAGE_URL);
        await expect(presPage.locator('#goTo option')).not.toHaveCount(0);
        await presPage.selectOption('#goTo', '0');
        await expect(presPage.locator('#currentSlide h2')).toHaveText('Introduction to the Problem');

        // Audience connects after the reset is confirmed — now both contexts are live.
        const audCtx = await browser.newContext();
        const audPage = await audCtx.newPage();
        await audPage.goto(STAGE_URL);

        // Confirm audience received slide 0 from the server on connect.
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

// Verify that recording state changes on one presenter page (start/pause/stop)
// are broadcast via WebSocket to all connected presenters and reflected in the UI.
// Tests share the seeded Demo presentation (admin/1) and reset state between tests.
test.describe('server-side recording sync', () => {
    test('starting a recording syncs to a second stage context', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const page1 = await ctx1.newPage();
        const page2 = await ctx2.newPage();

        await loginAs(page1, 'admin', 'admin');
        await loginAs(page2, 'admin', 'admin');
        await page1.goto(STAGE_URL);
        await page2.goto(STAGE_URL);

        // Ensure recording is stopped before starting (in case prior test left it running)
        const stopBtn1 = page1.locator('#recordStop');
        if (await stopBtn1.isVisible()) {
            await stopBtn1.click();
            await expect(page1.locator('#rec-status')).toHaveText('Stopped', { timeout: 3000 });
        }

        await page1.click('#recordStart');
        await expect(page2.locator('#rec-status')).toHaveText('Recording', { timeout: 3000 });
        await expect(page2.locator('#recordPause')).toBeVisible();
        await expect(page2.locator('#recordStop')).toBeVisible();

        // Clean up: stop recording
        await page1.click('#recordStop');
        await ctx1.close();
        await ctx2.close();
    });

    test('pausing a recording syncs to a second stage context', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const page1 = await ctx1.newPage();
        const page2 = await ctx2.newPage();

        await loginAs(page1, 'admin', 'admin');
        await loginAs(page2, 'admin', 'admin');
        await page1.goto(STAGE_URL);
        await page2.goto(STAGE_URL);

        await page1.click('#recordStart');
        await expect(page2.locator('#rec-status')).toHaveText('Recording', { timeout: 3000 });

        await page1.click('#recordPause');
        await expect(page2.locator('#rec-status')).toHaveText('Paused', { timeout: 3000 });
        await expect(page2.locator('#recordResume')).toBeVisible();

        // Clean up
        await page1.click('#recordStop');
        await ctx1.close();
        await ctx2.close();
    });

    test('stopping a recording syncs to a second stage context', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const page1 = await ctx1.newPage();
        const page2 = await ctx2.newPage();

        await loginAs(page1, 'admin', 'admin');
        await loginAs(page2, 'admin', 'admin');
        await page1.goto(STAGE_URL);
        await page2.goto(STAGE_URL);

        await page1.click('#recordStart');
        await expect(page2.locator('#rec-status')).toHaveText('Recording', { timeout: 3000 });

        await page1.click('#recordStop');
        await expect(page2.locator('#rec-status')).toHaveText('Stopped', { timeout: 3000 });
        await expect(page2.locator('#recordStart')).toBeVisible();

        await ctx1.close();
        await ctx2.close();
    });
});
