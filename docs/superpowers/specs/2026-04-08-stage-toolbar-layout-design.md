# Stage toolbar layout — QR and Record buttons

**Date:** 2026-04-08
**Scope:** `syncslide-websocket/templates/stage.html`, `syncslide-websocket/css/style.css`
**Goal:** On the stage page, place the QR button and the Record disclosure button on separate visual rows, and move the live recording timer out of the button label and into the expanded recording detail panel.

## Motivation

Two problems with the current layout:

1. The QR button and the Record disclosure button are both inline-block and sit on the same visual row. They should each occupy their own row so the stage toolbar reads as a clearly separated stack of controls.
2. The Record toggle button label currently contains a per-second-updating timer (`Record: Stopped — 00:00:00`). A live-updating value inside a button label is noisy for screen reader users when the button is focused, and makes the label drift from being a stable identifier for the control. The timer belongs with the recording controls it describes — i.e. inside the disclosure panel — not inside the button that opens the panel.

## Design

### 1. Separate rows for QR and Record toggle

Add a CSS rule in the "in stage" block of `css/style.css` that makes both toggle buttons block-level with a small vertical rhythm:

```css
#qrToggle,
#record-toggle { display: block; width: fit-content; margin-block: .4em; }
```

`width: fit-content` keeps each button sized to its label rather than stretching to the container width, which is the normal visual treatment for a toolbar-style button. `margin-block: .4em` gives a small vertical rhythm between the two rows.

Reading order, tab order, and landmark structure are unchanged — only the visual layout changes. Each button now occupies its own row, left-aligned under the `<h1>` stage heading.

No template restructure is needed for this item; the buttons are already separate top-level elements in `templates/stage.html` (no shared wrapper, no flex container). CSS alone is sufficient.

### 2. Record toggle button shows status only

In `templates/stage.html`, remove the trailing `— <span id="rec-timer">00:00:00</span>` from the button label. The new button content is:

```html
<button type="button" id="record-toggle" aria-expanded="false" aria-controls="record-section">Record: <span id="rec-status">Stopped</span></button>
```

The button label is therefore stable — `Record: Stopped` / `Record: Recording` / `Record: Paused` — and only changes on discrete state transitions. `recording.js` already updates `#rec-status` at exactly those transition points (`setRunning`, `setPaused`, `setStopped`), so no JS change is needed for the status text itself.

### 3. Timer moves into the recording detail panel

Insert a labelled timer as the first child of `#record-section` in `templates/stage.html`:

```html
<section id="record-section" aria-label="Recording controls" hidden>
<p>Elapsed: <span id="rec-timer">00:00:00</span></p>
<button type="button" id="recordStart">Start recording</button>
<button type="button" id="recordPause" hidden>Pause</button>
<button type="button" id="recordResume" hidden>Resume</button>
<button type="button" id="recordStop" hidden>Stop</button>
</section>
```

**Reading order inside the expanded panel:** Elapsed → Start → Pause → Resume → Stop. State first, controls second.

The `#rec-timer` id is preserved, so `recording.js` (`startTimer`, `stopTimer`, `setStopped`) keeps working unchanged — it writes to `document.getElementById('rec-timer')` by id, and is indifferent to where the element lives in the DOM.

### 4. Timer is not a live region

The timer updates every second. Announcing it every second would be noisy and would conflict with WCAG 2.2 SC 2.2.2 (pause, stop, hide) expectations for auto-updating content. The timer therefore has no `aria-live` attribute — it is readable on demand when the user navigates into the expanded panel.

Event-level feedback continues to be provided by the existing `#rec-announce` polite live region, which `recording.js` already fires at the meaningful moments (`Recording started`, `Recording paused`, `Recording resumed`, `Recording stopped`).

## Accessibility notes (WCAG 2.2 AAA)

- **1.3.1 Info and relationships:** The timer is now a labelled element ("Elapsed: …") inside a region with `aria-label="Recording controls"`, so its purpose is clear when read in isolation.
- **2.1.1 Keyboard / 2.4.3 Focus order:** No change to tab order. The `#rec-timer` span is non-focusable; the user reaches it by browse-mode / virtual cursor after expanding the panel.
- **2.2.2 Pause, stop, hide:** The per-second timer is not announced automatically (no live region), and is also hidden by default (panel collapsed). When the panel is expanded, the value is present but not interruptive.
- **4.1.2 Name, role, value:** The Record toggle button's accessible name becomes `Record: Stopped` (and mirrors the status span as state changes). The `aria-expanded` / `aria-controls` pair is unchanged.

## Out of scope

- No change to WebSocket message handling, recording state machine, DB schema, or the `#rec-announce` live region wording.
- No change to audience view.
- No refactor of `recording.js` beyond the fact that the DOM element it targets by id has moved.
- No visual redesign of the buttons beyond stacking them.

## Test impact

The Playwright suite in `tests/` should be checked for selectors that assume:

- `#rec-timer` is a descendant of `#record-toggle`, or
- The Record button's accessible name contains the timer value.

If any such assertions exist, they must be updated to read the timer from inside `#record-section` and to match the button label without a timer component. Existing tests that simply click `#record-toggle` or check `aria-expanded` are unaffected.
