# Recording UI Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two recording UI issues: recording links open in a new tab, and recording status/timer move into the Record toggle button so all controllers see current state without expanding the section.

**Architecture:** Both fixes are template/JS-only changes. Task 1 touches `presentations.html` (one link). Task 2 touches `stage.html` (restructure recording controls) and `recording.js` (add live region announce logic). No Rust changes. No new files.

**Tech Stack:** Tera templates (HTML), vanilla JS, Playwright (tests)

---

### Task 1: Recording links open in a new tab

**Files:**
- Modify: `syncslide-websocket/templates/presentations.html:53`

The recording playback link currently opens in the same tab. Add `target="_blank" rel="noreferrer noopener"`, the same external-link SVG icon already used on stage and edit links, and a `<span class="sr-only">(opens in new tab)</span>`.

The SVG used on the stage link (line 43 of `presentations.html`) is:
```html
<svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12" style="margin-left:0.25em"><path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M8 1h3v3M11 1L5 7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

- [ ] **Step 1: Update the recording link in `presentations.html`**

Find line 53 (inside the `{% for rec in pres.recordings %}` loop):

Before:
```html
<td><a href="/{{ pres.owner_name }}/{{ pres.id }}/{{ rec.id }}">{{ rec.name }}</a></td>
```

After:
```html
<td><a href="/{{ pres.owner_name }}/{{ pres.id }}/{{ rec.id }}" target="_blank" rel="noreferrer noopener">{{ rec.name }}<svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12" style="margin-left:0.25em"><path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M8 1h3v3M11 1L5 7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg> <span class="sr-only">(opens in new tab)</span></a></td>
```

- [ ] **Step 2: Run the full Playwright suite**

```bash
cd tests && npx playwright test --config playwright.config.js
```

Expected: all tests pass. (No existing test checks this link's target attribute, so no test changes are needed.)

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/templates/presentations.html
git commit -m "feat: open recording links in new tab"
```

---

### Task 2: Move recording status and timer into the Record button

**Files:**
- Modify: `syncslide-websocket/templates/stage.html`
- Modify: `syncslide-websocket/js/recording.js`

**What changes and why:**

Currently `rec-status` and `rec-timer` live inside the `hidden` `#record-section`. When a remote controller changes recording state, the section auto-expands on that device — but on other connected controllers it may still be collapsed, so they see nothing. Moving status/timer into the toggle button makes them always visible on every device.

A separate `aria-live="polite"` div (`#rec-announce`) is added outside the section to announce state changes to screen readers. (The old `aria-live` on `#rec-status` never fired when the section was hidden anyway.)

**Visual button states after the change:**

| State | Button text |
|-------|-------------|
| Stopped | `Record: Stopped — 00:00:00` |
| Recording | `Record: Recording — 00:01:23` (timer ticking every second) |
| Paused | `Record: Paused — 00:01:23` (timer frozen) |

Screen readers do not re-announce button text on change — only on focus — so the ticking timer is not disruptive. `#rec-announce` fires once per state transition for live announcement.

- [ ] **Step 3: Update `stage.html`**

The entire `{% block stage %}` block currently reads:

```html
{% block stage %}
<h1 id="stage-heading" tabindex="-1">{{ pres.name }}</h1>
<button type="button" id="qrToggle" aria-pressed="false" aria-controls="qrOverlay">QR</button>
<aside id="qrOverlay" hidden aria-label="QR code">
<a href="/{{ pres_user.name }}/{{ pres.id }}"><img src="/qr/{{ pres_user.name }}/{{ pres.id }}" alt="{{ pres.name }} QR code" width="150" height="150"></a>
</aside>
<h2><button type="button" id="record-toggle" aria-expanded="false" aria-controls="record-section">Record</button></h2>
<section id="record-section" aria-label="Record" hidden>
<p>Status: <span id="rec-status" aria-live="polite">Stopped</span></p>
<p>Timer: <span id="rec-timer">00:00:00</span></p>
<button type="button" id="recordStart">Record</button>
<button type="button" id="recordPause" hidden>Pause</button>
<button type="button" id="recordResume" hidden>Resume</button>
<button type="button" id="recordStop" hidden>Stop</button>
</section>
<script>
document.getElementById('record-toggle').addEventListener('click', function () {
  var expanded = this.getAttribute('aria-expanded') === 'true';
  this.setAttribute('aria-expanded', String(!expanded));
  document.getElementById('record-section').hidden = expanded;
});
</script>
{% include "_slide_nav.html" %}
<script>document.getElementById('stage-heading').focus();</script>
{% endblock stage %}
```

Replace the recording section portion (from the `<h2>` through `</section>`) with:

```html
<h2><button type="button" id="record-toggle" aria-expanded="false" aria-controls="record-section">Record: <span id="rec-status">Stopped</span> — <span id="rec-timer">00:00:00</span></button></h2>
<div id="rec-announce" aria-live="polite" class="sr-only"></div>
<section id="record-section" aria-label="Recording controls" hidden>
<button type="button" id="recordStart">Start recording</button>
<button type="button" id="recordPause" hidden>Pause</button>
<button type="button" id="recordResume" hidden>Resume</button>
<button type="button" id="recordStop" hidden>Stop</button>
</section>
```

The full updated `{% block stage %}` block becomes:

```html
{% block stage %}
<h1 id="stage-heading" tabindex="-1">{{ pres.name }}</h1>
<button type="button" id="qrToggle" aria-pressed="false" aria-controls="qrOverlay">QR</button>
<aside id="qrOverlay" hidden aria-label="QR code">
<a href="/{{ pres_user.name }}/{{ pres.id }}"><img src="/qr/{{ pres_user.name }}/{{ pres.id }}" alt="{{ pres.name }} QR code" width="150" height="150"></a>
</aside>
<h2><button type="button" id="record-toggle" aria-expanded="false" aria-controls="record-section">Record: <span id="rec-status">Stopped</span> — <span id="rec-timer">00:00:00</span></button></h2>
<div id="rec-announce" aria-live="polite" class="sr-only"></div>
<section id="record-section" aria-label="Recording controls" hidden>
<button type="button" id="recordStart">Start recording</button>
<button type="button" id="recordPause" hidden>Pause</button>
<button type="button" id="recordResume" hidden>Resume</button>
<button type="button" id="recordStop" hidden>Stop</button>
</section>
<script>
document.getElementById('record-toggle').addEventListener('click', function () {
  var expanded = this.getAttribute('aria-expanded') === 'true';
  this.setAttribute('aria-expanded', String(!expanded));
  document.getElementById('record-section').hidden = expanded;
});
</script>
{% include "_slide_nav.html" %}
<script>document.getElementById('stage-heading').focus();</script>
{% endblock stage %}
```

- [ ] **Step 4: Update `recording.js`**

The current file is:

```js
// Server-side recording client.
// Listens for recording state messages over the shared WebSocket (set up by common.js)
// and updates the stage recording UI. Sends control messages when buttons are clicked.

(function () {
  const statusEl = document.getElementById('rec-status');
  const timerEl = document.getElementById('rec-timer');
  const btnStart = document.getElementById('recordStart');
  const btnPause = document.getElementById('recordPause');
  const btnResume = document.getElementById('recordResume');
  const btnStop = document.getElementById('recordStop');

  if (!statusEl) return; // not on stage page

  let timerInterval = null;
  let elapsedMs = 0;

  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return String(h).padStart(2, '0') + ':' +
           String(m).padStart(2, '0') + ':' +
           String(s).padStart(2, '0');
  }

  function startTimer(fromMs) {
    elapsedMs = fromMs;
    clearInterval(timerInterval);
    const startedAt = Date.now() - fromMs;
    timerInterval = setInterval(function () {
      elapsedMs = Date.now() - startedAt;
      timerEl.textContent = formatTime(elapsedMs);
    }, 1000);
    timerEl.textContent = formatTime(elapsedMs);
  }

  function stopTimer(freezeAt) {
    clearInterval(timerInterval);
    timerInterval = null;
    if (freezeAt !== undefined) {
      elapsedMs = freezeAt;
      timerEl.textContent = formatTime(elapsedMs);
    }
  }

  function setRunning(fromMs) {
    statusEl.textContent = 'Recording';
    btnStart.hidden = true;
    btnPause.hidden = false;
    btnResume.hidden = true;
    btnStop.hidden = false;
    startTimer(fromMs);
  }

  function setPaused(atMs) {
    statusEl.textContent = 'Paused';
    btnStart.hidden = true;
    btnPause.hidden = true;
    btnResume.hidden = false;
    btnStop.hidden = false;
    stopTimer(atMs);
  }

  function setStopped() {
    statusEl.textContent = 'Stopped';
    btnStart.hidden = false;
    btnPause.hidden = true;
    btnResume.hidden = true;
    btnStop.hidden = true;
    stopTimer(0);
    timerEl.textContent = '00:00:00';
  }

  const sectionEl = document.getElementById('record-section');
  const toggleEl = document.getElementById('record-toggle');

  function expandSection() {
    if (sectionEl && sectionEl.hidden) {
      sectionEl.hidden = false;
      if (toggleEl) toggleEl.setAttribute('aria-expanded', 'true');
    }
  }

  // Handle incoming WS messages
  window.handleRecordingMessage = function (type, data) {
    expandSection();
    if (type === 'recording_start') {
      setRunning(data.elapsed_ms);
    } else if (type === 'recording_pause') {
      setPaused(data.elapsed_ms);
    } else if (type === 'recording_resume') {
      setRunning(data.elapsed_ms);
    } else if (type === 'recording_stop') {
      setStopped();
    }
  };

  function send(type) {
    if (typeof socket !== 'undefined' && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: type }));
    }
  }

  btnStart.addEventListener('click', function () { send('recording_start'); });
  btnPause.addEventListener('click', function () { send('recording_pause'); });
  btnResume.addEventListener('click', function () { send('recording_resume'); });
  btnStop.addEventListener('click', function () { send('recording_stop'); });
}());
```

Replace the entire file with:

```js
// Server-side recording client.
// Listens for recording state messages over the shared WebSocket (set up by common.js)
// and updates the stage recording UI. Sends control messages when buttons are clicked.

(function () {
  const statusEl = document.getElementById('rec-status');
  const timerEl = document.getElementById('rec-timer');
  const announceEl = document.getElementById('rec-announce');
  const btnStart = document.getElementById('recordStart');
  const btnPause = document.getElementById('recordPause');
  const btnResume = document.getElementById('recordResume');
  const btnStop = document.getElementById('recordStop');

  if (!statusEl) return; // not on stage page

  let timerInterval = null;
  let elapsedMs = 0;

  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return String(h).padStart(2, '0') + ':' +
           String(m).padStart(2, '0') + ':' +
           String(s).padStart(2, '0');
  }

  function announce(message) {
    announceEl.textContent = message;
    setTimeout(function () { announceEl.textContent = ''; }, 100);
  }

  function startTimer(fromMs) {
    elapsedMs = fromMs;
    clearInterval(timerInterval);
    const startedAt = Date.now() - fromMs;
    timerInterval = setInterval(function () {
      elapsedMs = Date.now() - startedAt;
      timerEl.textContent = formatTime(elapsedMs);
    }, 1000);
    timerEl.textContent = formatTime(elapsedMs);
  }

  function stopTimer(freezeAt) {
    clearInterval(timerInterval);
    timerInterval = null;
    if (freezeAt !== undefined) {
      elapsedMs = freezeAt;
      timerEl.textContent = formatTime(elapsedMs);
    }
  }

  function setRunning(fromMs) {
    statusEl.textContent = 'Recording';
    btnStart.hidden = true;
    btnPause.hidden = false;
    btnResume.hidden = true;
    btnStop.hidden = false;
    startTimer(fromMs);
    announce('Recording started');
  }

  function setPaused(atMs) {
    statusEl.textContent = 'Paused';
    btnStart.hidden = true;
    btnPause.hidden = true;
    btnResume.hidden = false;
    btnStop.hidden = false;
    stopTimer(atMs);
    announce('Recording paused');
  }

  function setStopped() {
    statusEl.textContent = 'Stopped';
    btnStart.hidden = false;
    btnPause.hidden = true;
    btnResume.hidden = true;
    btnStop.hidden = true;
    stopTimer(0);
    timerEl.textContent = '00:00:00';
    announce('Recording stopped');
  }

  const sectionEl = document.getElementById('record-section');
  const toggleEl = document.getElementById('record-toggle');

  function expandSection() {
    if (sectionEl && sectionEl.hidden) {
      sectionEl.hidden = false;
      if (toggleEl) toggleEl.setAttribute('aria-expanded', 'true');
    }
  }

  // Handle incoming WS messages
  window.handleRecordingMessage = function (type, data) {
    expandSection();
    if (type === 'recording_start') {
      setRunning(data.elapsed_ms);
    } else if (type === 'recording_pause') {
      setPaused(data.elapsed_ms);
    } else if (type === 'recording_resume') {
      setRunning(data.elapsed_ms);
    } else if (type === 'recording_stop') {
      setStopped();
    }
  };

  function send(type) {
    if (typeof socket !== 'undefined' && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: type }));
    }
  }

  btnStart.addEventListener('click', function () { send('recording_start'); });
  btnPause.addEventListener('click', function () { send('recording_pause'); });
  btnResume.addEventListener('click', function () { send('recording_resume'); });
  btnStop.addEventListener('click', function () { send('recording_stop'); });
}());
```

- [ ] **Step 5: Run the Playwright recording sync tests**

```bash
cd tests && npx playwright test --config playwright.config.js websocket.spec.js
```

Expected: all 5 tests pass (2 websocket sync + 3 recording sync). The `#rec-status` span still exists with the same ID — just inside the button now — so all three recording sync assertions (`toHaveText('Recording')`, `toHaveText('Paused')`, `toHaveText('Stopped')`) still work.

- [ ] **Step 6: Run the full suite**

```bash
cd tests && npx playwright test --config playwright.config.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add syncslide-websocket/templates/stage.html syncslide-websocket/js/recording.js
git commit -m "feat: show recording status and timer in Record button label"
```
