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

```bash
cd syncslide-websocket && cargo build
cd syncslide-websocket && cargo run
```

The binary must run from `syncslide-websocket/` so relative paths (`css/`, `js/`, `assets/`) resolve correctly.

### Running tests

```bash
# Rust unit + integration tests only
cd syncslide-websocket && cargo test

# Playwright end-to-end tests only (starts the server automatically)
cd tests && npx playwright test --config playwright.config.js
```

### After SQL changes

After changing any SQL query in `src/main.rs` or `src/db.rs`, regenerate the offline query cache:

```bash
cd syncslide-websocket
DATABASE_URL=sqlite://db.sqlite3 cargo sqlx prepare -- --all-targets
```

Commit the updated `.sqlx/` files alongside your query changes.

### Making a PR

- Branch from `main`
- CI runs the full test suite automatically on every PR — the PR cannot merge until it passes

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
