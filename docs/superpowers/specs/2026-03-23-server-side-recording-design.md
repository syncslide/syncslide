# Server-Side Recording Design

## Goal

Move recording from client-side JavaScript to the server. Recording state (running/paused/stopped, elapsed time) is tracked in server memory and broadcast over the existing WebSocket connection so all authorized co-presenters on the stage page see live, synced state. Recordings are auto-saved on stop or when the last presenter disconnects.

---

## Scope

- **In:** server recording state, WebSocket sync, auto-save, stage UI replacement
- **Out:** edit page recording controls (none), audience visibility (none), video upload (unchanged — not part of recording capture)

---

## Server State

### `RecordingState` (added to in-memory `Presentation`)

```rust
struct RecordingState {
    db_id: i64,           // recording row created at start
    started_at: Instant,  // wall-clock of last start or resume
    paused_ms: u64,       // total accumulated pause duration in ms
    is_paused: bool,
    slides: Vec<RecordingEvent>,
}

struct RecordingEvent {
    offset_ms: u64,  // ms since recording began, excluding paused time
    slide: u32,      // slide index at the moment of capture
}
```

`Presentation` gains:
- `recording: Option<RecordingState>`
- `presenter_count: usize` — incremented on owner/editor/controller connect, decremented on disconnect

**Elapsed time formula:**
- Running: `(Instant::now() - started_at).as_millis() as u64` (does not include `paused_ms`; `paused_ms` is already excluded because `started_at` is reset on resume)
- Paused: frozen at the value computed when pause was triggered

To keep the formula simple, `started_at` is set to `Instant::now()` both on initial start and on every resume. `paused_ms` accumulates each pause duration. Elapsed = `(Instant::now() - started_at).as_millis() as u64 + paused_ms`.

---

## WebSocket Protocol

### Inbound message types (client → server)

Recording control messages are a **separate enum** from slide content messages and are handled in a dedicated branch of the WebSocket handler. They never enter the slide pipeline and cannot be captured as slide snapshots.

```rust
enum RecordingMessage {
    Start,
    Pause,
    Resume,
    Stop,
}
```

JSON wire format:
```json
{ "type": "recording_start" }
{ "type": "recording_pause" }
{ "type": "recording_resume" }
{ "type": "recording_stop" }
```

Authorized roles: owner, editor, controller. Audience members sending these messages are ignored.

### Outbound message types (server → all clients)

Added to `SlideMessage`:

```rust
RecordingStart { elapsed_ms: u64 },
RecordingPause { elapsed_ms: u64 },
RecordingResume { elapsed_ms: u64 },
RecordingStop,
```

On WebSocket connect, if a recording is active the server sends `RecordingStart { elapsed_ms }` (or `RecordingPause { elapsed_ms }` if currently paused) after the existing `Text`/`Slide` messages. Late-joining presenters receive full current state immediately.

---

## Recording Control Logic

### `recording_start`
1. If `recording` is already `Some`, ignore.
2. Insert a `recording` row in DB: `name = "Recording – <ISO timestamp>"`, `captions_path = ""`, no video.
3. Initialise `RecordingState`: `db_id` from insert, `started_at = Instant::now()`, `paused_ms = 0`, `is_paused = false`.
4. Append `RecordingEvent { offset_ms: 0, slide: presentation.slide }`.
5. Broadcast `RecordingStart { elapsed_ms: 0 }`.

### `recording_pause`
1. Compute `elapsed_ms`.
2. Store `pause_started_at = Instant::now()` (internal; used to accumulate on resume).
3. Set `is_paused = true`.
4. Broadcast `RecordingPause { elapsed_ms }`.

### `recording_resume`
1. Add `(Instant::now() - pause_started_at).as_millis()` to `paused_ms`.
2. Set `is_paused = false`.
3. Compute `elapsed_ms`.
4. Broadcast `RecordingResume { elapsed_ms }`.

### `recording_stop` (also called internally on auto-stop)
1. Compute final `elapsed_ms`.
2. Write all `RecordingEvent` entries to `recording_slide` rows in DB (`offset_ms / 1000.0` → `start_seconds`).
3. Set `recording = None`.
4. Broadcast `RecordingStop` (skipped on auto-stop if no clients remain).

### Slide snapshot capture
Whenever the server processes an inbound `SlideMessage::Slide(n)` and `recording.is_some()` and `!recording.is_paused`, append `RecordingEvent { offset_ms: elapsed_ms(), slide: n }`.

### Auto-stop on last presenter disconnect
On WebSocket disconnect, decrement `presenter_count`. If `presenter_count == 0` and `recording.is_some()`, run stop logic (no broadcast needed).

---

## Frontend Changes (stage page)

### `recording.js` — deleted entirely
Client-side snapshot capture, timer management, and save dialog logic are removed.

### `stage.html` — save dialog removed
The `#saveRecordingDialog`, `#saveRecordingForm`, `#slidesData` hidden input, and `#cancelSaveRecording` button are removed.

### New recording UI inside `<details>`

```
<details>
  <summary><h2>Record</h2></summary>
  <section aria-labelledby="record">
    <p>
      Status: <span id="rec-status" aria-live="polite">Stopped</span>
    </p>
    <p>Timer: <span id="rec-timer">00:00:00</span></p>
    <button id="recordStart">Record</button>
    <button id="recordPause" hidden>Pause</button>
    <button id="recordResume" hidden>Resume</button>
    <button id="recordStop" hidden>Stop</button>
  </section>
</details>
```

**Button visibility:**
| State | Visible buttons |
|---|---|
| Stopped | Record |
| Running | Pause, Stop |
| Paused | Resume, Stop |

**Timer:** client runs a `setInterval` (1 s tick) initialised from the server-provided `elapsed_ms`. On `RecordingPause`, interval is cleared and display frozen. On `RecordingResume`, interval restarts from the provided `elapsed_ms`. On `RecordingStop`, display resets to `00:00:00`.

**Live region:** `#rec-status` has `aria-live="polite"` — screen readers announce "Recording", "Paused", "Stopped" on state change. `#rec-timer` has no live region to avoid per-second announcements; it is readable on demand.

**Late joiners:** `RecordingStart` and `RecordingPause` received on initial connect are handled identically to mid-session receipt.

---

## Removed Code

| What | Why |
|---|---|
| `js/recording.js` | Replaced by new inline or separate WS-driven recording JS |
| Save recording dialog in `stage.html` | Auto-save replaces manual save |
| `#slidesData` hidden input | No longer needed |
| Client-side `recordingData[]`, `jsonRecording()` | Server captures snapshots |
| Client-side timer interval logic in `recording.js` | Replaced by server-driven timer initialisation |

`js/play.js`, `recording.html`, the `recording` and `recording_slide` DB tables, and the `add_recording` HTTP handler are **unchanged** — playback is unaffected.

---

## Testing

### Rust unit tests
- `recording_start_creates_db_row` — start message → recording row in DB with generated name
- `recording_stop_saves_slides` — start → two slide changes → stop → correct `recording_slide` rows in DB
- `recording_pause_resume_elapsed` — pause/resume → elapsed accounts for pause duration correctly
- `recording_auto_stop_on_last_presenter_disconnect` — start → disconnect only presenter → recording saved
- `recording_start_ignored_if_active` — two start messages → only one recording row
- `only_authorized_roles_can_control_recording` — audience start → ignored; owner start → works

### Playwright tests
- Two stage contexts: one starts recording → other sees "Recording" status and timer inside `<details>`
- Pause on one → other sees "Paused", timer frozen
- Stop on one → other sees "Stopped"
- Recording row visible in presentations list after stop
