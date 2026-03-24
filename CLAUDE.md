# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build
cd syncslide-websocket && cargo build

# Run Rust tests
cd syncslide-websocket && cargo test

# Run Playwright tests
cd tests && npx playwright test --config playwright.config.js

# Deploy to production (clippycat.ca)
ssh arch@clippycat.ca "set -eo pipefail; cd syncSlide && git pull origin main --rebase && cd syncslide-websocket && cargo build --release && sudo cp ../config/syncSlide.conf /etc/caddy/conf.d && sudo chown root:root /etc/caddy/conf.d/syncSlide.conf && sudo systemctl reload caddy && sudo systemctl restart syncSlide"

# Send SIGUSR1 to trigger in-memory presentation cleanup
config/cleanup.sh

# After changing SQL queries, regenerate the offline query cache
# Run from syncslide-websocket/:
cd syncslide-websocket && DATABASE_URL=sqlite://db.sqlite3 cargo sqlx prepare -- --all-targets
```

## Architecture

SyncSlide is a single Rust binary (`syncslide-websocket/`) that serves an accessible Markdown-based presentation tool with real-time WebSocket sync. It runs on port 5002 behind Caddy (`config/syncSlide.conf`).

**Backend:** Axum + Tera templates + SQLx (SQLite) + tower-sessions. All routes and state are in `syncslide-websocket/src/main.rs`; DB models and auth backend are in `src/db.rs`.

**In-memory state** (`AppState`): A `HashMap<presentation_id, Arc<Mutex<Presentation>>>` holds active presentations. Each `Presentation` has its markdown content, current slide index, and a `tokio::broadcast` channel (capacity 1024) used to push updates to all connected WebSocket clients.

**Presentation flow:**
1. Presenter navigates to `/{uname}/{pid}` → redirected to `stage.html` (editor + slide dropdown)
2. Audience navigates to the same URL → redirected to `audience.html` (read-only slide view)
3. Both connect to `/ws/{pid}`. On connect, clients receive current `Text` and `Slide` messages.
4. Presenter sends updates → saved to DB via `DbPresentation::update_content()` → broadcast to all subscribers.

**Slide parsing:** The frontend (`js/common.js`) splits rendered Markdown HTML at `<h2>` tags to produce individual slides. Each `## Heading` is one slide. LaTeX is rendered client-side via KaTeX.

**Recording:** Server-side. Recording state (`RecordingState`) lives in the in-memory `Presentation`. Control messages (`recording_start/pause/resume/stop`) are dispatched in `ws_handle` and handled by `handle_recording_message` in `main.rs`. On stop, slide events are resolved to title/HTML via `render_all_slides` and saved as `recording_slide` rows. `js/recording.js` is a WS-driven client that syncs recording UI across all connected presenters. `js/play.js` replays recordings using VTT cues on video `cuechange` events.

**Auth:** Argon2id passwords, tower-sessions backed by SQLite. Users belong to groups; `group_id=1` is admin. WebSocket connections check auth at connect time — unauthenticated clients can receive slides but cannot send updates.

**SQLx offline cache:** `.sqlx/` is committed to the repo so `cargo build` works without a live database. Run `cargo sqlx prepare -- --all-targets` from `syncslide-websocket/` after any SQL query changes (plain `cargo sqlx prepare` deletes test-only cache entries).

## Deployment

- **Server:** `arch@clippycat.ca`, systemd service `syncSlide`
- **Working directory on server:** `/home/arch/syncSlide/syncslide-websocket/` — the binary must run from here so relative paths `css/`, `js/`, `assets/` resolve correctly.
- **Database:** `db.sqlite3` in `syncslide-websocket/` (relative to working directory)
- **Default credentials:** username `admin`, password `admin`
- **Dev machine:** this machine (`/home/melody/syncSlide/`) — build and test here directly

## Key files

| File | Purpose |
|------|---------|
| `syncslide-websocket/src/main.rs` | All routes, handlers, WebSocket logic, app state |
| `syncslide-websocket/src/db.rs` | SQLx models, axum-login auth backend, password hashing |
| `syncslide-websocket/templates/` | Tera HTML templates |
| `syncslide-websocket/js/common.js` | WebSocket setup, Markdown→slides parsing, KaTeX render |
| `syncslide-websocket/js/handlers.js` | Presenter event handlers (markdown textarea, slide dropdown) |
| `syncslide-websocket/js/recording.js` | WS-driven recording UI (start/pause/resume/stop sync) |
| `syncslide-websocket/js/play.js` | Video+VTT playback sync |
| `syncslide-websocket/migrations/` | SQLite schema migrations (run automatically on startup) |
| `config/syncSlide.conf` | Caddy reverse proxy config |

## User constraints
- Do not rewrite git history.
- Build and test on this machine directly (not via SSH). Run `cargo build`, `cargo test`, and Playwright tests here.
- To deploy to production, SSH to `arch@clippycat.ca` — see the deploy command above. `config/deploy.bat` is a Windows remnant; use the SSH command directly.
