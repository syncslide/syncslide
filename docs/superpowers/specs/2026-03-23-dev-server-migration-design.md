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
git pull origin main --rebase
cd syncslide-websocket && cargo build
sudo cp ../config/syncSlide.conf /etc/caddy/conf.d
sudo chown root:root /etc/caddy/conf.d/syncSlide.conf
sudo systemctl reload caddy
sudo systemctl restart syncSlide
```
Deploy only — no tests. Assumes code was already validated by dev.bat.

## Provisioning Script

`config/provision.sh` is run once on a fresh beep.local via:
```
ssh melody@beep.local 'bash -s' < config/provision.sh
```

Install order:
1. **Rust** — via `rustup` (stable toolchain)
2. **Node.js** — via `nvm` (LTS version)
3. **Playwright browser dependencies** — system packages + `npm install` in `tests/`
4. **sqlx-cli** — `cargo install sqlx-cli --no-default-features --features sqlite`
5. **Claude Code** — `npm install -g @anthropic-ai/claude-code`
6. **Clone repo** — `git clone <remote> ~/syncSlide/`

`ANTHROPIC_API_KEY` is set manually in `~/.bashrc` on beep.local after provisioning. No secrets in the script.

## Claude Code Migration

The project `CLAUDE.md` is in the repo and requires no extra steps.

Global Claude config (`~/.claude/`) is copied from Windows to beep.local:

1. `~/.claude/CLAUDE.md` — global instructions, copied via `scp`
2. Memory files — copied from the Windows project memory directory and placed under `~/.claude/projects/home-melody-syncSlide/memory/` to match the new project path on beep.local
3. `~/.claude/settings.local.json` — permissions and hooks, copied as-is

After provisioning, SSH into beep.local, `cd ~/syncSlide`, run `claude`.

## CLAUDE.md Updates

The commands section is updated:
- Replace `config/update.bat` references with `config/dev.bat` (build/test) and `config/deploy.bat` (deploy)
- `cargo sqlx prepare` now runs on beep.local
- "Never run the server locally" becomes "always use dev.bat to build and test on beep.local"

## Out of Scope

- Cross-compilation or binary transfer between beep.local and clippycat.ca — each server builds from source independently
- CI/CD automation — scripts remain manual
- Any changes to the application code or tests
