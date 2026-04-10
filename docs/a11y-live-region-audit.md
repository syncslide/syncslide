# Accessibility Audit: Live Regions and Connection State Behaviour

**Date:** 2026-03-29
**Scope:** SyncSlide — `audience.html`, `stage.html`, `recording.html`, `edit.html`, `common.js`, `audience.js`, `handlers.js`, `slide-nav.js`
**Standard:** WCAG 2.2 Level AAA (target); applicable SC cited per finding
**References:** WAI-ARIA 1.2 spec, Section508.gov ICT Testing Baseline (Baseline 21 — Status Messages), PowerMapper screen reader compatibility tables

---

## 1. Current Live Region Implementation

### `#currentSlide`

**File:** `syncslide-websocket/templates/audience.html`, line 21
**Also:** `syncslide-websocket/templates/recording.html`, line 48

```html
<!-- audience.html:21 -->
<section aria-live="polite" aria-label="Current slide" id="currentSlide">
  {% if initial_slide %}{{ initial_slide | safe }}{% endif %}
</section>

<!-- recording.html:48 -->
<section aria-label="Current slide" aria-live="polite" id="currentSlide"></section>
```

**Attributes present:**

| Attribute | Value | Present |
|-----------|-------|---------|
| `aria-live` | `"polite"` | ✓ |
| `aria-label` | `"Current slide"` | ✓ |
| `aria-atomic` | — | **✗ absent** |
| `aria-relevant` | — | omitted (defaults to `"additions text"`) |
| `role` | implicit `region` (via `<section>` + `aria-label`) | ✓ |

**Gap — missing `aria-atomic="true"`:**
Without `aria-atomic="true"`, screen readers may announce only the first changed or added text node within the region rather than the complete new slide. This is confirmed in PowerMapper's screen reader compatibility tables: NVDA and JAWS both exhibit partial-announcement behaviour on live regions without `aria-atomic` when multiple DOM nodes are inserted simultaneously.

The content injection pattern in `audience.js` (lines 63–74) clears `innerHTML` entirely, then appends an `h1` (presentation name) followed by the slide's `h2` and body nodes as separate DOM elements. This multi-node insertion is exactly the scenario where `aria-atomic` is load-bearing: without it, an NVDA user may hear only the `h1` text (the pres name, which never changes) and miss the actual slide content.

**Content injected on slide change** (`audience.js:63–74`):
```javascript
htmlOutput.innerHTML = "";              // clears live region
const h1 = document.createElement('h1');
h1.textContent = presName;             // adds pres name as h1
htmlOutput.appendChild(h1);
for (let nh of newHtml) {              // adds h2 + body nodes
    htmlOutput.appendChild(nh);
}
```

**Heading hierarchy within live region:** Correct — pres name as `h1`, slide heading as `h2`, sub-content beneath. ✓

**WCAG criteria affected:**
- **SC 4.1.2 Name, Role, Value (Level A):** The name and role are correct. The live region's announced *value* (which nodes are included in the announcement) is undefined without `aria-atomic`, making it AT-dependent and therefore non-conformant for Level AAA targets. **(Fail — non-conformant in practice across screen readers)**
- **SC 1.3.1 Info and Relationships (Level A):** Heading structure inside the region is sound. ✓
- **SC 4.1.3 Status Messages (Level AA):** The slide region itself is not a "status message" in the SC 4.1.3 sense — it is live content, not a transient status. However, the unreliable announcement caused by the missing `aria-atomic` means equivalent access is not provided. **(Informational)**

**Fix:** Add `aria-atomic="true"` to `#currentSlide` in `audience.html` and `recording.html`. See [SYN-36](/SYN/issues/SYN-36).

---

### Other Live Regions

**`#ws-status`** — `audience.html:18`, `edit.html:19`

```html
<div id="ws-status" role="status" hidden></div>
```

`role="status"` carries implicit `aria-live="polite"` per WAI-ARIA 1.2. Located inside `<main>` via `{% block content %}`. Landmark placement is correct. ✓

**`#qr-announce`** — `stage.html:12`

```html
<div id="qr-announce" aria-live="polite" class="sr-only"></div>
```

Populated in `audience.js:9–11` with "QR code shown." / "QR code hidden." when the QR button is toggled. Correct implementation of the ARIA APG `aria-pressed` announcement pattern. ✓

**`#rec-announce`** — `stage.html:14`

```html
<div id="rec-announce" aria-live="polite" class="sr-only"></div>
```

Visually hidden using `.sr-only` (style.css:42), which is the correct approach: the region remains in the accessibility tree at all times, unlike `hidden` which removes it. ✓

---

## 2. Current Reconnection Behaviour

**File:** `syncslide-websocket/js/common.js`, lines 29–61

```javascript
function _wsSetStatus(connected) {
    const el = document.getElementById('ws-status');
    if (!el) return;
    if (connected) {
        el.hidden = true;       // element leaves accessibility tree
        el.textContent = '';    // content cleared (no announcement)
    } else {
        el.hidden = false;      // element enters accessibility tree
        el.textContent = 'Connection lost \u2014 reconnecting\u2026';
        // → "Connection lost — reconnecting…" announced politely ✓
    }
}

socket.onopen = function () {
    _wsReconnectDelay = 1000;
    _wsSetStatus(true);         // ← clears status silently
};

socket.onclose = function () {
    _wsSetStatus(false);        // ← announces disconnection ✓
    // … schedules reconnect with exponential backoff
};
```

**Disconnect path:** `hidden` is removed and text is set → `role="status"` element becomes visible to AT with content → polite announcement fires. **Announced. ✓**

**Reconnect path:** `el.textContent = ''` then `el.hidden = true` → content is cleared before hiding; AT receives no new text content; the element hiding generates no announcement. **Not announced. ✗**

**Additional risk — `hidden` attribute on live region:** The Section508.gov ICT Testing Baseline (Baseline 21) and WAI-ARIA 1.2 authoring guidance recommend that live regions remain persistent in the accessibility tree (hidden with CSS rather than the `hidden` attribute) so AT tracks them consistently. Because `#ws-status` uses the `hidden` attribute, AT removes it from the accessibility tree between events. This means AT may need to re-register the region on each `hidden` removal, and some browser/AT combinations may miss the first announcement after a long idle period. The `#qr-announce` and `#rec-announce` regions avoid this issue by staying in the DOM with `.sr-only`. The `#ws-status` pattern is inconsistent with these.

**WCAG criteria affected:**
- **SC 4.1.3 Status Messages (Level AA):** "In content implemented using markup languages, status messages can be programmatically determined through role or property such that they can be presented to the user by assistive technologies without receiving focus." The disconnection event has a status message. The reconnection event has **no status message at all**. **(Fail)**
  Since AAA conformance requires all lower-level criteria to be met, this AA failure blocks AAA conformance.
- **SC 3.2.4 Consistent Identification (Level AA):** The asymmetry between disconnect and reconnect announcements creates inconsistent feedback for the same class of event. **(Informational)**

**Fix:** Announce reconnection before clearing the status element. See [SYN-32](/SYN/issues/SYN-32).

---

## 3. Message Handling During Disconnect

**Files:** `syncslide-websocket/js/slide-nav.js:20–23`, `syncslide-websocket/js/handlers.js:12–13`, `handlers.js:58–60`, `handlers.js:138–140`

All `socket.send()` call sites guard with `socket.readyState === WebSocket.OPEN`:

```javascript
// slide-nav.js:20–22
if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "slide", data: Number(slideChoice) }));
}
// If NOT open: send is silently dropped. No error, no queue, no feedback.
```

```javascript
// handlers.js:12–13
if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "text", data: markdownInput }));
}
// Same pattern for name updates (handlers.js:138) and syncFromSlides (handlers.js:59).
```

**Behaviour during disconnect:**
- Slide navigation changes: silently dropped.
- Markdown edits: silently dropped.
- Presentation name changes: silently dropped.
- No visual or programmatic indication to the user that their action was not delivered.
- No queue; changes made during the disconnect window are permanently lost.
- After reconnect, audience sees the last state the server knew about, which may be stale.

**WCAG criteria affected:**
- **SC 3.3.1 Error Identification (Level A):** "If an input error is automatically detected, the item that is in error is identified and the error is described to the user in text." A dropped send is an input error (the user's intended action was not processed). No error text is shown. **(Fail)**
- **SC 4.1.3 Status Messages (Level AA):** No programmatic status message is provided when a send is dropped. **(Fail)**
- **SC 3.3.4 Error Prevention (Level AAA):** For actions that modify data (slide navigation, markdown edits), submissions that cannot be completed should be reversible or the user should be warned. Silent drops fail this criterion. **(Fail)**

**Fix:** Implement an outbound message queue that holds sends attempted while disconnected and replays them on reconnect. See [SYN-24](/SYN/issues/SYN-24).

---

## 4. Gaps vs WCAG 2.2 AAA

| # | Area | WCAG SC | Level | Status | Sprint Issue |
|---|------|---------|-------|--------|--------------|
| 1 | `#currentSlide` missing `aria-atomic="true"` | 4.1.2 Name, Role, Value | A | **Fail** | [SYN-36](/SYN/issues/SYN-36) |
| 2 | No reconnect announcement in `#ws-status` | 4.1.3 Status Messages | AA | **Fail** | [SYN-32](/SYN/issues/SYN-32) |
| 3 | `#ws-status` uses `hidden` attribute (not CSS) causing AT re-registration risk | 4.1.3 Status Messages | AA | **Risk** | [SYN-32](/SYN/issues/SYN-32) |
| 4 | Dropped sends during disconnect — no error feedback | 3.3.1 Error Identification | A | **Fail** | [SYN-24](/SYN/issues/SYN-24) |
| 5 | Dropped sends during disconnect — no status message | 4.1.3 Status Messages | AA | **Fail** | [SYN-24](/SYN/issues/SYN-24) |
| 6 | Dropped sends during disconnect — no error prevention | 3.3.4 Error Prevention | AAA | **Fail** | [SYN-24](/SYN/issues/SYN-24) |

**Items with no gap found:**
- QR toggle announcement (`#qr-announce`) — correct ARIA APG pattern ✓
- Recording announce region (`#rec-announce`) — persists in DOM, correct ✓
- Skip link (`base.html:16`) — implemented, focusable ✓
- Landmark regions — `<header>`, `<main id="main">`, `<nav aria-label>`, `<footer>` all present ✓
- Breadcrumb nav — `aria-label="Breadcrumb"`, `aria-current="page"` correct ✓
- `<html lang="en">` — present on base template ✓

---

## 5. Recommended Fixes

### Fix 1 — Add `aria-atomic="true"` to `#currentSlide` (addresses item 1)

**File:** `audience.html:21` and `recording.html:48`

Change:
```html
<section aria-live="polite" aria-label="Current slide" id="currentSlide">
```
To:
```html
<section aria-live="polite" aria-atomic="true" aria-label="Current slide" id="currentSlide">
```

This matches the GOV.UK Design System's live region pattern for full-content replacements and the ARIA APG guidance on `aria-atomic`. See [SYN-36](/SYN/issues/SYN-36).

### Fix 2 — Announce WebSocket reconnection (addresses items 2 and 3)

**File:** `common.js:29–39`

The `_wsSetStatus(true)` path should set a non-empty text string before clearing, so AT announces the reconnection event. The element should ideally be hidden with CSS (`.sr-only`) rather than the `hidden` attribute to keep it in the accessibility tree at all times — matching the `#qr-announce` and `#rec-announce` pattern already used in `stage.html`.

The GOV.UK Design System uses persistent `role="status"` regions with transient text updates (setting content → announcing → clearing after delay) for exactly this pattern. See [SYN-32](/SYN/issues/SYN-32).

### Fix 3 — Queue outbound messages during disconnect (addresses items 4–6)

**File:** `common.js` (new queue module)

Add a small outbound message queue. Attempted sends when `socket.readyState !== WebSocket.OPEN` are pushed to the queue rather than dropped. On reconnect (`socket.onopen`), the queue is flushed. The `#ws-status` region should reflect queue state: "Connection lost — your changes will sync when reconnected" → "Reconnected — syncing…" → cleared. This provides both SC 3.3.1 error identification and SC 4.1.3 status messaging. See [SYN-24](/SYN/issues/SYN-24).

---

*Audit conducted by Morgan (Accessibility Engineer). No code was modified during this audit.*
