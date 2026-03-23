# Dev Server Migration Design

**Date:** 2026-03-23
**Status:** Approved

## Overview

Migrate the build/test workflow from clippycat.ca to a dedicated local dev server at `melody@beep.local`. Production hosting remains on `arch@clippycat.ca`. Claude Code is installed on beep.local so it can be used natively over SSH.

## Roles

| Host | Role |
|------|------|
| `melody@beep.local` | Build, test, iterate. All dev work happens here. |
| `arch@clippycat.ca` | Production only. Deploy target, serves live traffic. |

## Script Architecture

The existing `config/update.bat` is deleted and replaced by two scripts:

### `config/dev.bat`
SSHes to `melody@beep.local`. Runs:
```
set -eo pipefail
cd syncSlide
git pull origin main --rebase
cd syncslide-websocket
cargo build
cargo test
bash ../config/test.sh
```
Used during iteration. Never touches clippycat.ca.

### `config/deploy.bat`
SSHes to `arch@clippycat.ca`. Runs:
```
set -eo pipefail
cd syncSlide
git pull origin main --rebase
cd syncslide-websocket && cargo build
sudo cp ../config/syncSlide.conf /etc/caddy/conf.d
sudo chown root:root /etc/caddy/conf.d/syncSlide.conf
sudo systemctl reload caddy
sudo systemctl restart syncSlide
```
Deploy only — `cargo test` and Playwright tests are intentionally omitted. Running dev.bat first is the required gate; deploy.bat assumes the code has already been validated. `set -eo pipefail` ensures a failed `cargo build` aborts before the service is restarted.

Note: `../config/syncSlide.conf` resolves correctly from inside `syncslide-websocket/` on clippycat.ca.

## Provisioning Script

`config/provision.sh` is run once on a fresh beep.local via:
```
ssh melody@beep.local 'bash -s' < config/provision.sh
```

Install order (dependencies respected):
1. **Rust** — via `rustup` (stable toolchain)
2. **Node.js** — via `nvm`. The nvm installer appends a source line to `~/.bashrc`, but since `bash -s` is a non-interactive shell, `.bashrc` is not sourced automatically. The provision script must explicitly `source ~/.nvm/nvm.sh` immediately after running the nvm installer (within the same script execution), before calling `nvm install`. Use `nvm install --lts` to install the current LTS release; pin to a specific version (e.g. `nvm install 22`) if reproducibility across future reprovisionings is required. The Playwright version in `tests/package.json` (`^1.50.0`) sets the effective Node minimum.
3. **Clone repo** — `git clone <remote> ~/syncSlide/` — must come before any repo-relative steps
4. **sqlx-cli** — `cargo install sqlx-cli --no-default-features --features sqlite`
5. **npm install in tests/** — `cd ~/syncSlide/tests && npm install`
6. **Playwright browser binaries** — `npx playwright install --with-deps chromium` — installs the actual browser binary; `npm install` alone is not sufficient
7. **Claude Code** — `npm install -g @anthropic-ai/claude-code`

`ANTHROPIC_API_KEY` is set manually in `~/.bashrc` on beep.local after provisioning. No secrets in the script.

## Claude Code Migration

The project `CLAUDE.md` is in the repo and requires no extra steps.

Global Claude config (`~/.claude/`) is copied from Windows to beep.local:

1. `~/.claude/CLAUDE.md` — global instructions, copied via `scp`
2. Memory files — copied from the Windows project memory directory and placed under `~/.claude/projects/home-melody-syncSlide/memory/` to match the new project path (`/home/melody/syncSlide/`) on beep.local
3. `~/.claude/settings.local.json` — permissions and hooks, copied as-is

After first `claude` invocation on beep.local, verify the actual project slug Claude chose (it derives it from the working directory absolute path). If it differs from `home-melody-syncSlide`, move the memory directory to match.

After provisioning, SSH into beep.local, `cd ~/syncSlide`, run `claude`.

## CLAUDE.md Updates

The commands section is updated:

- Remove the `cargo run` line (previously described running the server locally on port 5002; on beep.local the server is started by `test.sh` for testing only, never run manually)
- Replace `config/update.bat` with:
  - `config/dev.bat` — build and test on beep.local
  - `config/deploy.bat` — deploy to clippycat.ca production
- Update `cargo sqlx prepare` to the correct full form: `cargo sqlx prepare -- --all-targets` (plain `cargo sqlx prepare` deletes test-only cache entries). This command runs on beep.local with `DATABASE_URL=sqlite://db.sqlite3` pointing to an existing DB file; a persistent dev DB must exist before running it (created automatically when the app starts once).

## Out of Scope

- Cross-compilation or binary transfer between beep.local and clippycat.ca — each server builds from source independently
- CI/CD automation — scripts remain manual
- Any changes to the application code or tests
