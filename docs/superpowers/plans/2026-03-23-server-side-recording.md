# Server-Side Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move recording from client-side JS to the server, syncing recording state (running/paused/stopped, timer) to all authorized co-presenters on the stage page via WebSocket.

**Architecture:** New `RecordingState` struct added to in-memory `Presentation`. Recording control messages (`recording_start/pause/resume/stop`) are dispatched in the async `socket_handler` closure, never entering the slide pipeline. `handle_recording_message` manages its own lock/unlock cycles around async DB calls. On stop (manual or when last presenter disconnects), the server writes `recording_slide` rows using `pulldown-cmark` to resolve slide indices to title/HTML content.

**Tech Stack:** Rust, Axum 0.8, SQLx (SQLite), tokio::sync::broadcast, pulldown-cmark (already present), vanilla JS.

---

## Deployment notes

- **Never build locally.** All builds and tests run on the VPS: `arch@clippycat.ca`.
- Deploy and test via `config/deploy.bat` (pull → `cargo build --release` → restart service).
- Playwright tests: `npx playwright test --config tests/playwright.config.js` (from VPS or local — config targets VPS).
- Rust tests: `cd syncslide-websocket && cargo test` on VPS.
- After any SQL change: `cargo sqlx prepare -- --all-targets` on VPS, then commit `.sqlx/`.
- No SQL changes in this plan — no `cargo sqlx prepare` needed.

---

## File map

| File | Change |
|---|---|
| `syncslide-websocket/src/db.rs` | Add `Recording::touch` method |
| `syncslide-websocket/src/main.rs` | Add `RecordingState`, `RecordingEvent`, new `SlideMessage` variants, `RecordingMessage` enum, `render_all_slides`, `handle_recording_message`, modify `Presentation`, `ws_handle`, `socket_handler` |
| `syncslide-websocket/templates/stage.html` | Replace recording `<details>` UI, remove save dialog and related elements |
| `syncslide-websocket/js/recording.js` | Complete rewrite — WS-driven recording client |

---

## Task 1: Add `Recording::touch` to `db.rs`

**Files:**
- Modify: `syncslide-websocket/src/db.rs` (after `update_name`, around line 90)
- Test: `syncslide-websocket/src/db.rs` (in the existing `#[cfg(test)]` module at the bottom)

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)]` module in `db.rs`:

```rust
/// Recording::touch must update last_edited without changing anything else.
#[tokio::test]
async fn recording_touch_updates_last_edited() {
    let pool = setup_pool().await;
    let owner = make_user("owner", &pool).await;
    let pres = make_presentation(&owner, &pool).await;
    let rec = Recording::create(pres.id, "Test".to_string(), None, String::new(), &pool)
        .await
        .unwrap();
    assert!(rec.last_edited.is_none());
    Recording::touch(rec.id, &pool).await.unwrap();
    let updated = Recording::get_by_id(rec.id, &pool).await.unwrap().unwrap();
    assert!(updated.last_edited.is_some());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run on VPS: `cd syncslide-websocket && cargo test recording_touch_updates_last_edited`
Expected: compile error — `Recording::touch` not found.

- [ ] **Step 3: Implement `Recording::touch`**

Add after `update_name` in `db.rs` `impl Recording` block:

```rust
pub async fn touch(id: i64, db: &SqlitePool) -> Result<(), Error> {
    sqlx::query(
        "UPDATE recording SET last_edited = strftime('%s', 'now') WHERE id = ?;",
    )
    .bind(id)
    .execute(db)
    .await
    .map_err(Error::from)
    .map(|_| ())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd syncslide-websocket && cargo test recording_touch_updates_last_edited`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add syncslide-websocket/src/db.rs
git commit -m "feat: add Recording::touch to update last_edited"
```

---

## Task 2: Add `RecordingState`, `RecordingEvent`, extend `Presentation`, add `RecordingMessage` and new `SlideMessage` variants

**Files:**
- Modify: `syncslide-websocket/src/main.rs`

No test in this task — these are data structures. They are tested indirectly by later tasks.

- [ ] **Step 1: Add `RecordingEvent` and `RecordingState` structs**

Add after the `SlideMessage` enum (around line 98) in `main.rs`:

```rust
struct RecordingEvent {
    offset_ms: u64,
    slide: u32,
}

struct RecordingState {
    db_id: i64,
    started_at: std::time::Instant,
    /// Total running time from all completed active periods (updated on each resume).
    active_ms: u64,
    is_paused: bool,
    pause_started_at: Option<std::time::Instant>,
    slides: Vec<RecordingEvent>,
}
```

- [ ] **Step 2: Add `presenter_count` and `recording` fields to `Presentation`**

Change `Presentation` struct from:

```rust
pub struct Presentation {
    content: String,
    slide: u32,
    channel: (Sender<SlideMessage>, Receiver<SlideMessage>),
}
```

To:

```rust
pub struct Presentation {
    content: String,
    slide: u32,
    channel: (Sender<SlideMessage>, Receiver<SlideMessage>),
    recording: Option<RecordingState>,
    presenter_count: usize,
}
```

- [ ] **Step 3: Update `Presentation` construction in `add_client_handler_channel`**

Find this in `add_client_handler_channel` (around line 193):

```rust
Arc::new(Mutex::new(Presentation {
    content: db_content,
    slide: 0,
    channel: broadcast::channel(1024),
}))
```

Change to:

```rust
Arc::new(Mutex::new(Presentation {
    content: db_content,
    slide: 0,
    channel: broadcast::channel(1024),
    recording: None,
    presenter_count: 0,
}))
```

And find the second construction in the test helper `make_presentation_in_memory` (search for `Arc::new(Mutex::new(Presentation {` — there may be one in tests too). Update it the same way if present.

- [ ] **Step 4: Add new `SlideMessage` variants**

Add to the `SlideMessage` enum. The existing derive uses `#[serde(rename_all = "lowercase")]` which would give `recordingstart` — wrong. Add explicit renames:

```rust
#[serde(rename = "recording_start")]
RecordingStart { elapsed_ms: u64 },
#[serde(rename = "recording_pause")]
RecordingPause { elapsed_ms: u64 },
#[serde(rename = "recording_resume")]
RecordingResume { elapsed_ms: u64 },
#[serde(rename = "recording_stop")]
RecordingStop,
```

- [ ] **Step 5: Add `RecordingMessage` enum**

Add after `SlideMessage`:

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

- [ ] **Step 6: Verify it compiles**

Run on VPS: `cd syncslide-websocket && cargo build`
Expected: compiles. If there are match exhaustiveness errors on `SlideMessage` (e.g. in `update_slide` or `channel_handler`), add wildcard arms `_ => {}` to those matches.

- [ ] **Step 7: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "feat: add RecordingState, RecordingMessage, new SlideMessage variants"
```

---

## Task 3: Add `render_all_slides` helper

**Files:**
- Modify: `syncslide-websocket/src/main.rs` (add after `render_slide`)

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)]` module in `main.rs`:

```rust
/// render_all_slides must return one (title, html) pair per ## heading.
#[test]
fn render_all_slides_splits_on_h2() {
    let md = "## Intro\nHello world\n\n## Second\nContent here";
    let slides = render_all_slides(md);
    assert_eq!(slides.len(), 2);
    assert_eq!(slides[0].0, "Intro");
    assert!(slides[0].1.contains("Hello world"), "got: {}", slides[0].1);
    assert_eq!(slides[1].0, "Second");
    assert!(slides[1].1.contains("Content here"), "got: {}", slides[1].1);
}

/// render_all_slides must return empty vec for content with no ## headings.
#[test]
fn render_all_slides_empty_for_no_headings() {
    let slides = render_all_slides("just some text");
    assert_eq!(slides.len(), 0);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd syncslide-websocket && cargo test render_all_slides`
Expected: compile error — `render_all_slides` not found.

- [ ] **Step 3: Implement `render_all_slides`**

Add after `render_slide` in `main.rs`:

```rust
/// Returns `(title, html_content)` for every `## ` slide in the markdown.
/// Uses the same pulldown-cmark parser as `render_slide`.
fn render_all_slides(markdown: &str) -> Vec<(String, String)> {
    let events: Vec<Event<'_>> = Parser::new_ext(markdown, Options::all()).collect();
    let slide_starts: Vec<usize> = events
        .iter()
        .enumerate()
        .filter_map(|(i, e)| match e {
            Event::Start(Tag::Heading { level: HeadingLevel::H2, .. }) => Some(i),
            _ => None,
        })
        .collect();
    slide_starts
        .iter()
        .enumerate()
        .map(|(i, &start)| {
            let end = slide_starts.get(i + 1).copied().unwrap_or(events.len());
            // Extract heading text
            let title = events[start..end]
                .iter()
                .filter_map(|e| if let Event::Text(t) = e { Some(t.as_ref()) } else { None })
                .next()
                .unwrap_or("")
                .to_string();
            // Render full slide HTML
            let mut html = String::new();
            cmark_html::push_html(&mut html, events[start..end].iter().cloned());
            (title, html)
        })
        .collect()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd syncslide-websocket && cargo test render_all_slides`
Expected: both PASS

- [ ] **Step 5: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "feat: add render_all_slides helper using pulldown-cmark"
```

---

## Task 4: Implement `handle_recording_message` — start and stop

**Files:**
- Modify: `syncslide-websocket/src/main.rs`

- [ ] **Step 1: Write failing tests for start and stop**

Add to the `#[cfg(test)]` module in `main.rs`:

```rust
fn make_presentation_arc() -> Arc<Mutex<Presentation>> {
    let (tx, _rx) = broadcast::channel(8);
    Arc::new(Mutex::new(Presentation {
        content: "## Intro\nHello\n\n## Second\nWorld".to_string(),
        slide: 0,
        channel: (tx, broadcast::channel(8).1),
        recording: None,
        presenter_count: 0,
    }))
}

/// recording_start must insert a recording row and set in-memory state.
#[tokio::test]
async fn recording_start_creates_db_row() {
    let pool = setup_pool().await;
    let owner = make_user("owner", &pool).await;
    let pres_db = make_presentation(&owner, &pool).await;
    let pres = make_presentation_arc();

    let result = handle_recording_message(
        RecordingMessage::RecordingStart,
        &pres,
        pres_db.id,
        &pool,
    ).await;

    assert!(matches!(result, Some(SlideMessage::RecordingStart { elapsed_ms: 0 })));
    assert!(pres.lock().unwrap().recording.is_some());
    // DB row exists
    let rec_id = pres.lock().unwrap().recording.as_ref().unwrap().db_id;
    let row = Recording::get_by_id(rec_id, &pool).await.unwrap();
    assert!(row.is_some());
    assert!(row.unwrap().name.starts_with("Recording"));
}

/// recording_start when already active must return None (no-op).
#[tokio::test]
async fn recording_start_ignored_if_active() {
    let pool = setup_pool().await;
    let owner = make_user("owner", &pool).await;
    let pres_db = make_presentation(&owner, &pool).await;
    let pres = make_presentation_arc();

    handle_recording_message(RecordingMessage::RecordingStart, &pres, pres_db.id, &pool).await;
    let result = handle_recording_message(RecordingMessage::RecordingStart, &pres, pres_db.id, &pool).await;

    assert!(result.is_none());
    // Only one DB row
    let rows: Vec<_> = sqlx::query_as::<_, Recording>(
        "SELECT * FROM recording WHERE presentation_id = ?",
    )
    .bind(pres_db.id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
}

/// recording_stop must write recording_slide rows and clear in-memory state.
#[tokio::test]
async fn recording_stop_saves_slides() {
    let pool = setup_pool().await;
    let owner = make_user("owner", &pool).await;
    let pres_db = make_presentation(&owner, &pool).await;
    let pres = make_presentation_arc();

    handle_recording_message(RecordingMessage::RecordingStart, &pres, pres_db.id, &pool).await;

    // Simulate two slide changes
    {
        let mut p = pres.lock().unwrap();
        let rec = p.recording.as_mut().unwrap();
        rec.slides.push(RecordingEvent { offset_ms: 2000, slide: 1 });
    }

    let result = handle_recording_message(RecordingMessage::RecordingStop, &pres, pres_db.id, &pool).await;

    assert!(matches!(result, Some(SlideMessage::RecordingStop)));
    assert!(pres.lock().unwrap().recording.is_none());

    // recording_slide rows exist
    let rec_id = Recording::get_by_presentation_id_latest(pres_db.id, &pool).await;
    // Use direct query since no helper for this:
    let rows = sqlx::query_as::<_, RecordingSlide>(
        "SELECT * FROM recording_slide WHERE recording_id = (SELECT id FROM recording WHERE presentation_id = ? ORDER BY id DESC LIMIT 1) ORDER BY position",
    )
    .bind(pres_db.id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].position, 0);
    assert_eq!(rows[0].title, "Intro");
    assert!((rows[0].start_seconds - 0.0).abs() < 0.001);
    assert_eq!(rows[1].position, 1);
    assert_eq!(rows[1].title, "Second");
    assert!((rows[1].start_seconds - 2.0).abs() < 0.001);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd syncslide-websocket && cargo test recording_start_creates_db_row recording_start_ignored_if_active recording_stop_saves_slides`
Expected: compile errors — `handle_recording_message` not found.

- [ ] **Step 3: Implement `handle_recording_message` (start and stop only)**

Add this function before `ws_handle` in `main.rs`:

```rust
async fn handle_recording_message(
    msg: RecordingMessage,
    pres: &Arc<Mutex<Presentation>>,
    presentation_id: i64,
    pool: &SqlitePool,
) -> Option<SlideMessage> {
    match msg {
        RecordingMessage::RecordingStart => {
            // Check and initialise under lock (placeholder db_id = -1)
            let slide = {
                let mut p = pres.lock().unwrap();
                if p.recording.is_some() {
                    return None;
                }
                let slide = p.slide;
                p.recording = Some(RecordingState {
                    db_id: -1,
                    started_at: std::time::Instant::now(),
                    active_ms: 0,
                    is_paused: false,
                    pause_started_at: None,
                    slides: vec![RecordingEvent { offset_ms: 0, slide }],
                });
                slide
            };
            let _ = slide; // used above
            // Create DB row
            let name = {
                let now = time::OffsetDateTime::now_utc();
                format!("Recording – {}", now.format(&time::format_description::well_known::Rfc3339).unwrap_or_default())
            };
            let rec = Recording::create(presentation_id, name, None, String::new(), pool).await.ok()?;
            // Store real db_id
            pres.lock().unwrap().recording.as_mut()?.db_id = rec.id;
            Some(SlideMessage::RecordingStart { elapsed_ms: 0 })
        }

        RecordingMessage::RecordingPause => {
            let elapsed_ms = {
                let mut p = pres.lock().unwrap();
                let rec = p.recording.as_mut()?;
                if rec.is_paused { return None; }
                let elapsed_ms = (std::time::Instant::now() - rec.started_at).as_millis() as u64 + rec.active_ms;
                rec.pause_started_at = Some(std::time::Instant::now());
                rec.is_paused = true;
                elapsed_ms
            };
            Some(SlideMessage::RecordingPause { elapsed_ms })
        }

        RecordingMessage::RecordingResume => {
            let elapsed_ms = {
                let mut p = pres.lock().unwrap();
                let rec = p.recording.as_mut()?;
                if !rec.is_paused { return None; }
                let pause_start = rec.pause_started_at?;
                // Accumulate running time from last start to pause
                rec.active_ms += (pause_start - rec.started_at).as_millis() as u64;
                rec.started_at = std::time::Instant::now();
                rec.pause_started_at = None;
                rec.is_paused = false;
                // elapsed ≈ active_ms since started_at was just reset
                rec.active_ms
            };
            Some(SlideMessage::RecordingResume { elapsed_ms })
        }

        RecordingMessage::RecordingStop => {
            // Extract everything needed before async work
            let (db_id, slides, content) = {
                let mut p = pres.lock().unwrap();
                let rec = p.recording.take()?;
                (rec.db_id, rec.slides, p.content.clone())
            };
            if db_id < 0 {
                // DB row not yet created (start still in progress) — nothing to save
                return Some(SlideMessage::RecordingStop);
            }
            // Resolve slide indices to title/content
            let all_slides = render_all_slides(&content);
            let inputs: Vec<RecordingSlideInput> = slides
                .into_iter()
                .filter_map(|ev| {
                    let (title, html) = all_slides.get(ev.slide as usize)?.clone();
                    Some(RecordingSlideInput {
                        start_seconds: ev.offset_ms as f64 / 1000.0,
                        title,
                        content: html,
                    })
                })
                .collect();
            let _ = RecordingSlide::create_batch(db_id, inputs, pool).await;
            let _ = Recording::touch(db_id, pool).await;
            Some(SlideMessage::RecordingStop)
        }
    }
}
```

- [ ] **Step 4: Fix test helper — add a direct SQL query for the stop test**

The `recording_stop_saves_slides` test uses a direct `sqlx::query_as` — that's fine as written. Remove the unused `rec_id` binding from the test (the line `let rec_id = ...`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd syncslide-websocket && cargo test recording_start_creates_db_row recording_start_ignored_if_active recording_stop_saves_slides`
Expected: all PASS

- [ ] **Step 6: Run full test suite**

Run: `cd syncslide-websocket && cargo test`
Expected: all existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "feat: implement handle_recording_message (start/pause/resume/stop)"
```

---

## Task 5: Pause/resume elapsed time test

**Files:**
- Modify: `syncslide-websocket/src/main.rs` (test only)

- [ ] **Step 1: Write the failing test**

```rust
/// Elapsed time must account for paused periods.
#[tokio::test]
async fn recording_pause_resume_elapsed() {
    let pool = setup_pool().await;
    let owner = make_user("owner", &pool).await;
    let pres_db = make_presentation(&owner, &pool).await;
    let pres = make_presentation_arc();

    // Start
    handle_recording_message(RecordingMessage::RecordingStart, &pres, pres_db.id, &pool).await;

    // Pause immediately — elapsed should be very small (< 100ms)
    let pause_msg = handle_recording_message(RecordingMessage::RecordingPause, &pres, pres_db.id, &pool).await;
    let elapsed_at_pause = match pause_msg {
        Some(SlideMessage::RecordingPause { elapsed_ms }) => elapsed_ms,
        _ => panic!("expected RecordingPause"),
    };
    assert!(elapsed_at_pause < 200, "elapsed at pause was {elapsed_at_pause}ms, expected < 200ms");
    assert!(pres.lock().unwrap().recording.as_ref().unwrap().is_paused);

    // Resume — elapsed should still be small
    let resume_msg = handle_recording_message(RecordingMessage::RecordingResume, &pres, pres_db.id, &pool).await;
    let elapsed_at_resume = match resume_msg {
        Some(SlideMessage::RecordingResume { elapsed_ms }) => elapsed_ms,
        _ => panic!("expected RecordingResume"),
    };
    assert!(!pres.lock().unwrap().recording.as_ref().unwrap().is_paused);
    // elapsed at resume should be >= elapsed at pause (not reset to 0)
    assert!(elapsed_at_resume >= elapsed_at_pause,
        "elapsed at resume ({elapsed_at_resume}) should be >= elapsed at pause ({elapsed_at_pause})");
}
```

- [ ] **Step 2: Run test**

Run: `cd syncslide-websocket && cargo test recording_pause_resume_elapsed`
Expected: PASS (implementation already handles this)

- [ ] **Step 3: Add test for double-pause no-op**

```rust
/// Pausing when already paused must return None.
#[tokio::test]
async fn recording_pause_noop_when_already_paused() {
    let pool = setup_pool().await;
    let owner = make_user("owner", &pool).await;
    let pres_db = make_presentation(&owner, &pool).await;
    let pres = make_presentation_arc();
    handle_recording_message(RecordingMessage::RecordingStart, &pres, pres_db.id, &pool).await;
    handle_recording_message(RecordingMessage::RecordingPause, &pres, pres_db.id, &pool).await;
    let result = handle_recording_message(RecordingMessage::RecordingPause, &pres, pres_db.id, &pool).await;
    assert!(result.is_none());
}
```

- [ ] **Step 4: Run all recording tests**

Run: `cd syncslide-websocket && cargo test recording_`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "test: add pause/resume elapsed and double-pause no-op tests"
```

---

## Task 6: Auto-stop test and presenter_count tracking

**Files:**
- Modify: `syncslide-websocket/src/main.rs`

- [ ] **Step 1: Write failing test for auto-stop**

```rust
/// When presenter_count drops to 0 with an active recording, the stop logic saves slides.
#[tokio::test]
async fn recording_auto_stop_on_last_presenter_disconnect() {
    let pool = setup_pool().await;
    let owner = make_user("owner", &pool).await;
    let pres_db = make_presentation(&owner, &pool).await;
    let pres = make_presentation_arc();

    // Start recording
    handle_recording_message(RecordingMessage::RecordingStart, &pres, pres_db.id, &pool).await;
    let rec_id = pres.lock().unwrap().recording.as_ref().unwrap().db_id;

    // Simulate auto-stop (same as stop, but called by disconnect handler)
    let result = handle_recording_message(RecordingMessage::RecordingStop, &pres, pres_db.id, &pool).await;
    assert!(matches!(result, Some(SlideMessage::RecordingStop)));
    assert!(pres.lock().unwrap().recording.is_none());

    // last_edited was set
    let rec = Recording::get_by_id(rec_id, &pool).await.unwrap().unwrap();
    assert!(rec.last_edited.is_some());
}
```

- [ ] **Step 2: Run test**

Run: `cd syncslide-websocket && cargo test recording_auto_stop`
Expected: PASS (implementation already handles this)

- [ ] **Step 3: Run full test suite to confirm no regressions**

Run: `cd syncslide-websocket && cargo test`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "test: add auto-stop on last presenter disconnect test"
```

---

## Task 7: Modify `ws_handle` — connect-time state, recording dispatch, snapshot capture, auto-stop

**Files:**
- Modify: `syncslide-websocket/src/main.rs` — `ws_handle` function

Replace the entire `ws_handle` function. Current version (lines 239–272):

```rust
async fn ws_handle(mut socket: WebSocket, pid: String, mut state: AppState, role: AccessResult) {
    let pres = add_client_handler_channel(pid.clone(), &mut state).await;
    let (mut tx, mut rx, text, slide) = {
        let p = pres.lock().unwrap();
        let text = serde_json::to_string(&SlideMessage::Text(p.content.clone())).unwrap();
        let slide = serde_json::to_string(&SlideMessage::Slide(p.slide)).unwrap();
        let (tx, rx) = (p.channel.0.clone(), p.channel.0.subscribe());
        (tx, rx, text, slide)
    };
    socket.send(Message::from(text)).await.unwrap();
    socket.send(Message::from(slide)).await.unwrap();

    let mut state1 = state.clone();
    let (mut sock_send, mut sock_recv) = socket.split();
    let socket_handler = async {
        while let Some(msg) = sock_recv.next().await {
            if handle_socket(msg, &pid, &mut tx, &mut state1, &role).is_err() {
                return;
            }
        }
    };
    let channel_handler = async {
        while let Ok(msg) = rx.recv().await {
            let text = serde_json::to_string(&msg).unwrap();
            sock_send.send(Message::from(text)).await.unwrap();
            let id = pid.parse().unwrap();
            if let SlideMessage::Text(text) = msg {
                let _ = DbPresentation::update_content(id, text, &state.db_pool).await;
            }
        }
    };
    let () = or(socket_handler, channel_handler).await;
    drop(pres);
}
```

- [ ] **Step 1: Write the replacement `ws_handle`**

Replace with:

```rust
async fn ws_handle(mut socket: WebSocket, pid: String, mut state: AppState, role: AccessResult) {
    let pres = add_client_handler_channel(pid.clone(), &mut state).await;
    let is_presenter = matches!(role, AccessResult::Owner | AccessResult::Editor | AccessResult::Controller);

    // Increment presenter_count for authorized roles
    if is_presenter {
        pres.lock().unwrap().presenter_count += 1;
    }

    let (mut tx, mut rx, text, slide, recording_msg) = {
        let p = pres.lock().unwrap();
        let text = serde_json::to_string(&SlideMessage::Text(p.content.clone())).unwrap();
        let slide = serde_json::to_string(&SlideMessage::Slide(p.slide)).unwrap();
        let (tx, rx) = (p.channel.0.clone(), p.channel.0.subscribe());
        // Build connect-time recording state message if recording is active
        let recording_msg = p.recording.as_ref().map(|rec| {
            let elapsed_ms = (std::time::Instant::now() - rec.started_at).as_millis() as u64 + rec.active_ms;
            if rec.is_paused {
                serde_json::to_string(&SlideMessage::RecordingPause { elapsed_ms }).unwrap()
            } else {
                serde_json::to_string(&SlideMessage::RecordingStart { elapsed_ms }).unwrap()
            }
        });
        (tx, rx, text, slide, recording_msg)
    };

    socket.send(Message::from(text)).await.unwrap();
    socket.send(Message::from(slide)).await.unwrap();
    if let Some(rec_msg) = recording_msg {
        let _ = socket.send(Message::from(rec_msg)).await;
    }

    let mut state1 = state.clone();
    let pid_i64 = pid.parse::<i64>().unwrap_or(-1);
    let pres1 = Arc::clone(&pres);
    let (mut sock_send, mut sock_recv) = socket.split();

    let socket_handler = async {
        while let Some(msg) = sock_recv.next().await {
            // Pre-extract text for recording dispatch and snapshot capture
            let text_val: Option<String> = msg
                .as_ref()
                .ok()
                .and_then(|m| m.to_text().ok())
                .map(String::from);

            let is_recording_msg = text_val
                .as_deref()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(t).ok())
                .and_then(|v| v["type"].as_str().map(|s| s.starts_with("recording_")))
                .unwrap_or(false);

            if is_recording_msg {
                if is_presenter {
                    if let Some(text) = &text_val {
                        if let Ok(rec_msg) = serde_json::from_str::<RecordingMessage>(text) {
                            if let Some(broadcast_msg) = handle_recording_message(
                                rec_msg, &pres1, pid_i64, &state1.db_pool,
                            ).await {
                                let _ = tx.send(broadcast_msg);
                            }
                        }
                    }
                }
                continue;
            }

            // Pre-parse slide index for snapshot capture (before handle_socket consumes msg)
            let slide_n: Option<u32> = text_val
                .as_deref()
                .and_then(|t| serde_json::from_str::<SlideMessage>(t).ok())
                .and_then(|m| if let SlideMessage::Slide(n) = m { Some(n) } else { None });

            if handle_socket(msg, &pid, &mut tx, &mut state1, &role).is_err() {
                return;
            }

            // Capture slide snapshot for active recording
            if let Some(n) = slide_n {
                if is_presenter {
                    let mut slides_map = state1.slides.lock().unwrap();
                    if let Some(p) = slides_map.get_mut(&pid) {
                        let mut p = p.lock().unwrap();
                        if let Some(ref mut rec) = p.recording {
                            if !rec.is_paused {
                                let offset_ms = (std::time::Instant::now() - rec.started_at)
                                    .as_millis() as u64 + rec.active_ms;
                                rec.slides.push(RecordingEvent { offset_ms, slide: n });
                            }
                        }
                    }
                }
            }
        }
    };

    let channel_handler = async {
        while let Ok(msg) = rx.recv().await {
            let text = serde_json::to_string(&msg).unwrap();
            sock_send.send(Message::from(text)).await.unwrap();
            let id = pid.parse().unwrap();
            if let SlideMessage::Text(text) = msg {
                let _ = DbPresentation::update_content(id, text, &state.db_pool).await;
            }
        }
    };

    let () = or(socket_handler, channel_handler).await;

    // Auto-stop recording if this was the last presenter
    if is_presenter {
        let should_stop = {
            let mut p = pres.lock().unwrap();
            p.presenter_count = p.presenter_count.saturating_sub(1);
            p.presenter_count == 0 && p.recording.is_some()
        };
        if should_stop {
            handle_recording_message(
                RecordingMessage::RecordingStop, &pres, pid_i64, &state.db_pool,
            ).await;
            // No broadcast: no clients remain
        }
    }

    drop(pres);
}
```

- [ ] **Step 2: Build**

Run on VPS: `cd syncslide-websocket && cargo build`
Expected: compiles cleanly. Fix any type errors.

- [ ] **Step 3: Run full test suite**

Run: `cd syncslide-websocket && cargo test`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "feat: wire recording dispatch, snapshot capture, auto-stop into ws_handle"
```

---

## Task 8: Update `stage.html` and rewrite `recording.js`

**Files:**
- Modify: `syncslide-websocket/templates/stage.html`
- Modify: `syncslide-websocket/js/recording.js`

- [ ] **Step 1: Update `stage.html`**

Replace the entire `{% block stage %}` block. Current content:

```html
{% block stage %}
<h1 id="stage-heading" tabindex="-1">{{ pres.name }}</h1>
<button type="button" id="qrToggle" aria-pressed="false" aria-controls="qrOverlay">QR</button>
<aside id="qrOverlay" hidden aria-label="QR code">
<a href="/{{ pres_user.name }}/{{ pres.id }}"><img src="/qr/{{ pres_user.name }}/{{ pres.id }}" alt="{{ pres.name }} QR code" width="150" height="150"></a>
</aside>
<details>
<summary><h2 id="record">Record</h2></summary>
<section aria-labelledby="record">
<button id="recordPause">Record</button>
<button id="stop">Stop</button>
<p id="timer">00:00:00</p>
</section>
</details>
{% include "_slide_nav.html" %}
<dialog id="saveRecordingDialog" aria-labelledby="save-recording-heading">
<h1 id="save-recording-heading">Save Recording</h1>
<form id="saveRecordingForm" method="post" action="/user/presentations/{{ pres.id }}/recordings" enctype="multipart/form-data">
<input type="hidden" name="slides" id="slidesData">
<label>Name: <input type="text" name="name" required></label>
<label>Video (optional): <input type="file" name="video" accept="video/*"></label>
<label>Captions VTT (optional): <input type="file" name="captions" accept=".vtt,text/vtt"></label>
<button type="submit">Save</button>
<button type="button" id="cancelSaveRecording">Cancel</button>
</form>
</dialog>
<script>document.getElementById('stage-heading').focus();</script>
{% endblock stage %}
```

Replace with:

```html
{% block stage %}
<h1 id="stage-heading" tabindex="-1">{{ pres.name }}</h1>
<button type="button" id="qrToggle" aria-pressed="false" aria-controls="qrOverlay">QR</button>
<aside id="qrOverlay" hidden aria-label="QR code">
<a href="/{{ pres_user.name }}/{{ pres.id }}"><img src="/qr/{{ pres_user.name }}/{{ pres.id }}" alt="{{ pres.name }} QR code" width="150" height="150"></a>
</aside>
<details>
<summary><h2 id="record-heading">Record</h2></summary>
<section aria-labelledby="record-heading">
<p>Status: <span id="rec-status" aria-live="polite">Stopped</span></p>
<p>Timer: <span id="rec-timer">00:00:00</span></p>
<button type="button" id="recordStart">Record</button>
<button type="button" id="recordPause" hidden>Pause</button>
<button type="button" id="recordResume" hidden>Resume</button>
<button type="button" id="recordStop" hidden>Stop</button>
</section>
</details>
{% include "_slide_nav.html" %}
<script>document.getElementById('stage-heading').focus();</script>
{% endblock stage %}
```

- [ ] **Step 2: Update `stage.html` JS block to keep `recording.js`**

The `{% block js %}` in stage.html currently loads `recording.js` via the parent `audience.html`. Check `audience.html` — if `recording.js` is loaded there, it will still be loaded. If it is only loaded in `stage.html`, ensure it stays. The `{% block js %}` in `stage.html` currently is:

```
{% block js %}<script>window.presPageMode = 'stage';</script>{{ super() }}<script defer="defer" src="/js/slide-nav.js"></script>{% endblock js %}
```

The `{{ super() }}` loads the audience JS block. The `recording.js` script tag is loaded by `audience.html`'s `{% block js %}`. It should continue to load for stage. No change needed here — `recording.js` is already loaded via `audience.html`.

- [ ] **Step 3: Rewrite `recording.js`**

Replace the entire contents of `syncslide-websocket/js/recording.js` with:

```javascript
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

  // Handle incoming WS messages
  window.handleRecordingMessage = function (type, data) {
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

- [ ] **Step 4: Hook `handleRecordingMessage` into the WebSocket message handler in `audience.js`**

The `socket.onmessage` handler is `handleUpdate` in `audience.js` (not `common.js`). Find `handleUpdate` and add a recording dispatch branch **before** any fallthrough to slide rendering, so recording messages don't accidentally trigger slide updates:

```javascript
if (message.type && message.type.startsWith('recording_')) {
    if (typeof handleRecordingMessage === 'function') {
        handleRecordingMessage(message.type, message.data || {});
    }
    return;
}
```

The `return` is required — without it the message would fall through to the slide-rendering path.

- [ ] **Step 5: Remove `saveCurrentState` from any callers**

Search for `saveCurrentState` in all JS files, including `audience.js`:

```bash
grep -r "saveCurrentState" syncslide-websocket/js/
```

Remove every call site found. The function no longer exists in the new `recording.js`.

- [ ] **Step 6: Deploy and manual smoke test**

Push and deploy:
```bash
git add syncslide-websocket/templates/stage.html syncslide-websocket/js/recording.js syncslide-websocket/js/common.js
git commit -m "feat: replace client-side recording with WS-driven recording UI"
```
Then: `bash config/deploy.bat`

Open the stage page in a browser. Verify:
- "Record" button is visible; "Pause", "Resume", "Stop" are hidden
- Clicking Record changes status to "Recording", shows Pause + Stop
- Clicking Pause shows "Paused", timer freezes
- Clicking Resume shows "Recording" again, timer resumes
- Clicking Stop resets everything

---

## Task 9: Playwright tests

**Files:**
- Modify: `tests/websocket.spec.js`

- [ ] **Step 1: Write the failing Playwright tests**

Add to `tests/websocket.spec.js`:

```javascript
test.describe('server-side recording sync', () => {
  test.beforeEach(async ({ browser }) => {
    // Seed: create testuser and a presentation via login + create form
  });

  test('starting a recording syncs to a second stage context', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    // Log both in as testuser (or co-presenter), navigate to same stage URL
    await loginAs(page1, 'testuser', 'testpass');
    await loginAs(page2, 'testuser', 'testpass');

    const stageUrl = await createPresentationAndGetStageUrl(page1);
    await page1.goto(stageUrl);
    await page2.goto(stageUrl);

    // Click Record on page1
    await page1.click('#recordStart');

    // page2 should show "Recording"
    await expect(page2.locator('#rec-status')).toHaveText('Recording', { timeout: 3000 });
    await expect(page2.locator('#recordPause')).toBeVisible();
    await expect(page2.locator('#recordStop')).toBeVisible();
  });

  test('pausing syncs to second context', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    await loginAs(page1, 'testuser', 'testpass');
    await loginAs(page2, 'testuser', 'testpass');
    const stageUrl = await createPresentationAndGetStageUrl(page1);
    await page1.goto(stageUrl);
    await page2.goto(stageUrl);

    await page1.click('#recordStart');
    await expect(page2.locator('#rec-status')).toHaveText('Recording', { timeout: 3000 });

    await page1.click('#recordPause');
    await expect(page2.locator('#rec-status')).toHaveText('Paused', { timeout: 3000 });
    await expect(page2.locator('#recordResume')).toBeVisible();
  });

  test('stopping syncs to second context', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    await loginAs(page1, 'testuser', 'testpass');
    await loginAs(page2, 'testuser', 'testpass');
    const stageUrl = await createPresentationAndGetStageUrl(page1);
    await page1.goto(stageUrl);
    await page2.goto(stageUrl);

    await page1.click('#recordStart');
    await expect(page2.locator('#rec-status')).toHaveText('Recording', { timeout: 3000 });

    await page1.click('#recordStop');
    await expect(page2.locator('#rec-status')).toHaveText('Stopped', { timeout: 3000 });
    await expect(page2.locator('#recordStart')).toBeVisible();
  });
});
```

Look at the existing test helpers (`loginAs`, presentation setup) in `websocket.spec.js` and use the same patterns. Add a `createPresentationAndGetStageUrl` helper that POSTs to `/create`, follows the redirect to the edit page, then constructs the stage URL from the PID.

- [ ] **Step 2: Run Playwright tests**

Run on VPS: `npx playwright test --config tests/playwright.config.js`
Expected: new tests PASS along with existing tests

- [ ] **Step 3: Commit**

```bash
git add tests/websocket.spec.js
git commit -m "test: add Playwright tests for server-side recording sync"
```

---

## Task 10: Final deploy

- [ ] **Step 1: Push all commits**

```bash
git push
```

- [ ] **Step 2: Deploy to production**

```bash
bash config/deploy.bat
```

Expected output: `Finished \`release\` profile` and service restart with no errors.

- [ ] **Step 3: Verify full test count**

After deploy, check that all Rust and Playwright tests pass at the counts from before this feature (59 Rust + 111 Playwright, plus new tests added here).
