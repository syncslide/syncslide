# Server-Side Recording Design

## Goal

Move recording from client-side JavaScript to the server. Recording state (running/paused/stopped, elapsed time) is tracked in server memory and broadcast over the existing WebSocket connection so all authorized co-presenters on the stage page see live, synced state. Recordings are auto-saved on stop or when the last presenter disconnects.

---

## Scope

- **In:** server recording state, WebSocket sync, auto-save, stage UI replacement
- **Out:** edit page recording controls (none), audience visibility (none), video upload (unchanged)

---

## Server State

### `RecordingState` (added to in-memory `Presentation`)

```rust
struct RecordingState {
    db_id: i64,                        // recording row created at start
    started_at: Instant,               // wall-clock of most recent start or resume
    active_ms: u64,                    // total running time from all completed active periods
    is_paused: bool,
    pause_started_at: Option<Instant>, // set on pause, cleared on resume
    slides: Vec<RecordingEvent>,
}

struct RecordingEvent {
    offset_ms: u64,  // elapsed recording time at the moment of capture
    slide: u32,      // slide index at the moment of capture
}
```

`Presentation` gains:
- `recording: Option<RecordingState>`
- `presenter_count: usize`

**Elapsed time formula:** `started_at` resets to `Instant::now()` on start and on every resume. `active_ms` accumulates completed running time (updated on each resume). At any moment: elapsed = `(Instant::now() - started_at).as_millis() as u64 + active_ms`.

**No new migration needed.**

---

## Slide title/content resolution

`recording_slide` requires `title TEXT NOT NULL` and `content TEXT NOT NULL`. `RecordingEvent` stores only a slide index. At stop time, a new `render_all_slides(markdown: &str) -> Vec<(String, String)>` helper parses all slides using `pulldown-cmark` (already a dependency, already used in `render_slide`), returning one `(title, html_content)` pair per `## ` heading. Each `RecordingEvent` maps to the element at its `slide` index; out-of-range indices are skipped.

The stop logic uses the existing `RecordingSlide::create_batch` with `RecordingSlideInput` (already in `db.rs`).

**Known limitation:** only `Slide` changes trigger snapshots. Content edits mid-recording without a slide advance are reflected at stop-time content, not at the moment the slide was shown. This matches the previous client-side recording behaviour.

---

## WebSocket Protocol

### Inbound message dispatch

`handle_socket` is a synchronous fn and cannot perform async DB writes. Recording messages are dispatched in the **async `socket_handler` closure** inside `ws_handle`, before messages are forwarded to `handle_socket`. The closure parses each incoming text message as `serde_json::Value` and checks the `"type"` field: if it starts with `"recording_"` it calls `handle_recording_message` (async); otherwise it forwards to `handle_socket`. The two paths never overlap.

### Inbound recording messages (client → server)

```rust
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum RecordingMessage {
    RecordingStart,
    RecordingPause,
    RecordingResume,
    RecordingStop,
}
```

Wire format (unit variants, no `"data"` field):
```json
{ "type": "recording_start" }
```

Authorized roles: owner, editor, controller. Audience messages are ignored.

### Outbound recording messages (server → all clients)

New variants added to `SlideMessage` with explicit `#[serde(rename = "...")]` attributes (the existing `content = "data"` wrapper applies, so struct variant fields are nested under `"data"`):

```rust
#[serde(rename = "recording_start")]
RecordingStart { elapsed_ms: u64 },
// ...
```

Outbound wire format (struct variants):
```json
{ "type": "recording_start", "data": { "elapsed_ms": 1234 } }
{ "type": "recording_pause", "data": { "elapsed_ms": 1234 } }
{ "type": "recording_resume", "data": { "elapsed_ms": 1234 } }
{ "type": "recording_stop" }
```

The JS handler reads `msg.data.elapsed_ms` for the timer value.

On WebSocket connect, after sending `Text`/`Slide`, if a recording is active the server sends `RecordingStart { elapsed_ms }` (or `RecordingPause { elapsed_ms }` if paused). `elapsed_ms` is computed at send time; any round-trip delay causes a negligible timer offset.

---

## Recording Control Logic

### Locking protocol

`handle_recording_message` takes `Arc<Mutex<Presentation>>` and manages locking internally. Since `std::sync::Mutex` guards cannot be held across `.await` points, the function follows this pattern: lock → extract/mutate in-memory state → unlock → perform async DB operations → lock again if needed → apply result.

```rust
async fn handle_recording_message(
    msg: RecordingMessage,
    pres: &Arc<Mutex<Presentation>>,
    presentation_id: i64,   // pid.parse::<i64>().unwrap_or(-1)
    pool: &SqlitePool,
) -> Option<SlideMessage>
```

### `recording_start`
1. Lock → if `recording` is `Some`, return `None`. Capture `slide = pres.slide`. Initialise `RecordingState` with `db_id = 0` (placeholder), `started_at = Instant::now()`, `active_ms = 0`, `is_paused = false`, `pause_started_at = None`, first event `RecordingEvent { offset_ms: 0, slide }`. Set `pres.recording = Some(state)`. Unlock.
2. Await: `Recording::create(presentation_id, name, None, String::new(), pool)` → get `db_id`. (`video_path` is `Option<String>` in the existing signature, so `None` is valid.)
3. Lock → set `pres.recording.as_mut().unwrap().db_id = db_id`. Unlock.
4. Return `Some(RecordingStart { elapsed_ms: 0 })`.

### `recording_pause`
1. Lock → if not active or already paused, return `None`. Compute `elapsed_ms`. Set `pause_started_at = Some(Instant::now())`, `is_paused = true`. Unlock.
2. Return `Some(RecordingPause { elapsed_ms })`.

### `recording_resume`
1. Lock → if not active or not paused, return `None`. Compute `active_ms += (pause_started_at.unwrap() - started_at).as_millis() as u64` (captures running time from last start to pause). Reset `started_at = Instant::now()`. Set `pause_started_at = None`, `is_paused = false`. Compute `elapsed_ms ≈ active_ms` (since `started_at` was just reset). Unlock.
2. Return `Some(RecordingResume { elapsed_ms })`.

### `recording_stop` (also called on auto-stop)
1. Lock → if not active, return `None`. Compute `elapsed_ms`. Clone `slides` vec. Capture `db_id` and `pres.content.clone()`. Set `pres.recording = None`. Unlock.
2. Call `render_all_slides(&content)` → `Vec<(title, content)>`.
3. Build `Vec<RecordingSlideInput>` by mapping each `RecordingEvent` (with `position` = enumeration index) to `RecordingSlideInput { start_seconds: offset_ms as f64 / 1000.0, title, content }`. Skip out-of-range slide indices.
4. Await: `RecordingSlide::create_batch(db_id, inputs, pool)`.
5. Await: `Recording::touch(db_id, pool)` — a new `db.rs` method that runs `UPDATE recording SET last_edited = strftime('%s', 'now') WHERE id = ?`.
6. Return `Some(RecordingStop)` (caller skips broadcast if no clients remain).

### Slide snapshot capture

In the async `socket_handler` closure, after calling `handle_socket`, re-lock `pres` to append a snapshot if a `Slide` message was processed:

```rust
if let Ok(SlideMessage::Slide(n)) = serde_json::from_str(&raw_text) {
    let mut slides = state1.slides.lock().unwrap();
    if let Some(p) = slides.get_mut(&pid) {
        let mut p = p.lock().unwrap();
        if let Some(ref mut rec) = p.recording {
            if !rec.is_paused {
                let offset_ms = (Instant::now() - rec.started_at).as_millis() as u64 + rec.active_ms;
                rec.slides.push(RecordingEvent { offset_ms, slide: n });
            }
        }
    }
}
```

### `presenter_count` tracking

At the top of `ws_handle`, after `add_client_handler_channel` returns `pres`:
```rust
if matches!(role, AccessResult::Owner | AccessResult::Editor | AccessResult::Controller) {
    pres.lock().unwrap().presenter_count += 1;
}
```

After `or(socket_handler, channel_handler).await` completes, before `drop(pres)`:
```rust
if matches!(role, AccessResult::Owner | AccessResult::Editor | AccessResult::Controller) {
    let should_auto_stop = {
        let mut p = pres.lock().unwrap();
        p.presenter_count = p.presenter_count.saturating_sub(1);
        p.presenter_count == 0 && p.recording.is_some()
    }; // lock released here
    if should_auto_stop {
        let pid_i64 = pid.parse::<i64>().unwrap_or(-1);
        handle_recording_message(RecordingMessage::RecordingStop, &pres, pid_i64, &state.db_pool).await;
        // no broadcast: no clients remain
    }
}
drop(pres);
```

---

## Frontend Changes (stage page)

### `recording.js` — deleted entirely

### `stage.html` — save dialog removed
The `#saveRecordingDialog`, `#saveRecordingForm`, `#slidesData` hidden input, and `#cancelSaveRecording` button are removed.

### New recording UI inside `<details>`

The `<summary><h2>` pattern is already used in the current stage page.

```html
<details>
  <summary><h2 id="record-heading">Record</h2></summary>
  <section aria-labelledby="record-heading">
    <p>Status: <span id="rec-status" aria-live="polite">Stopped</span></p>
    <p>Timer: <span id="rec-timer">00:00:00</span></p>
    <button id="recordStart">Record</button>
    <button id="recordPause" hidden>Pause</button>
    <button id="recordResume" hidden>Resume</button>
    <button id="recordStop" hidden>Stop</button>
  </section>
</details>
```

`<p>Timer: <span id="rec-timer">...</span></p>` — "Timer:" provides accessible context via normal reading order.

**Button visibility:**
| State | Visible buttons |
|---|---|
| Stopped | Record |
| Running | Pause, Stop |
| Paused | Resume, Stop |

**Timer:** client runs a `setInterval` (1 s tick) initialised from `msg.data.elapsed_ms`. On `RecordingPause`, interval is cleared and display frozen. On `RecordingResume`, interval restarts from `msg.data.elapsed_ms`. On `RecordingStop`, display resets to `00:00:00`.

**Live region:** `#rec-status` has `aria-live="polite"` — announces "Recording", "Paused", "Stopped" on change. `#rec-timer` has no live region.

**Late joiners:** `RecordingStart` and `RecordingPause` received on connect are handled identically to mid-session.

---

## Removed Code

| What | Why |
|---|---|
| `js/recording.js` | Replaced by new WS-driven recording JS |
| Save recording dialog in `stage.html` | Auto-save replaces manual save |
| `#slidesData` hidden input | No longer needed |
| Client-side `recordingData[]`, `jsonRecording()` | Server captures snapshots |

`js/play.js`, `recording.html`, the `recording` and `recording_slide` DB tables, and the `add_recording` HTTP handler are **unchanged**.

---

## New code in `db.rs`

`Recording::touch(id: i64, pool: &SqlitePool) -> Result<(), Error>` — runs `UPDATE recording SET last_edited = strftime('%s', 'now') WHERE id = ?`.

---

## Testing

### Rust unit tests

`handle_recording_message` is a plain async function callable directly:

- `recording_start_creates_db_row` — start → recording row in DB with generated name
- `recording_stop_saves_slides` — start → two slide changes → stop → correct `recording_slide` rows with title, content, position, start_seconds
- `recording_pause_resume_elapsed` — pause/resume → elapsed accounts for pause duration correctly
- `recording_auto_stop_on_last_presenter_disconnect` — start → `presenter_count` to 0 → recording saved
- `recording_start_ignored_if_active` — two start messages → only one recording row
- `only_authorized_roles_can_control_recording` — audience start → ignored; owner start → works

### Playwright tests
- Two stage contexts: one starts recording → other sees "Recording" status and timer inside `<details>`
- Pause on one → other sees "Paused", timer frozen
- Stop on one → other sees "Stopped"
- Recording row visible in presentations list after stop
