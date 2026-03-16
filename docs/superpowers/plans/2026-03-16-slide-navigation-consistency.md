# Slide Navigation Consistency Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make slide navigation on the recording/watch page fire immediately on select (like stage), and fix F8 to update the dropdown instantly.

**Architecture:** Two file changes only — remove the Go button from `recording.html`, then update `play.js` to add `onCommit`, extract `goToSlide`, wire `onCommit(goTo, goToSlide)`, remove the old Go button listener, and update the F8 handler to set `goTo.value` immediately alongside `video.currentTime`.

**Tech Stack:** Vanilla JS, Tera HTML templates, deployed on a Rust/Axum server. No JS test framework exists — verification is done by pushing to VPS and testing in browser.

**Deployment note:** Never run the server locally. Push changes and deploy via `config/update.bat` on the VPS (`arch@clippycat.ca`). The service is `syncSlide` (systemd).

---

## Chunk 1: All changes

### Task 1: Remove Go button from recording.html

**Files:**
- Modify: `syncslide-websocket/templates/recording.html:49-53`

- [ ] **Step 1: Remove the Go button**

In `syncslide-websocket/templates/recording.html`, find the slide nav block (around line 49–53):

```html
<nav aria-label="Slide Navigation">
<label for="goTo">Go to slide:</label>
<select id="goTo" name="goTo"></select>
<button id="go">Go</button>
</nav>
```

Change it to:

```html
<nav aria-label="Slide Navigation">
<label for="goTo">Go to slide:</label>
<select id="goTo" name="goTo"></select>
</nav>
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/templates/recording.html
git commit -m "feat: remove Go button from recording slide nav"
```

---

### Task 2: Update play.js

**Files:**
- Modify: `syncslide-websocket/js/play.js`

The full current state of `play.js` for reference — key lines to touch:
- Line 13: `const go = document.getElementById("go");` — remove this
- Lines 137–148: the Go button click handler — replace with `onCommit` wire-up
- Lines 150–160: the F8 handler — update to also set `goTo.value`

- [ ] **Step 1: Remove `const go` and add `onCommit` + `goToSlide`**

In `play.js`, inside the `window.addEventListener("load", () => {` callback:

**Remove** line 13:
```js
const go = document.getElementById("go");
```

**Insert** immediately after the `const goTo` declaration (after line 12), in the space freed by removing `const go`:

```js
function onCommit(el, fn) {
    el.addEventListener('blur', fn);
    el.addEventListener('change', fn);
    if (el.tagName !== 'TEXTAREA') {
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') fn(e); });
    }
}

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

Note: `onCommit` attaches `blur` to the select — this fires on tab-away even without changing the value, triggering navigation to the currently selected slide. This is intentional parity with the stage page.

Note: `goToSlide` uses `parsed.content ?? parsed.data ?? ''` — the `?? parsed.data` fallback is intentionally added here (the old Go button handler was missing it), matching the `cuechange` handler.

- [ ] **Step 2: Replace Go button listener with `onCommit`**

**Remove** the entire Go button click handler block (around lines 137–148):
```js
go.addEventListener('click', () => {
    const targetTime = parseFloat(goTo.value);
    video.currentTime = targetTime;
    // Also render directly — handles the no-video case and avoids waiting for cuechange
    if (slidesData.cues) {
        const cue = Array.from(slidesData.cues).find(c => c.startTime === targetTime);
        if (cue) {
            const parsed = JSON.parse(cue.text);
            slidesContainer.innerHTML = parsed.content ?? '';
        }
    }
});
```

**Insert** in its place:
```js
onCommit(goTo, goToSlide);
```

- [ ] **Step 3: Update the F8 handler to set `goTo.value` immediately**

**Replace** the existing F8 handler (around lines 150–160):
```js
document.addEventListener("keydown", (e) => {
    if (e.key !== "F8") return;
    e.preventDefault();
    const current = Array.from(goTo.options).findIndex(o => o.selected);
    const max = goTo.options.length - 1;
    if (e.shiftKey) {
        if (current > 0) video.currentTime = cueList[current - 1].startTime;
    } else {
        if (current < max) video.currentTime = cueList[current + 1].startTime;
    }
});
```

**With:**
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

The `String(cueList[i].startTime)` values match exactly what `buildGoTo()` stores in option `value` attributes, so the select will update correctly.

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/js/play.js
git commit -m "feat: make recording slide nav fire immediately; fix F8 dropdown lag"
```

---

### Task 3: Deploy and verify

- [ ] **Step 1: Push to remote**

```bash
git push
```

- [ ] **Step 2: Deploy on VPS**

Run on the VPS (or trigger via `config/update.bat` if on Windows):
```bash
ssh arch@clippycat.ca "cd /home/arch/syncSlide && config/update.bat"
```
Or if running the bat script locally: `config\update.bat`

- [ ] **Step 3: Verify recording page — select navigation**

Open a recording page in the browser. Change the slide dropdown selection. Confirm the slide content updates immediately without needing to click a Go button.

- [ ] **Step 4: Verify recording page — no Go button visible**

Confirm the Go button is gone from the slide navigation area.

- [ ] **Step 5: Verify recording page — F8 shortcut**

Press F8 on the recording page. Confirm:
- The slide content changes
- The dropdown visually updates to the new slide immediately (does not lag)
- Shift+F8 goes to the previous slide

- [ ] **Step 6: Verify stage page unaffected**

Open a stage (presenter) page. Confirm slide navigation still works as before (select fires immediately, F8 works, no regressions).
