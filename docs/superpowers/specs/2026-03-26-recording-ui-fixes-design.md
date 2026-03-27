# Recording UI Fixes — Design Spec

**Date:** 2026-03-26

## Overview

Two independent fixes to the recording UI:

1. Recording playback links open in a new tab.
2. Recording status and timer move into the Record toggle button label, so controllers can see the current state without expanding the disclosure section.

---

## Fix 1: Recording links open in new tab

### Problem

In `presentations.html`, the recording playback link opens in the same tab:

```html
<td><a href="/{{ pres.owner_name }}/{{ pres.id }}/{{ rec.id }}">{{ rec.name }}</a></td>
```

This navigates away from the presentations list, losing scroll position and filter state.

### Solution

Add `target="_blank" rel="noreferrer noopener"` and a screen-reader-only "(opens in new tab)" hint, matching the pattern already used for stage links and edit links in the same template.

```html
<td>
  <a href="/{{ pres.owner_name }}/{{ pres.id }}/{{ rec.id }}"
     target="_blank"
     rel="noreferrer noopener">
    {{ rec.name }}<svg aria-hidden="true" focusable="false" ...>...</svg>
    <span class="sr-only">(opens in new tab)</span>
  </a>
</td>
```

Use the same external-link SVG icon already used on the stage and edit links (12×12, stroke path).

### Scope

Only `presentations.html:53`. No other recording playback links exist in templates.

---

## Fix 2: Status and timer in the Record button label

### Problem

Recording status (`rec-status`) and timer (`rec-timer`) live inside the hidden `#record-section`. When a remote controller starts, pauses, or resumes a recording, the section auto-expands on that controller's device — but on other connected controller devices the section may be collapsed. Sighted users and screen reader users on those devices have no way to know the current recording state without expanding the disclosure.

### Solution

Move status and timer text into the Record toggle button itself, making them always visible regardless of whether the section is expanded. Add a separate `aria-live="polite"` region outside the section that announces state changes once (not on every timer tick).

### HTML changes (`stage.html`)

**Before:**
```html
<h2><button type="button" id="record-toggle" aria-expanded="false" aria-controls="record-section">Record</button></h2>
<section id="record-section" aria-label="Record" hidden>
  <p>Status: <span id="rec-status" aria-live="polite">Stopped</span></p>
  <p>Timer: <span id="rec-timer">00:00:00</span></p>
  <button type="button" id="recordStart">Record</button>
  <button type="button" id="recordPause" hidden>Pause</button>
  <button type="button" id="recordResume" hidden>Resume</button>
  <button type="button" id="recordStop" hidden>Stop</button>
</section>
```

**After:**
```html
<h2><button type="button" id="record-toggle" aria-expanded="false" aria-controls="record-section">Record: <span id="rec-status">Stopped</span> — <span id="rec-timer"></span></button></h2>
<div id="rec-announce" aria-live="polite" class="sr-only"></div>
<section id="record-section" aria-label="Recording controls" hidden>
  <button type="button" id="recordStart">Start recording</button>
  <button type="button" id="recordPause" hidden>Pause</button>
  <button type="button" id="recordResume" hidden>Resume</button>
  <button type="button" id="recordStop" hidden>Stop</button>
</section>
```

Key points:
- `rec-status` and `rec-timer` move into the button, always visible.
- Timer resets to `00:00:00` when stopped; shows elapsed `HH:MM:SS` when recording (ticking) or paused (frozen).
- No `aria-live` on elements inside the button — screen readers don't re-announce button text on change, only on focus. This prevents noisy second-by-second announcements while the timer runs.
- `rec-announce` is an always-present `aria-live="polite"` region (visually hidden) that fires once per state change with a brief message (e.g. "Recording started", "Recording paused").
- The `aria-live="polite"` that was on `rec-status` is removed (it was inside the hidden section and therefore never fired when collapsed anyway).

### Visual button states

| State | Button text |
|-------|-------------|
| Stopped | `Record: Stopped — 00:00:00` |
| Recording | `Record: Recording — 00:01:23` (timer ticking) |
| Paused | `Record: Paused — 00:01:23` (timer frozen) |

### JS changes (`recording.js`)

- `statusEl` — still points to `#rec-status` (now inside button).
- `timerEl` — still points to `#rec-timer` (now inside button).
- Add `announceEl` pointing to `#rec-announce`.
- In `setRunning`, `setPaused`, `setStopped`: after updating `statusEl.textContent`, also set `announceEl.textContent` to a brief message, then clear it after a short delay (to allow re-announcement on repeated state changes).
  - `setRunning` → "Recording started"
  - `setPaused` → "Recording paused"
  - `setStopped` → "Recording stopped"
- `setStopped` sets `rec-timer` back to `"00:00:00"` (same as before).

### Announcement timing

Setting `announceEl.textContent` then clearing after ~100ms ensures the same announcement can fire again if the state toggles back quickly (e.g. pause → resume → pause). Without the clear, a repeat of the same string is not re-announced by most screen readers.

### WCAG notes

- **2.5.3 Label in Name:** The visible button text includes "Record"; the accessible name contains the visible text. ✓
- **4.1.3 Status Messages:** State changes are announced via `aria-live="polite"` on `#rec-announce`. Timer ticks are not announced (no live region on timer). ✓
- **1.4.1 / 1.4.3:** Status text is text content, not colour alone. ✓

---

## Files changed

| File | Change |
|------|--------|
| `syncslide-websocket/templates/presentations.html` | Add `target="_blank"`, `rel`, SVG icon, and sr-only hint to recording link |
| `syncslide-websocket/templates/stage.html` | Move `rec-status` and `rec-timer` into button; add `rec-announce`; remove status/timer paragraphs from section |
| `syncslide-websocket/js/recording.js` | Point to `rec-announce`; add announce calls in state functions; clear timer on stop |

---

## Out of scope

- Playwright test updates are not included in this spec. Existing recording sync tests should still pass since element IDs are unchanged. If tests reference the status/timer paragraph structure, they will need minor updates.
