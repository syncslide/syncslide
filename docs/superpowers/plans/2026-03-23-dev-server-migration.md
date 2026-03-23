# Dev Server Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate builds and tests to `melody@beep.local`, keep production on `arch@clippycat.ca`, and install Claude Code on beep.local.

**Architecture:** Replace `config/update.bat` with two scripts — `dev.bat` (build + test on beep.local) and `deploy.bat` (deploy to clippycat.ca). A one-time `provision.sh` installs all dependencies on beep.local. Claude Code config is copied from Windows to beep.local after provisioning.

**Tech Stack:** Bash, Windows batch (SSH invocation), Rust/cargo, Node.js/nvm, Playwright, Claude Code CLI

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `config/dev.bat` | SSH to beep.local: pull + build + cargo test + Playwright |
| Create | `config/deploy.bat` | SSH to clippycat.ca: pull + build + restart service |
| Create | `config/provision.sh` | One-time server setup script for beep.local |
| Delete | `config/update.bat` | Superseded by dev.bat + deploy.bat |
| Modify | `CLAUDE.md` | Update commands section to reflect new workflow |

---

### Task 1: Create `config/dev.bat`

**Files:**
- Create: `config/dev.bat`

Note: these scripts contain no testable logic — verification is reading the command and confirming it matches the spec before committing.

- [ ] **Step 1: Write `config/dev.bat`**

Full file contents:

```bat
ssh melody@beep.local "set -eo pipefail; cd syncSlide && git pull origin main --rebase && cd syncslide-websocket && cargo build && cargo test 2>&1 | tee -a /tmp/syncslide-dev.log && bash ../config/test.sh 2>&1 | tee -a /tmp/syncslide-dev.log"
```

- [ ] **Step 2: Verify the command matches the spec**

Confirm: `set -eo pipefail` is present, `cd syncSlide` comes first, `cargo build` before `cargo test`, `test.sh` runs last. No mention of clippycat.ca.

- [ ] **Step 3: Commit**

```bash
git add config/dev.bat
git commit -m "feat: add dev.bat for build and test on beep.local"
```

---

### Task 2: Create `config/deploy.bat`

**Files:**
- Create: `config/deploy.bat`

- [ ] **Step 1: Write `config/deploy.bat`**

Full file contents:

```bat
ssh arch@clippycat.ca "set -eo pipefail; cd syncSlide && git pull origin main --rebase && cd syncslide-websocket && cargo build && sudo cp ../config/syncSlide.conf /etc/caddy/conf.d && sudo chown root:root /etc/caddy/conf.d/syncSlide.conf && sudo systemctl reload caddy && sudo systemctl restart syncSlide"
```

- [ ] **Step 2: Verify the command matches the spec**

Confirm: `set -eo pipefail` is present, `cd syncSlide` comes first, no `cargo test` (intentional — dev.bat is the test gate), Caddy config copy uses `../config/` (correct relative path from inside `syncslide-websocket/`), service is reloaded then restarted.

- [ ] **Step 3: Commit**

```bash
git add config/deploy.bat
git commit -m "feat: add deploy.bat for production deploy to clippycat.ca"
```

---

### Task 3: Delete `config/update.bat`

**Files:**
- Delete: `config/update.bat`

- [ ] **Step 1: Delete `config/update.bat`**

```bash
git rm config/update.bat
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: remove update.bat (superseded by dev.bat + deploy.bat)"
```

---

### Task 4: Create `config/provision.sh`

**Files:**
- Create: `config/provision.sh`

This script is run once on a fresh beep.local:
```bash
ssh melody@beep.local 'bash -s' < config/provision.sh
```

Since `bash -s` is a non-interactive shell, `.bashrc` is not sourced. The script explicitly sources `~/.cargo/env` and `~/.nvm/nvm.sh` within its own execution after each installer runs.

Before running, beep.local must be able to pull from GitHub via SSH. Ensure `~/.ssh/id_ed25519` (or equivalent) exists on beep.local and is added to GitHub as a deploy key or personal SSH key.

Verify the remote URL before running:
```bash
git remote get-url origin
# Expected: git@github.com:syncslide/syncslide
```
If the output differs, update the `git clone` line in provision.sh to match.

- [ ] **Step 1: Write `config/provision.sh`**

Full file contents:

```bash
#!/usr/bin/env bash
set -eo pipefail

# 1. Rust (stable)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# 2. Node.js via nvm
# nvm installer appends source line to ~/.bashrc, but bash -s won't source it.
# We source ~/.nvm/nvm.sh explicitly right after install.
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source "$HOME/.nvm/nvm.sh"
nvm install --lts
# If you need a reproducible Node version across future reprovisionings,
# replace `--lts` with a specific version, e.g. `nvm install 22`.

# 3. Clone repo (must come before any repo-relative steps)
git clone git@github.com:syncslide/syncslide ~/syncSlide

# 4. sqlx-cli (for cargo sqlx prepare after SQL changes)
cargo install sqlx-cli --no-default-features --features sqlite

# 5. Playwright JS dependencies
cd ~/syncSlide/tests && npm install

# 6. Playwright browser binary (npm install alone is not sufficient)
npx playwright install --with-deps chromium

# 7. Claude Code CLI
npm install -g @anthropic-ai/claude-code

echo ""
echo "Provisioning complete."
echo "Next steps:"
echo "  1. Add ANTHROPIC_API_KEY to ~/.bashrc"
echo "  2. Copy Claude config from Windows (see migration plan Task 6)"
```

- [ ] **Step 2: Verify the script order**

Confirm: Rust installed before cargo commands, nvm sourced before `nvm install`, repo cloned before `cd ~/syncSlide/tests`, `npx playwright install` present (not just `npm install`), Claude Code last.

- [ ] **Step 3: Commit**

```bash
git add config/provision.sh
git commit -m "feat: add provision.sh for beep.local server setup"
```

---

### Task 5: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the Commands section**

Find the `## Commands` block and replace it with:

```markdown
## Commands

```bash
# Build and test on dev server (beep.local)
config/dev.bat

# Deploy to production (clippycat.ca)
config/deploy.bat

# Provision a fresh dev server (run once)
# ssh melody@beep.local 'bash -s' < config/provision.sh

# Send SIGUSR1 to trigger in-memory presentation cleanup
config/cleanup.sh

# After changing SQL queries, regenerate the offline query cache
# Run on beep.local from syncslide-websocket/:
cd syncslide-websocket && DATABASE_URL=sqlite://db.sqlite3 cargo sqlx prepare -- --all-targets
```
```

Key changes from previous version:
- Removed `cargo build` (standalone) — build is always via dev.bat
- Removed `cargo run` — server is only started by test.sh during test runs
- Replaced `config/update.bat` with `config/dev.bat` and `config/deploy.bat`
- `cargo sqlx prepare` corrected to `cargo sqlx prepare -- --all-targets` (plain form deletes test-only cache entries)

- [ ] **Step 2: Update the User constraints section**

Replace:
```
- Never run the server locally. Always push changes and deploy on the VPS to test.
```

With:
```
- Never run the server locally. Always use `config/dev.bat` to build and test on beep.local.
- To deploy to production, use `config/deploy.bat` (targets clippycat.ca).
```

- [ ] **Step 3: Update the Deployment section**

Add beep.local as the dev server:

After the existing deployment bullet points, add:
```
- **Dev server:** `melody@beep.local`, repo at `~/syncSlide/`
```

- [ ] **Step 4: Verify CLAUDE.md is consistent**

Confirm: no remaining references to `update.bat`, no `cargo run`, `cargo sqlx prepare` has `-- --all-targets`, user constraints mention beep.local.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for beep.local dev server workflow"
```

---

### Task 6: Copy Claude Code config to beep.local

This task runs after Task 4's `provision.sh` has been executed on beep.local. No files are committed — this is a one-time server setup.

- [ ] **Step 1: Create `~/.claude/` on beep.local**

```bash
ssh melody@beep.local "mkdir -p ~/.claude"
```

- [ ] **Step 2: Copy global CLAUDE.md**

From your Windows machine (run in a terminal from any directory):

```bash
scp "C:/Users/melody/.claude/CLAUDE.md" melody@beep.local:~/.claude/CLAUDE.md
```

- [ ] **Step 3: Copy settings.local.json**

```bash
scp "C:/Users/melody/.claude/settings.local.json" melody@beep.local:~/.claude/settings.local.json
```

- [ ] **Step 4: Add `ANTHROPIC_API_KEY` to `~/.bashrc` on beep.local**

SSH in and edit `~/.bashrc`:

```bash
ssh melody@beep.local
```

Add to `~/.bashrc` (replace `<your-key>` with your actual key):
```bash
export ANTHROPIC_API_KEY=<your-key>
```

Then:
```bash
source ~/.bashrc
exit
```

- [ ] **Step 5: Run `claude` once to initialise the project directory**

SSH into beep.local interactively and start a Claude session from the repo directory, then exit:

```bash
ssh melody@beep.local
cd ~/syncSlide
claude
# Type /exit or Ctrl+C to quit once it loads
exit
```

This causes Claude Code to create `~/.claude/projects/<slug>/` where `<slug>` is derived from `/home/melody/syncSlide`. The expected slug is `home-melody-syncSlide`. (`claude --version` alone does not create the project directory.)

- [ ] **Step 6: Verify the project slug**

```bash
ssh melody@beep.local "ls ~/.claude/projects/"
```

Expected output includes a directory named `home-melody-syncSlide`. If the name differs, use the actual name in the next step.

- [ ] **Step 7: Copy memory files**

From your Windows machine:

```bash
scp -r "C:/Users/melody/.claude/projects/C--Users-melody-Desktop-bs-programming-myRepo-syncslide/memory" melody@beep.local:~/.claude/projects/home-melody-syncSlide/
```

If the slug from Step 6 differs, replace `home-melody-syncSlide` with the actual directory name.

- [ ] **Step 8: Verify memory is accessible**

SSH into beep.local, `cd ~/syncSlide`, and start `claude`. Check that the session prompt shows project context (memory loaded). There is no automated check — confirm it doesn't error and the assistant has project context.

---

### Task 7: Update project memory

**Files:**
- Modify: `C:/Users/melody/.claude/projects/C--Users-melody-Desktop-bs-programming-myRepo-syncslide/memory/project_next_session.md`
- Modify: `C:/Users/melody/.claude/projects/C--Users-melody-Desktop-bs-programming-myRepo-syncslide/memory/MEMORY.md` (if the workflow entry needs updating)

- [ ] **Step 1: Update the workflow memory to reflect beep.local**

Update `project_next_session.md` or the relevant workflow memory file to record:
- Dev workflow now targets `melody@beep.local` via `config/dev.bat`
- Deploy workflow targets `arch@clippycat.ca` via `config/deploy.bat`
- `config/update.bat` deleted
- beep.local provisioned and Claude Code installed

- [ ] **Step 2: No commit needed** — memory files live outside the repo.
