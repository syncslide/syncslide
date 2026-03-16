# Slide Navigation Consistency — Design Spec

**Date:** 2026-03-16
**Scope:** `recording.html`, `play.js`
**Goal:** Make slide navigation UI and events consistent between stage and watch-recording pages.

---

## Problem

The stage and recording/watch pages both have a `#goTo` slide dropdown, but behave differently:

| | Stage | Recording/Watch |
|---|---|---|
| Trigger | Select fires immediately (blur/change/Enter via `onCommit`) | Select + separate **Go** button required |
| F8 shortcut | Updates dropdown immediately, then navigates | Sets `video.currentTime`; dropdown lags until `cuechange` fires |

---

## Decisions

1. **Remove Go button** from the recording page — the select will fire immediately on interaction, matching stage.
2. **Option labels** stay different — recording keeps `"Title: 12.5s"` (timestamp context is useful for scrubbing); stage keeps `"1: Title"`.
3. **F8 on recording** updates `goTo.value` immediately (don't wait for `cuechange`).
4. **`onCommit`** is duplicated into `play.js` (6-line helper). `common.js` cannot be shared because it runs WebSocket setup code at the top level, which would break the recording page.

---

## Changes

### `syncslide-websocket/templates/recording.html`

- Remove `<button id="go">Go</button>` from the slide nav section. This also makes the `const go = document.getElementById("go")` reference in `play.js` obsolete (see JS changes below).

### `syncslide-websocket/js/play.js`

1. **Add `onCommit`** inside the `window.addEventListener("load", ...)` callback. Place it immediately after the existing `const goTo` declaration (in place of `const go`, which will be removed). The function is textually identical to the one in `handlers.js` but is scoped inside the load callback rather than at module level, since it is only needed here:
   ```js
   function onCommit(el, fn) {
       el.addEventListener('blur', fn);
       el.addEventListener('change', fn);
       if (el.tagName !== 'TEXTAREA') {
           el.addEventListener('keydown', (e) => { if (e.key === 'Enter') fn(e); });
       }
   }
   ```
   Note: attaching `blur` to a `<select>` fires when the user tabs away without changing the value, triggering navigation to the currently selected slide. This matches existing stage behaviour and is intentional parity.

2. **Extract navigation logic** into a named `goToSlide` function, placed after `onCommit`. Note: the existing Go button click handler (`play.js` line ~137) uses only `parsed.content ?? ''`. The new function intentionally corrects this by adding the `?? parsed.data` fallback to match the `cuechange` handler and avoid silent regressions on older VTT files that use `data` instead of `content`:
   ```js
   function goToSlide() {
       const targetTime = parseFloat(goTo.value);
       video.currentTime = targetTime;
       if (slidesData.cues) {
           const cue = Array.from(slidesData.cues).find(c => c.startTime === targetTime);
           if (cue) {
               const parsed = JSON.parse(cue.text);
               slidesContainer.innerHTML = parsed.content ?? parsed.data ?? '';
           }
       }
   }
   ```

3. **Replace** `go.addEventListener('click', ...)` with `onCommit(goTo, goToSlide)`.

4. **Remove** `const go = document.getElementById("go");` (now obsolete — HTML button removed in step above).

5. **F8 handler** — update both `goTo.value` and `video.currentTime` together. `goTo.value` is set via `String(cueList[i].startTime)`; this matches the string values stored in option elements by `buildGoTo()` (which also uses `String(c.startTime)`), so the assignment correctly selects the right option:
   ```js
   document.addEventListener("keydown", (e) => {
       if (e.key !== "F8") return;
       e.preventDefault();
       const current = Array.from(goTo.options).findIndex(o => o.selected);
       const max = goTo.options.length - 1;
       if (e.shiftKey) {
           if (current > 0) {
               goTo.value = String(cueList[current - 1].startTime);
               video.currentTime = cueList[current - 1].startTime;
           }
       } else {
           if (current < max) {
               goTo.value = String(cueList[current + 1].startTime);
               video.currentTime = cueList[current + 1].startTime;
           }
       }
   });
   ```

---

## Out of Scope

- Unifying option label formats between stage and recording.
- Any changes to `handlers.js` or `common.js`.
- Audience page navigation (read-only, no user-driven nav).
