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
