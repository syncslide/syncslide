#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEBSOCKET_DIR="$(dirname "$SCRIPT_DIR")/syncslide-websocket"
TESTS_DIR="$(dirname "$SCRIPT_DIR")/tests"

PORT=5003
DB=test.sqlite3
PID=""

cleanup() {
    if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; fi
    rm -f "$WEBSOCKET_DIR/$DB"
}
trap cleanup EXIT

cd "$WEBSOCKET_DIR"

# Build
cargo build

# Rust unit tests
cargo test

# Port pre-check: fail clearly rather than having the binary silently not bind
if ss -tlnp | grep -q ":$PORT "; then
    echo "ERROR: port $PORT is already in use. Aborting." >&2
    exit 1
fi

# Start binary from syncslide-websocket/ so relative paths (templates/, js/, css/) resolve correctly.
# APP_DB tells the binary to open test.sqlite3 instead of db.sqlite3.
# Migrations run automatically on startup and create admin/admin + the Demo presentation.
APP_PORT=$PORT APP_DB="sqlite://$DB" ./target/debug/syncslide-websocket &
PID=$!

# Retry loop: more reliable than a fixed sleep when the binary startup time varies.
for i in $(seq 1 20); do
    curl -sf "http://localhost:$PORT/" > /dev/null && break || true
    sleep 1
done
# Final check outside the loop: this one is allowed to fail, exiting the script.
curl -sf "http://localhost:$PORT/" > /dev/null || {
    echo "ERROR: binary did not become ready on port $PORT after 20s" >&2
    exit 1
}

# Run Playwright from tests/ directory (where package.json and playwright.config.js live).
cd "$TESTS_DIR" && npx playwright test

# cleanup() runs here via trap regardless of exit code.
