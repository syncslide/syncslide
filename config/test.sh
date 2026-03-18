#!/usr/bin/env bash
set -e

PORT=5003
DB=test.sqlite3
# Capture CWD now so the trap cleanup can find test.sqlite3 correctly
# even after 'cd ../tests' changes the working directory for Playwright.
ORIG_DIR="$(pwd)"
PID=""

cleanup() {
    if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; fi
    rm -f "$ORIG_DIR/$DB"
}
trap cleanup EXIT

# Port pre-check: fail clearly rather than having the binary silently not bind
if ss -tlnp | grep -q ":$PORT "; then
    echo "ERROR: port $PORT is already in use. Aborting." >&2
    exit 1
fi

# Start binary from syncslide-websocket/ so relative paths (templates/, js/, css/) resolve correctly.
# APP_DB tells the binary to open test.sqlite3 instead of db.sqlite3.
# Migrations run automatically on startup and create admin/admin + the Demo presentation.
APP_PORT=$PORT APP_DB="sqlite://$DB" ./target/release/syncslide-websocket &
PID=$!

# Retry loop: more reliable than a fixed sleep when the binary startup time varies.
# '|| true' prevents set -e from exiting when curl fails on an early iteration.
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
cd ../tests && npx playwright test

# cleanup() runs here via trap regardless of exit code.
