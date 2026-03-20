# Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/help` presenter guide page, a `CONTRIBUTING.md` for contributors and self-hosters, and surface the help link in the nav and homepage.

**Architecture:** Pure content changes — one new Rust handler (mirrors the `join` handler pattern, empty Tera context), one new Tera template, edits to `nav.html` and `index.html`, and two Markdown files at the repo root / config. No new dependencies, no database changes.

**Tech Stack:** Rust/Axum (route + handler), Tera (template), Playwright (tests)

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `tests/help.spec.js` | Create | Playwright tests for /help, nav link, homepage link |
| `CONTRIBUTING.md` | Create | Contributor + self-hoster reference |
| `readme.md` | Modify | Replace content with one-line pointer to CONTRIBUTING.md |
| `config/readme.md` | Modify | Replace content with one-line pointer to CONTRIBUTING.md |
| `syncslide-websocket/templates/help.html` | Create | Static presenter guide page |
| `syncslide-websocket/src/main.rs` | Modify | Add `help` handler + `.route("/help", get(help))` |
| `syncslide-websocket/templates/nav.html` | Modify | Add Help link before auth block |
| `syncslide-websocket/templates/index.html` | Modify | Add presenter guide link in main content |

---

## Task 1: Playwright tests

**Files:**
- Create: `tests/help.spec.js`

These tests will fail until the `/help` route exists. Write them first so the failure is confirmed before implementing.

- [ ] **Step 1: Create `tests/help.spec.js`**

```js
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers.js";

test("/help page has correct heading", async ({ page }) => {
  await page.goto("/help");
  await expect(page.getByRole("heading", { level: 1, name: "Presenter Guide" })).toBeVisible();
});

test("nav contains Help link visible to logged-out users", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Help" })).toBeVisible();
});

test("nav contains Help link visible to logged-in users", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Help" })).toBeVisible();
});

test("homepage has presenter guide link", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "presenter guide" })).toBeVisible();
});
```

- [ ] **Step 2: Commit tests**

```bash
git add tests/help.spec.js
git commit -m "test: add Playwright tests for /help page, nav link, homepage link"
```

---

## Task 2: CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`
- Modify: `readme.md`
- Modify: `config/readme.md`

- [ ] **Step 1: Create `CONTRIBUTING.md` at repo root**

```markdown
# Contributing to SyncSlide

SyncSlide is a single Rust binary serving an accessible Markdown-based presentation tool with real-time WebSocket sync. Live instance: [clippycat.ca](https://clippycat.ca). Source: [github.com/ClippyCat/syncslide](https://github.com/ClippyCat/syncslide/).

---

## For Code Contributors

### Prerequisites

- Rust stable toolchain
- `sqlx-cli` — needed only if you change SQL queries (`cargo install sqlx-cli`)

### Dev setup

Clone the repo. Migrations run automatically on startup. `.sqlx/` is committed so `cargo build` works without a live database.

### Building and running

Builds and test runs happen on the VPS (`arch@clippycat.ca`). The binary must run from `syncslide-websocket/` so relative paths (`css/`, `js/`, `assets/`) resolve correctly. Deploy via:

```bat
config/update.bat
```

This pulls, builds, reloads Caddy, and restarts the service.

### Running tests

```bash
# Rust unit + integration tests only
cargo test

# Full suite (Rust + Playwright)
config/test.sh
```

Tests run on the VPS. The deploy pipeline runs the full suite and blocks on failure.

### After SQL changes

After changing any SQL query in `src/main.rs` or `src/db.rs`, regenerate the offline query cache:

```bash
cd syncslide-websocket
DATABASE_URL=sqlite://db.sqlite3 cargo sqlx prepare
```

Commit the updated `.sqlx/` files alongside your query changes.

### Making a PR

- Branch from `main`
- All tests must pass before merge
- Do not rewrite history (`git push --force` to `main` is not permitted)

---

## For Self-Hosters

### Prerequisites

- Rust stable toolchain
- Caddy
- A Linux host with systemd

### Deployment

1. Clone the repo to your working directory (e.g. `/home/arch/syncSlide/`)
2. `cd syncslide-websocket && cargo build`
3. The binary must run from `syncslide-websocket/` — set `WorkingDirectory` in your systemd unit to this directory
4. Copy `config/syncSlide.conf` to `/etc/caddy/conf.d/`, then `sudo systemctl reload caddy`
5. Start the systemd service: `sudo systemctl start syncSlide`

### Configuration

Set these environment variables (or accept the defaults):

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_PORT` | `5002` | Port the binary listens on |
| `APP_DB` | `sqlite://db.sqlite3` | SQLite path, relative to working directory |

### Admin setup

Migrations seed an `admin`/`admin` account on first run. Change this password immediately at `/user/change_pwd`. New users are created at `/user/new` (admin only).

### Updating

```bash
git pull
cd syncslide-websocket && cargo build
sudo systemctl restart syncSlide
```
```

- [ ] **Step 2: Update `readme.md`**

Replace the entire content with:

```markdown
See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, deployment, and contributing instructions.
```

- [ ] **Step 3: Update `config/readme.md`**

Replace the entire content with:

```markdown
See [CONTRIBUTING.md](../CONTRIBUTING.md) for setup, deployment, and contributing instructions.
```

- [ ] **Step 4: Commit**

```bash
git add CONTRIBUTING.md readme.md config/readme.md
git commit -m "docs: add CONTRIBUTING.md; replace readme stubs with pointers"
```

---

## Task 3: `/help` route and template

**Files:**
- Create: `syncslide-websocket/templates/help.html`
- Modify: `syncslide-websocket/src/main.rs`

The `help` handler follows the same pattern as `join` (line 265): `State(tera)`, `AuthSession`, `State(db)`, renders template with empty context.

- [ ] **Step 1: Create `syncslide-websocket/templates/help.html`**

```html
{% extends "nav.html" %}
{% block title %}Help{% endblock title %}

{% block breadcrumb %}<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">Help</li></ol></nav>{% endblock breadcrumb %}
{% block content %}
<main>
<h1>Presenter Guide</h1>

<h2>Getting Started</h2>
<ul>
<li>Create a presentation at <a href="/create">/create</a> and give it a name.</li>
<li>You land on the stage — your editing and presenting view.</li>
<li>Share the URL with your audience. They visit the same URL and see the read-only audience view.</li>
<li>Navigate slides with the <strong>Go to slide</strong> dropdown.</li>
</ul>

<h2>Editing Slides</h2>
<ul>
<li>Write Markdown in the textarea inside the <strong>Edit Slides</strong> section.</li>
<li>Each <code>## heading</code> starts a new slide. The presentation title is an <code>h1</code> at the top.</li>
<li>Use the slide table inside the <strong>Slides</strong> section to add, edit, move, or delete slides.</li>
<li>Rename the presentation via the <strong>Presentation name</strong> field.</li>
</ul>

<h2>Keyboard Shortcuts</h2>
<ul>
<li><kbd>F8</kbd>: advance to next slide</li>
<li><kbd>Shift+F8</kbd>: go back to previous slide</li>
</ul>

<h2>Recording</h2>
<ul>
<li>Open the <strong>Record</strong> section on the stage.</li>
<li>Press <strong>Record</strong> to start the timer; <strong>Pause</strong> to pause; <strong>Stop</strong> to end the session.</li>
<li>A save dialog opens: give the recording a name; optionally attach a video file and a captions VTT file.</li>
</ul>

<h2>For Your Audience</h2>
<ul>
<li>Audience members visit the same URL as the stage.</li>
<li>They see a read-only view and cannot edit or change slides.</li>
<li>The current slide updates live as you navigate — no refresh needed.</li>
<li>The slide area is an <code>aria-live="polite"</code> region; screen readers announce each new slide automatically.</li>
</ul>
</main>
{% endblock content %}
```

- [ ] **Step 2: Add `help` handler to `main.rs`**

After the `index` handler (around line 613), add:

```rust
async fn help(
    State(tera): State<Tera>,
    auth_session: AuthSession,
    State(db): State<SqlitePool>,
) -> impl IntoResponse {
    tera.render("help.html", Context::new(), auth_session, db)
        .await
}
```

- [ ] **Step 3: Register the route in `main.rs`**

In the router block (around line 1090), add after the `/demo` route:

```rust
.route("/help", get(help))
```

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/templates/help.html syncslide-websocket/src/main.rs
git commit -m "feat: add /help presenter guide page"
```

---

## Task 4: Nav and homepage updates

**Files:**
- Modify: `syncslide-websocket/templates/nav.html`
- Modify: `syncslide-websocket/templates/index.html`

- [ ] **Step 1: Add Help link to `nav.html`**

The Help link must be visible to all users regardless of auth state, and appear before auth links (Login/Logout) in reading order. Place it before the `{% if user %}` block — after Home and before the auth conditional. Reading order becomes: Home → Help → [Create / Presentations / Logout, or Login] → Join.

Current (lines 5–6 in `nav.html`):
```html
<li><a href="/">Home</a></li>
{% if user %}
```

Replace with:
```html
<li><a href="/">Home</a></li>
<li><a href="/help">Help</a></li>
{% if user %}
```

- [ ] **Step 2: Add presenter guide link to `index.html`**

The link goes in the `<main>` block, after the opening `<h1>` and before the `<details>` About section, visible to logged-out visitors.

Current (lines 7–9):
```html
<h1 id="syncSlide">SyncSlide</h1>
<p>Even with the most accessible Powerpoint slides provided in advance...
```

After the `<h1>`, add a new paragraph before the existing `<p>`:
```html
<p>New to SyncSlide? Read the <a href="/help">presenter guide</a>.</p>
```

So it becomes:
```html
<h1 id="syncSlide">SyncSlide</h1>
<p>New to SyncSlide? Read the <a href="/help">presenter guide</a>.</p>
<p>Even with the most accessible Powerpoint slides...
```

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/templates/nav.html syncslide-websocket/templates/index.html
git commit -m "feat: add Help link to nav and presenter guide link to homepage"
```

---

## Task 5: Deploy and verify

- [ ] **Step 1: Deploy**

```bat
config/update.bat
```

- [ ] **Step 2: Run full test suite on VPS**

```bash
config/test.sh
```

Expected: all tests pass, including the 4 new Playwright tests in `tests/help.spec.js`.

- [ ] **Step 3: Manually verify on live site**

- Navigate to `/help` — confirm `h1` is "Presenter Guide", all five `h2` sections present
- Tab through the page — confirm no interactive elements, reading order is heading → list
- Check nav on `/` (logged out) — confirm Help link is present between Home and Login
- Log in, check nav — confirm Help link is present between Home and Create presentation
- Check homepage `/` — confirm "presenter guide" link is visible before the About details

---
