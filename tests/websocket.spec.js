// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

// The Demo presentation is always seeded by migrations.
// admin owns it; navigating as admin → stage.html; anonymous → audience.html.
const STAGE_URL = '/admin/1';
const EDIT_URL = '/admin/1/edit';

test.describe('websocket sync', () => {
    test.describe.configure({ mode: 'serial' });
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

// Verify WebSocket reconnection: when the socket is closed, the status banner
// appears, and slide sync is restored after reconnection.
test.describe('websocket reconnection', () => {
    test.describe.configure({ mode: 'serial' });
    // When the socket drops, the #ws-status banner must become visible with a
    // "Connection lost" message. This tells the presenter (including screen reader
    // users who rely on role="status" live announcements) that sync is interrupted.
    test('status banner appears when socket closes', async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto(STAGE_URL);
        await expect(page.locator('#goTo option')).not.toHaveCount(0);

        // Banner must be hidden while connected.
        await expect(page.locator('#ws-status')).toBeHidden();

        // Force the socket closed. onclose fires synchronously in the browser
        // and sets the status banner visible before the reconnect timer starts.
        const pageErrors = [];
        page.on('pageerror', e => pageErrors.push(e));
        await page.evaluate(() => window.socket.close());

        // Banner must appear before the reconnect attempt (which is ≥1 s away).
        await expect(page.locator('#ws-status')).toBeVisible({ timeout: 2000 });
        await expect(page.locator('#ws-status')).toContainText('Connection lost');

        // No unhandled JS errors should have been thrown.
        expect(pageErrors).toHaveLength(0);
    });

    // After a socket closes and the reconnect succeeds, the banner must disappear
    // and slide sync must continue to work normally.
    test('slide sync resumes after reconnect', async ({ browser }) => {
        const presCtx = await browser.newContext();
        const audCtx = await browser.newContext();
        const presPage = await presCtx.newPage();
        const audPage = await audCtx.newPage();

        await loginAsAdmin(presPage);
        await presPage.goto(STAGE_URL);
        await expect(presPage.locator('#goTo option')).not.toHaveCount(0);

        await audPage.goto(STAGE_URL);

        // Confirm both pages are live on slide 0.
        await presPage.selectOption('#goTo', '0');
        await expect(presPage.locator('#currentSlide h2')).toHaveText('Introduction to the Problem');
        await expect(audPage.locator('#currentSlide h2')).toHaveText('Introduction to the Problem');

        // Close the audience socket and wait for it to reconnect (banner hidden again).
        await audPage.evaluate(() => window.socket.close());
        await expect(audPage.locator('#ws-status')).toBeVisible({ timeout: 2000 });
        // Reconnect delay is 1–1.5 s; give up to 10 s for the banner to clear.
        await expect(audPage.locator('#ws-status')).toBeHidden({ timeout: 10000 });

        // The server sends current state on every new connection. Verify the audience
        // page still shows the correct slide after reconnect without presenter action.
        await expect(audPage.locator('#currentSlide h2')).toHaveText('Introduction to the Problem');

        // Now change slide on the presenter and verify the audience (reconnected) sees it.
        await presPage.selectOption('#goTo', '1');
        await expect(audPage.locator('#currentSlide h2')).toHaveText('What is SyncSlide?');

        await presCtx.close();
        await audCtx.close();
    });

    // Triggering a send action (blur on the markdown textarea) while the socket is
    // closed must not throw a DOMException or crash the page.
    test('send-while-disconnected does not throw', async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto(EDIT_URL);
        await expect(page.locator('#markdown-input')).toBeVisible();

        const pageErrors = [];
        page.on('pageerror', e => pageErrors.push(e));

        // Close the socket, confirm the banner appears (onclose has fired).
        await page.evaluate(() => window.socket.close());
        await expect(page.locator('#ws-status')).toBeVisible({ timeout: 2000 });

        // Focus and blur the textarea to trigger updateMarkdown → guarded send.
        await page.focus('#markdown-input');
        await page.evaluate(() => document.getElementById('markdown-input').dispatchEvent(new Event('blur')));

        // Allow any synchronous errors to propagate.
        await page.waitForTimeout(200);

        // The page must still be functional and no errors thrown.
        expect(pageErrors).toHaveLength(0);
        await expect(page.locator('#markdown-input')).toBeVisible();
    });
});

// Verify that recording state changes on one presenter page (start/pause/stop)
// are broadcast via WebSocket to all connected presenters and reflected in the UI.
// Tests share the seeded Demo presentation (admin/1) and reset state between tests.
test.describe('server-side recording sync', () => {
    test.describe.configure({ mode: 'serial' });
    test('starting a recording syncs to a second stage context', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const page1 = await ctx1.newPage();
        const page2 = await ctx2.newPage();

        await loginAsAdmin(page1);
        await loginAsAdmin(page2);
        await page1.goto(STAGE_URL);
        await page2.goto(STAGE_URL);

        // Expand the recording section on both pages so buttons are accessible
        await page1.click('#record-toggle');
        await page2.click('#record-toggle');

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

        await loginAsAdmin(page1);
        await loginAsAdmin(page2);
        await page1.goto(STAGE_URL);
        await page2.goto(STAGE_URL);

        await page1.click('#record-toggle');
        await page2.click('#record-toggle');
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

        await loginAsAdmin(page1);
        await loginAsAdmin(page2);
        await page1.goto(STAGE_URL);
        await page2.goto(STAGE_URL);

        await page1.click('#record-toggle');
        await page2.click('#record-toggle');
        await page1.click('#recordStart');
        await expect(page2.locator('#rec-status')).toHaveText('Recording', { timeout: 3000 });

        await page1.click('#recordStop');
        await expect(page2.locator('#rec-status')).toHaveText('Stopped', { timeout: 3000 });
        await expect(page2.locator('#recordStart')).toBeVisible();

        await ctx1.close();
        await ctx2.close();
    });
});
