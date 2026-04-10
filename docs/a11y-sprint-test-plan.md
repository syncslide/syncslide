# Accessibility Reliability Sprint — E2E Test Plan

**Status:** Specification (pre-implementation)
**Covers:** [SYN-36](/SYN/issues/SYN-36), [SYN-32](/SYN/issues/SYN-32), [SYN-24](/SYN/issues/SYN-24)
**Audience:** Frontend Engineer implementing the fixes; QA verifying them.
**Test runner:** Playwright (existing suite in `tests/`)

---

## How to read this document

Each section maps to one sprint issue. For every test case:

- **Setup** — browser/page state required before the first action.
- **Actions** — steps to perform, in order.
- **Assertions** — what must be true after the actions. Each assertion names a DOM selector, an ARIA attribute, or both.
- **Screen reader expectation** — what a screen reader user should hear and when.

All tests use the seeded Demo presentation (`admin/1`) unless otherwise noted. Helpers `loginAsAdmin` and `loginAs` are already defined in `tests/helpers.js`.

---

## Issue 1 — SYN-36: `aria-atomic="true"` on `#currentSlide`

**ARIA reference:** WAI-ARIA 1.2 §6.6.4 [`aria-atomic`](https://www.w3.org/TR/wai-aria-1.2/#aria-atomic). When set to `true`, the entire live region is re-presented whenever any part of it changes. WAI-ARIA §6.6.25 [`aria-live`](https://www.w3.org/TR/wai-aria-1.2/#aria-live) with value `polite` queues the announcement until the user is idle. Both attributes together ensure a screen reader user hears the complete new slide, not a fragment.

**Real-world reference:** The GOV.UK Design System [live region guidance](https://design-system.service.gov.uk/accessibility/notifications/) and the Inclusive Components "Notifications" chapter (Heydon Pickering) both recommend `aria-atomic="true"` when the meaningful unit is always the whole region — slides are a textbook example.

**Current DOM (audience.html):**

```html
<section aria-live="polite" aria-label="Current slide" id="currentSlide">…</section>
```

`aria-atomic` is absent. Without it, screen readers may announce only changed text nodes, not the full incoming slide.

---

### TC-SYN-36-1: `#currentSlide` has correct ARIA attributes in the DOM at page load

**Setup:**
- Log in as admin.
- Navigate to `/admin/1` (stage/audience URL).

**Actions:**
1. Wait for the page to finish loading (`networkidle` or for `#currentSlide` to be present).

**Assertions:**
```
#currentSlide
  aria-live   = "polite"
  aria-atomic = "true"
  aria-label  = "Current slide"
```

**Screen reader expectation:** No announcement on load (polite region only announces on change). On first slide change, the full slide content is queued for announcement.

**Playwright sketch:**
```js
await expect(page.locator('#currentSlide')).toHaveAttribute('aria-live', 'polite');
await expect(page.locator('#currentSlide')).toHaveAttribute('aria-atomic', 'true');
await expect(page.locator('#currentSlide')).toHaveAttribute('aria-label', 'Current slide');
```

---

### TC-SYN-36-2: `#currentSlide` has correct ARIA attributes on the recording page

**Setup:**
- Log in as admin.
- Navigate to the recording view for presentation 1 (URL path used by `recording.html`).

**Actions:**
1. Wait for the page to load.

**Assertions:**
```
#currentSlide
  aria-live   = "polite"
  aria-atomic = "true"
```

**Rationale:** `recording.html` has its own `#currentSlide` element. If the fix only touches `audience.html`, this page regresses silently. Both templates must be updated.

---

### TC-SYN-36-3: After a WebSocket slide-change, `#currentSlide` contains the complete new slide

**Setup:**
- Open two browser contexts: presenter (`presCtx`) and audience (`audCtx`).
- Log in as admin in `presCtx`; navigate to `/admin/1`.
- Navigate to `/admin/1` anonymously (or as admin) in `audCtx`.
- Presenter resets to slide 0 and waits for audience to confirm.

**Actions:**
1. Presenter selects slide index 1 from `#goTo`.
2. Wait for audience `#currentSlide` to update.

**Assertions:**
```
audPage #currentSlide
  – contains an <h2> whose text is "What is SyncSlide?"
  – textContent includes at least one sentence of slide body text
  – does NOT contain any fragment from the previous slide ("Introduction to the Problem")
```

**Screen reader expectation:** Because `aria-atomic="true"` is present, the screen reader queues the entire `#currentSlide` region for announcement — heading plus body — not just the changed text nodes. The user hears a coherent, complete slide.

**Playwright sketch:**
```js
await presPage.selectOption('#goTo', '1');
await expect(audPage.locator('#currentSlide h2')).toHaveText('What is SyncSlide?');
// Full region is present — verify body text exists
await expect(audPage.locator('#currentSlide')).not.toBeEmpty();
// No stale fragment from slide 0
await expect(audPage.locator('#currentSlide')).not.toContainText('Introduction to the Problem');
```

---

## Issue 2 — SYN-32: Announce WebSocket reconnection

**ARIA/WCAG reference:** WCAG 2.1 Success Criterion 4.1.3 [Status Messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html) — status messages must be programmatically determinable without receiving focus, using `role="status"` (implicit `aria-live="polite"`, `aria-atomic="true"`). The WAI-ARIA Authoring Practices Guide [Alert and Status Message Patterns](https://www.w3.org/WAI/ARIA/apg/patterns/alert/) describe when to use `role="status"` vs. `role="alert"`. For a non-urgent restoration event, `role="status"` is correct.

**Real-world reference:** The GOV.UK Notify status banner and GitHub's network-error notification both announce connection restoration (not just loss). The current `#ws-status` element correctly announces disconnect but silently clears on reconnect — the reconnected half is missing.

**Current behaviour (`common.js`, `_wsSetStatus`):**
```js
if (connected) {
    el.hidden = true;
    el.textContent = '';  // silent — live regions do not announce removal
} else {
    el.hidden = false;
    el.textContent = 'Connection lost — reconnecting…';
}
```

**Expected behaviour after fix:**
```js
if (connected) {
    el.hidden = false;
    el.textContent = 'Reconnected.';   // announced by role="status"
    setTimeout(() => { el.hidden = true; el.textContent = ''; }, 3000);
} else { … }
```

---

### TC-SYN-32-1: `#ws-status` element has correct ARIA role

**Setup:**
- Log in as admin; navigate to `/admin/1`.

**Actions:**
1. Wait for page to load.

**Assertions:**
```
#ws-status
  role   = "status"
  hidden = true   (not visible while connected)
```

**Playwright sketch:**
```js
await expect(page.locator('#ws-status')).toHaveAttribute('role', 'status');
await expect(page.locator('#ws-status')).toBeHidden();
```

---

### TC-SYN-32-2: Disconnect announces "Connection lost" and reconnect announces "Reconnected."

**Setup:**
- Log in as admin; navigate to `/admin/1`.
- Wait for `#goTo` options to load (socket is open).

**Actions:**
1. Force the socket closed: `page.evaluate(() => window.socket.close())`.
2. Assert the disconnect banner appears.
3. Wait for the socket to reconnect (banner transitions to "Reconnected." or disappears).

**Assertions — immediately after forced close (≤ 2 s):**
```
#ws-status
  visible    = true
  textContent contains "Connection lost"
```

**Assertions — after reconnect completes (≤ 12 s):**
```
#ws-status
  visible    = true
  textContent = "Reconnected."   (or locale-equivalent)
```

**Assertions — after the clear timeout elapses (≤ 3 s after "Reconnected." appears):**
```
#ws-status
  hidden = true
  textContent = ""
```

**Screen reader expectation:** The user first hears "Connection lost — reconnecting…" (role="status", polite). When sync is restored they hear "Reconnected." They do not hear a second "Connection lost" unless the connection actually drops again. They do not hear silence when sync restores.

**Playwright sketch:**
```js
await page.evaluate(() => window.socket.close());
await expect(page.locator('#ws-status')).toBeVisible({ timeout: 2000 });
await expect(page.locator('#ws-status')).toContainText('Connection lost');

// Wait for reconnect and "Reconnected." announcement
await expect(page.locator('#ws-status')).toContainText('Reconnected.', { timeout: 12000 });

// Banner clears automatically
await expect(page.locator('#ws-status')).toBeHidden({ timeout: 5000 });
```

---

### TC-SYN-32-3: "Reconnected." is not announced when page loads normally (no prior disconnect)

**Setup:**
- Log in as admin; navigate to `/admin/1`.

**Actions:**
1. Wait for the socket to open (confirm `#ws-status` is hidden).
2. Wait 4 s (longer than the reconnect clear timeout).

**Assertions:**
```
#ws-status
  hidden      = true    (never became visible)
  textContent = ""
```

**Rationale:** The fix must not fire "Reconnected." on initial connect, only on re-connect after a previous disconnect. NVDA/JAWS users who load the page cold must not hear a spurious status announcement.

---

### TC-SYN-32-4: `#ws-status` exists and has correct role on the edit page

**Setup:**
- Log in as admin; navigate to `/admin/1/edit`.

**Actions:**
1. Wait for page to load.

**Assertions:**
```
#ws-status
  role   = "status"
  hidden = true
```

**Rationale:** `edit.html` also includes `#ws-status`. The reconnect announcement fix must apply there too.

---

## Issue 3 — SYN-24: Queue messages during WS disconnect, replay on reconnect

**Reference:** MDN [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) — `readyState !== OPEN` means sends must be buffered client-side. Jake Archibald's [Offline Cookbook](https://jakearchibald.com/2014/offline-cookbook/) and Google Docs, Notion, and Figma all implement client-side write queues for exactly this reason. For SyncSlide, a silent send drop means the audience sees a stale slide even after sync is restored.

**Current behaviour:** `handlers.js` and `slide-nav.js` both guard sends with `if (socket && socket.readyState === WebSocket.OPEN)`. When the socket is closed, the message is discarded.

**Expected behaviour after fix:** A `wsSend(payload)` helper in `common.js` queues the message when the socket is not open, and drains the queue in `socket.onopen`. For `type: "text"`, only the latest queued message is replayed (deduplication).

---

### TC-SYN-24-1: Markdown edit during disconnect is delivered to audience after reconnect

**Setup:**
- Open two browser contexts: presenter (`presPage`) and audience (`audPage`).
- Log in as admin in `presPage`; navigate to `/admin/1/edit`.
- Navigate to `/admin/1` in `audPage`.
- Confirm both pages are live (audience sees current slide).

**Actions:**
1. Close the presenter socket: `presPage.evaluate(() => window.socket.close())`.
2. Wait for the disconnect banner: `#ws-status` becomes visible on `presPage`.
3. While disconnected: type new markdown into `#markdown-input` on `presPage` and blur.
4. Wait for the presenter socket to reconnect: `#ws-status` becomes hidden again.
5. Wait for the audience page to update.

**Assertions — after reconnect:**
```
audPage #currentSlide
  – reflects the markdown content typed in step 3
  – specifically: contains text from the new slide heading or body
```

**Screen reader expectation:** The audience user (screen reader) did not see the edit during the disconnect window (expected). After reconnect, `#currentSlide` updates and, because `aria-atomic="true"` is present (SYN-36), the full updated slide is announced.

**Playwright sketch:**
```js
await presPage.evaluate(() => window.socket.close());
await expect(presPage.locator('#ws-status')).toBeVisible({ timeout: 2000 });

// Edit while disconnected
await presPage.fill('#markdown-input', '## Queued Slide\nThis was edited offline.');
await presPage.evaluate(() => document.getElementById('markdown-input').dispatchEvent(new Event('blur')));

// Wait for reconnect
await expect(presPage.locator('#ws-status')).toBeHidden({ timeout: 12000 });

// Audience should now see the edit
await expect(audPage.locator('#currentSlide')).toContainText('Queued Slide', { timeout: 5000 });
```

---

### TC-SYN-24-2: Multiple text edits during disconnect — only latest is replayed (deduplication)

**Setup:**
- Two browser contexts as above (presenter on edit, audience on stage).

**Actions:**
1. Close the presenter socket.
2. Wait for disconnect banner.
3. Type first edit: "## First Draft\nFirst content." → blur.
4. Type second edit: "## Final Version\nFinal content." → blur.
5. Wait for reconnect.
6. Wait for audience to update.

**Assertions:**
```
audPage #currentSlide
  – contains "Final Version" (latest edit)
  – does NOT contain "First Draft" (intermediate state must not be replayed)
```

**Rationale:** Replaying every intermediate markdown state would cause multiple rapid DOM updates, potentially announcing stale slide fragments to screen reader users (even with `aria-atomic="true"`). Only the final state must be delivered.

---

### TC-SYN-24-3: Slide navigation during disconnect is delivered after reconnect

**Setup:**
- Two browser contexts: presenter on `/admin/1` (stage), audience on `/admin/1`.
- Both pages on slide 0 ("Introduction to the Problem").

**Actions:**
1. Close the presenter socket.
2. Wait for disconnect banner on the presenter stage page.
3. Select slide 1 from `#goTo` on the presenter page (sends `{"type":"slide","data":1}`).
4. Wait for reconnect (`#ws-status` hidden).
5. Wait for the audience to update.

**Assertions:**
```
audPage #currentSlide h2
  text = "What is SyncSlide?"
```

**Screen reader expectation:** The audience user hears "What is SyncSlide?" (plus slide body) via the `#currentSlide` live region after the reconnect queued message is delivered.

**Playwright sketch:**
```js
await presPage.evaluate(() => window.socket.close());
await expect(presPage.locator('#ws-status')).toBeVisible({ timeout: 2000 });

await presPage.selectOption('#goTo', '1');
// Slide change is queued, not sent yet

await expect(presPage.locator('#ws-status')).toBeHidden({ timeout: 12000 });
await expect(audPage.locator('#currentSlide h2')).toHaveText('What is SyncSlide?', { timeout: 5000 });
```

---

### TC-SYN-24-4: Queue does not replay on initial page load (no prior disconnect)

**Setup:**
- Log in as admin; navigate to `/admin/1/edit`.

**Actions:**
1. Wait for the socket to open normally.
2. Type markdown and blur (normal send).
3. Verify no double-send occurs.

**Assertions:**
- Audience page receives exactly one update per blur event.
- `#currentSlide` content matches the edit without duplication or corruption.

**Rationale:** The drain-on-open logic must only replay queued messages, not re-send the last known markdown on every fresh connect.

---

## Regression tests (existing coverage to verify is unchanged)

These tests already exist in `tests/websocket.spec.js` and must continue to pass after all three fixes are implemented.

| Test | File | What it verifies |
|------|------|-----------------|
| `audience receives current slide state on connect` | `websocket.spec.js` | Server-side state delivery on connect |
| `presenter slide change propagates to connected audience` | `websocket.spec.js` | Core real-time sync path |
| `status banner appears when socket closes` | `websocket.spec.js` | Disconnect announcement |
| `slide sync resumes after reconnect` | `websocket.spec.js` | Reconnect + banner clears |
| `send-while-disconnected does not throw` | `websocket.spec.js` | No crash on guarded send |

---

## Priority summary

| Issue | Test cases | Priority | Rationale |
|-------|-----------|----------|-----------|
| SYN-36 (aria-atomic) | TC-SYN-36-1 through TC-SYN-36-3 | High | Single-attribute change; direct screen reader impact for every slide change |
| SYN-32 (reconnect announcement) | TC-SYN-32-1 through TC-SYN-32-4 | High | WCAG 4.1.3 gap; screen reader users cannot confirm sync resumed without it |
| SYN-24 (message queue) | TC-SYN-24-1 through TC-SYN-24-4 | High | Silent data loss during disconnect undermines the tool's core reliability promise |
