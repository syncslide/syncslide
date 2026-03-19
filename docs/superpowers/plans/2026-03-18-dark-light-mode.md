# Dark/Light Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible, persistent dark/light mode toggle to every page, defaulting to OS preference, stored in localStorage, with no flash on load.

**Architecture:** CSS custom properties on `html[data-theme]` control all colour values; a tiny inline script (`theme-init.js`) sets `data-theme` before the stylesheet renders; a deferred `theme.js` wires the toggle button; templates are updated to include both scripts and the button.

**Tech Stack:** Vanilla JS, CSS custom properties, Playwright (end-to-end tests), Axe-core (accessibility assertions). No Rust changes. No new routes.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `syncslide-websocket/css/style.css` | Modify | All colour values → CSS vars; two palettes; remove `.terminal`; misc a11y fixes |
| `syncslide-websocket/js/theme-init.js` | Create | Read localStorage / `prefers-color-scheme`; set `data-theme` synchronously before stylesheet renders |
| `syncslide-websocket/js/theme.js` | Create | Wire toggle button click; flip theme; persist to localStorage |
| `syncslide-websocket/templates/base.html` | Modify | Load `theme-init.js` first (no defer); load `theme.js` deferred alongside `ext-links.js` |
| `syncslide-websocket/templates/nav.html` | Modify | Add toggle button as last `<li>` in nav |
| `syncslide-websocket/templates/audience.html` | Modify | `extends "base.html"` → `extends "nav.html"` |
| `syncslide-websocket/templates/recording.html` | Modify | `extends "base.html"` → `extends "nav.html"` |
| `tests/theme.spec.js` | Create | Playwright: toggle behaviour, aria-pressed, localStorage persistence, private-browsing fallback, bfcache restore, axe in both themes |

---

## Task 1: Write failing Playwright tests

The tests will fail until the feature is implemented. Push them first to confirm a clean red baseline before touching any implementation files.

**Files:**
- Create: `tests/theme.spec.js`

- [ ] **Step 1: Write `tests/theme.spec.js`**

```js
// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { loginAsAdmin } = require('./helpers');

const WCAG_TAGS = [
    'wcag2a', 'wcag2aa', 'wcag21aa', 'wcag21aaa', 'best-practice',
];

async function assertNoViolations(page) {
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length > 0) {
        const report = results.violations.map(v =>
            `[${v.impact}] ${v.id}: ${v.description}\n  ${v.helpUrl}\n  ${v.nodes.map(n => n.html).join(', ')}`
        ).join('\n\n');
        throw new Error(`axe found ${results.violations.length} violation(s):\n\n${report}`);
    }
}

test.describe('theme toggle — public pages', () => {
    test('toggle button exists in nav with correct role and label', async ({ page }) => {
        await page.goto('/');
        const btn = page.locator('#theme-toggle');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveAttribute('aria-pressed');
    });

    test('toggle button switches theme and updates aria-pressed', async ({ page }) => {
        await page.goto('/');
        const btn = page.locator('#theme-toggle');
        const html = page.locator('html');

        // Record initial state
        const initialTheme = await html.getAttribute('data-theme');
        const initialPressed = await btn.getAttribute('aria-pressed');

        // Toggle
        await btn.click();

        const newTheme = await html.getAttribute('data-theme');
        const newPressed = await btn.getAttribute('aria-pressed');

        // Theme should have flipped
        expect(newTheme).not.toBe(initialTheme);
        expect(newPressed).not.toBe(initialPressed);
    });

    test('theme persists across page navigation via localStorage', async ({ page }) => {
        await page.goto('/');
        const btn = page.locator('#theme-toggle');

        // Force dark theme by toggling until data-theme="dark"
        let theme = await page.locator('html').getAttribute('data-theme');
        if (theme !== 'dark') await btn.click();

        // Navigate away and back
        await page.goto('/auth/login');
        await page.goto('/');

        const persistedTheme = await page.locator('html').getAttribute('data-theme');
        expect(persistedTheme).toBe('dark');
    });

    test('theme falls back to OS preference when localStorage is unavailable', async ({ page }) => {
        // Block localStorage to simulate private browsing / AT browser profiles
        await page.addInitScript(() => {
            Object.defineProperty(window, 'localStorage', {
                get() { throw new DOMException('SecurityError'); }
            });
        });

        await page.goto('/');

        // page should load without throwing and data-theme should be set
        const theme = await page.locator('html').getAttribute('data-theme');
        expect(['dark', 'light']).toContain(theme);

        // Toggle button should still be operable
        const btn = page.locator('#theme-toggle');
        await expect(btn).toBeVisible();
        await btn.click(); // should not throw
        const newTheme = await page.locator('html').getAttribute('data-theme');
        expect(newTheme).not.toBe(theme);
    });

    test('aria-pressed is correct after back-forward cache restore', async ({ page }) => {
        await page.goto('/');
        const btn = page.locator('#theme-toggle');

        // Set a known theme state by toggling
        const initialTheme = await page.locator('html').getAttribute('data-theme');
        if (initialTheme !== 'dark') await btn.click();
        const pressedBefore = await btn.getAttribute('aria-pressed');

        // Navigate away, then use browser back button (triggers bfcache restore
        // where DOMContentLoaded does not re-fire — only pageshow fires)
        await page.goto('/auth/login');
        await page.goBack();

        // aria-pressed must still reflect current theme
        const pressedAfter = await page.locator('#theme-toggle').getAttribute('aria-pressed');
        expect(pressedAfter).toBe(pressedBefore);
    });

    test('axe passes in dark theme', async ({ page }) => {
        await page.goto('/');
        // Ensure dark theme
        const html = page.locator('html');
        if (await html.getAttribute('data-theme') !== 'dark') {
            await page.locator('#theme-toggle').click();
        }
        await assertNoViolations(page);
    });

    test('axe passes in light theme', async ({ page }) => {
        await page.goto('/');
        // Ensure light theme
        const html = page.locator('html');
        if (await html.getAttribute('data-theme') !== 'light') {
            await page.locator('#theme-toggle').click();
        }
        await assertNoViolations(page);
    });
});

test.describe('theme toggle — audience page', () => {
    test('toggle button exists on audience page', async ({ page }) => {
        // Use demo presentation so we don't need auth
        await page.goto('/demo');
        await expect(page.locator('#theme-toggle')).toBeVisible();
    });
});

test.describe('theme toggle — authenticated pages', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test('toggle button exists on presentations page', async ({ page }) => {
        await page.goto('/user/presentations');
        await expect(page.locator('#theme-toggle')).toBeVisible();
    });
});
```

- [ ] **Step 2: Commit tests only (not implementation)**

```bash
git add tests/theme.spec.js
git commit -m "test: add failing Playwright tests for dark/light mode toggle"
```

- [ ] **Step 3: Push and deploy**

```bash
git push
```

Then on VPS: `config/update.bat`

- [ ] **Step 4: Run tests on VPS to confirm red baseline**

SSH to VPS, then:
```bash
cd tests && npx playwright test theme.spec.js
```

Expected: all tests FAIL (toggle button not found — correct baseline).

---

## Task 2: CSS — remove `.terminal`, split `.terminal, .file`

**Files:**
- Modify: `syncslide-websocket/css/style.css`

The current line 57 is:
```css
.terminal, .file { padding: 10px; overflow-x: scroll; }
```
And line 59 is:
```css
.terminal { line-height: 1em; color: #00FF00; background-color: #000000; }
```

`.terminal` is not used in any template. Remove both selectors; keep `.file` properties.

- [ ] **Step 1: In `style.css`, replace line 57 with `.file`-only rule**

Old:
```css
.terminal, .file { padding: 10px; overflow-x: scroll; }
```

New:
```css
.file { padding: 10px; overflow-x: scroll; }
```

- [ ] **Step 2: Delete the standalone `.terminal` rule (line 59)**

Delete this entire line:
```css
.terminal { line-height: 1em; color: #00FF00; background-color: #000000; }
```

- [ ] **Step 3: Verify no template uses `.terminal`**

```bash
grep -r "terminal" syncslide-websocket/templates/
```

Expected: no results.

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/css/style.css
git commit -m "style: remove unused .terminal CSS rules"
```

---

## Task 3: CSS — convert hardcoded colours to CSS custom properties (dark palette)

The dark palette preserves all current colours exactly. After this task, the site looks identical to today, but all colour values come from CSS variables. The light palette is added in Task 4.

**Files:**
- Modify: `syncslide-websocket/css/style.css`

- [ ] **Step 1: Add dark palette block at the top of `style.css` (before `body {`)**

```css
html[data-theme="dark"] {
  --bg:               #222222;
  --text:             #ffffff;
  --link:             #99bbcc;
  --link-visited:     #ff90c8;
  --link-nav:         #ffffff;
  --slide-border:     #cccccc;
  --hr-color:         #999999;
  --table-border:     #aaaaaa;
  --file-bg:          #444444;
  --muted:            #bbbbbb;
  --pres-item-border: #555555;
  --control-bg:       #333333;
  --control-border:   #666666;
  --dialog-bg:        #2a2a2a;
  --qr-border:        #555555;
  --qr-outline:       #77aadd;
}
```

- [ ] **Step 2: Replace hardcoded colours in `body` rule**

Old:
```css
body { background-color: #222222; padding: 16px; font-family: -apple-system, helvetica, arial, sans-serif; font-size: 16px; color: #ffffff; line-height: 1.5em; overflow-wrap: break-word; }
```

New:
```css
body { background-color: var(--bg); padding: 16px; font-family: -apple-system, helvetica, arial, sans-serif; font-size: 16px; color: var(--text); line-height: 1.5em; overflow-wrap: break-word; }
```

- [ ] **Step 3: Replace colour in `h2` rule**

Old:
```css
h2 { text-align: center; line-height: 1.5em; color: #ffffff; margin-bottom: 8px; }
```

New:
```css
h2 { text-align: center; line-height: 1.5em; color: var(--text); margin-bottom: 8px; }
```

- [ ] **Step 4: Replace colour in `#currentSlide` rule**

Old:
```css
#currentSlide { border: 1px solid #cccccc; max-width: 800px; margin: auto; }
```

New:
```css
#currentSlide { border: 1px solid var(--slide-border); max-width: 800px; margin: auto; }
```

- [ ] **Step 5: Replace colour in `hr` rule**

Old:
```css
hr { border: none; border-bottom: 1px solid #999; }
```

New:
```css
hr { border: none; border-bottom: 1px solid var(--hr-color); }
```

- [ ] **Step 6: Replace colours in `a` and `a:visited` rules**

Old:
```css
a { text-decoration: underline; color: #99bbcc; }
a:visited { color: #ff90c8; }
```

New:
```css
a { text-decoration: underline; color: var(--link); }
a:visited { color: var(--link-visited); }
```

- [ ] **Step 7: Replace colours in `a.nav-link, a.post-title-link` and `nav a` rules**

Old:
```css
a.nav-link, a.post-title-link { color: #ffffff; text-decoration: none; }
nav a { margin: 1em; color: #ffffff; font-weight: bold; font-style: none; }
```

New:
```css
a.nav-link, a.post-title-link { color: var(--link-nav); text-decoration: none; }
nav a { margin: 1em; color: var(--link-nav); font-weight: bold; font-style: none; }
```

- [ ] **Step 8: Replace colour in `table` rule**

Old:
```css
table, table tr, table td, table th { border: 1px solid #aaa; border-collapse: collapse; padding: 5px; font-weight: normal; }
```

New:
```css
table, table tr, table td, table th { border: 1px solid var(--table-border); border-collapse: collapse; padding: 5px; font-weight: normal; }
```

- [ ] **Step 9: Replace colours in `.file` rule**

Old:
```css
.file { line-height: 1.2em; background-color: #444444; color: #ffffff; }
```

New:
```css
.file { line-height: 1.2em; background-color: var(--file-bg); color: var(--text); }
```

- [ ] **Step 10: Replace colour in `.post-date` rule**

Old:
```css
.post-date { text-transform: uppercase; font-weight: bold; color: #ffffff; }
```

New:
```css
.post-date { text-transform: uppercase; font-weight: bold; color: var(--text); }
```

- [ ] **Step 11: Replace colours in `.pres-controls select, .pagination-controls select` rule**

Old:
```css
.pres-controls select, .pagination-controls select { background: #333; color: #fff; border: 1px solid #666; padding: 3px 6px; }
```

New:
```css
.pres-controls select, .pagination-controls select { background: var(--control-bg); color: var(--text); border: 1px solid var(--control-border); padding: 3px 6px; }
```

- [ ] **Step 12: Replace colour in `.pres-item` rule**

Old:
```css
.pres-item { border-bottom: 1px solid #555; padding: .8em 0; }
```

New:
```css
.pres-item { border-bottom: 1px solid var(--pres-item-border); padding: .8em 0; }
```

- [ ] **Step 13: Replace colour in `.pres-item summary` rule**

Old:
```css
.pres-item summary { cursor: pointer; color: #bbb; }
```

New:
```css
.pres-item summary { cursor: pointer; color: var(--muted); }
```

- [ ] **Step 14: Replace colours in `.pagination-controls button` rule**

Old:
```css
.pagination-controls button { background: #333; color: #fff; border: 1px solid #666; padding: 4px 10px; cursor: pointer; }
```

New:
```css
.pagination-controls button { background: var(--control-bg); color: var(--text); border: 1px solid var(--control-border); padding: 4px 10px; cursor: pointer; }
```

- [ ] **Step 15: Replace colour in `#page-info` rule**

Old:
```css
#page-info { color: #bbb; }
```

New:
```css
#page-info { color: var(--muted); }
```

- [ ] **Step 16: Replace outline colour in `#qrToggle[aria-pressed="true"]` rule (outline width fix done in Task 5)**

Old:
```css
#qrToggle[aria-pressed="true"] { outline: 2px solid #7ad; }
```

New (width stays 2px for now; Task 5 increases it to 4px and also uses the var):
```css
#qrToggle[aria-pressed="true"] { outline: 2px solid var(--qr-outline); }
```

- [ ] **Step 17: Replace colours in `dialog` rules**

Old:
```css
dialog { background: #2a2a2a; color: #fff; border: 1px solid #666; border-radius: 4px; padding: 1.5em; max-width: min(90vw, 600px); }
dialog button { background: #333; color: #fff; border: 1px solid #666; padding: 4px 10px; cursor: pointer; }
dialog input[type="text"], dialog input[type="file"], dialog textarea, dialog select { background: #333; color: #fff; border: 1px solid #666; padding: 3px 6px; }
dialog fieldset { border-color: #666; }
```

New:
```css
dialog { background: var(--dialog-bg); color: var(--text); border: 1px solid var(--control-border); border-radius: 4px; padding: 1.5em; max-width: min(90vw, 600px); }
dialog button { background: var(--control-bg); color: var(--text); border: 1px solid var(--control-border); padding: 4px 10px; cursor: pointer; }
dialog input[type="text"], dialog input[type="file"], dialog textarea, dialog select { background: var(--control-bg); color: var(--text); border: 1px solid var(--control-border); padding: 3px 6px; }
dialog fieldset { border-color: var(--control-border); }
```

- [ ] **Step 18: Verify no hardcoded colour hex values remain (except `#fff` in `#qrOverlay` which is intentional)**

```bash
grep -n "#[0-9a-fA-F]\{3,6\}" syncslide-websocket/css/style.css
```

Expected: only `#qrOverlay { ... background: #fff ... }` and the sourceMappingURL comment.

- [ ] **Step 19: Commit**

```bash
git add syncslide-websocket/css/style.css
git commit -m "style: convert hardcoded colours to CSS custom properties (dark palette)"
```

---

## Task 4: CSS — add light palette

The light palette must achieve WCAG 2.2 Level AAA contrast ratios. For normal body text this is 7:1; for large text (bold ≥14pt or regular ≥18pt) it is 4.5:1; for non-text UI components it is 3:1. Every proposed value below includes a target ratio — you MUST verify each one with a contrast checker (e.g. webaim.org/resources/contrastchecker/) before committing. Adjust any value that fails.

**Files:**
- Modify: `syncslide-websocket/css/style.css`

- [ ] **Step 1: Add light palette block immediately after the dark palette block**

```css
html[data-theme="light"] {
  --bg:               #ffffff;
  --text:             #1a1a1a;   /* target ≥7:1 on #ffffff — verify */
  --link:             #0046ad;   /* target ≥7:1 on #ffffff — verify */
  --link-visited:     #6600aa;   /* target ≥7:1 on #ffffff — verify */
  --link-nav:         #1a1a1a;   /* same as --text — verify */
  --slide-border:     #767676;   /* target ≥3:1 on #ffffff (non-text) — verify */
  --hr-color:         #767676;   /* target ≥3:1 — verify */
  --table-border:     #767676;   /* target ≥3:1 — verify */
  --file-bg:          #e8e8e8;
  --muted:            #4d4d4d;   /* target ≥7:1 on #ffffff — verify */
  --pres-item-border: #cccccc;   /* decorative only — verify ≥3:1 */
  --control-bg:       #f0f0f0;
  --control-border:   #767676;   /* target ≥3:1 on #f0f0f0 and #ffffff — verify both */
  --dialog-bg:        #f5f5f5;
  --qr-border:        #767676;   /* target ≥3:1 on #ffffff — verify */
  --qr-outline:       #005580;   /* target ≥3:1 on button bg — verify */
}
```

- [ ] **Step 2: Verify contrast for every proposed light palette value**

Open https://webaim.org/resources/contrastchecker/ (or equivalent).

Check each pair:
| Foreground | Background | Target | Purpose |
|------------|------------|--------|---------|
| `#1a1a1a` | `#ffffff` | ≥7:1 | body text |
| `#0046ad` | `#ffffff` | ≥7:1 | link text |
| `#6600aa` | `#ffffff` | ≥7:1 | visited link |
| `#4d4d4d` | `#ffffff` | ≥7:1 | muted/secondary text |
| `#1a1a1a` | `#f0f0f0` | ≥7:1 | text in form controls |
| `#1a1a1a` | `#f5f5f5` | ≥7:1 | text in dialogs |
| `#1a1a1a` | `#e8e8e8` | ≥7:1 | text in .file blocks |
| `#767676` | `#ffffff` | ≥3:1 | non-text borders/separators |
| `#767676` | `#f0f0f0` | ≥3:1 | control borders on control bg |
| `#005580` | button bg | ≥3:1 | qrToggle outline (non-text) |

For any failing value, darken the foreground (move it toward `#000000`) until it passes, then update the variable in the CSS.

- [ ] **Step 3: Commit light palette (after all values verified)**

```bash
git add syncslide-websocket/css/style.css
git commit -m "style: add light theme CSS palette (WCAG AAA verified)"
```

---

## Task 5: CSS — miscellaneous accessibility fixes

Three pre-existing issues fixed opportunistically since `style.css` is already being touched.

**Files:**
- Modify: `syncslide-websocket/css/style.css`

### Fix 1: `#qrToggle` pressed indicator — non-colour change (WCAG 2.2 SC 1.4.1)

The current 2px outline changes colour only when pressed. WCAG SC 1.4.1 requires a non-colour indicator. Fix: increase outline width to 4px when pressed (two simultaneous changes: width + colour).

- [ ] **Step 1: Update `#qrToggle[aria-pressed="true"]` to 4px**

Old:
```css
#qrToggle[aria-pressed="true"] { outline: 2px solid var(--qr-outline); }
```

New:
```css
#qrToggle[aria-pressed="true"] { outline: 4px solid var(--qr-outline); }
```

### Fix 2: `#qrOverlay` border — visible in light mode (WCAG 2.2 SC 1.4.11)

The QR overlay has a white background in both themes (intentional — QR codes require white). In light mode the overlay is invisible against the page. Add a border using a CSS custom property. The `background: #fff` literal stays.

- [ ] **Step 2: Add border to `#qrOverlay` rule**

Old:
```css
#qrOverlay { position: fixed; bottom: 1em; right: 1em; background: #fff; padding: 8px; border-radius: 4px; z-index: 100; line-height: 0; }
```

New:
```css
#qrOverlay { position: fixed; bottom: 1em; right: 1em; background: #fff; border: 2px solid var(--qr-border); padding: 8px; border-radius: 4px; z-index: 100; line-height: 0; }
```

### Fix 3: `prefers-reduced-motion` for `summary::after` (WCAG 2.2 SC 2.3.3)

The `summary::after` triangle uses a `transition: transform .15s` animation. Add a reduced-motion override.

- [ ] **Step 3: Add `prefers-reduced-motion` rule after the existing `summary::after` and `details[open]` rules**

Add immediately after `details[open] > summary::after { transform: rotate(90deg); }`:

```css
@media (prefers-reduced-motion: reduce) { summary::after { transition: none; } }
```

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/css/style.css
git commit -m "style: fix qrToggle pressed indicator, qrOverlay border, add prefers-reduced-motion"
```

---

## Task 6: Create `js/theme-init.js`

This script runs synchronously (no `defer`) as the very first tag in `<head>` — before the viewport meta, charset, and stylesheet — so `data-theme` is set on `<html>` before the browser parses the CSS. This prevents a flash of the wrong theme.

**Files:**
- Create: `syncslide-websocket/js/theme-init.js`

- [ ] **Step 1: Create the file**

```js
(function () {
    var theme = null;

    // localStorage can throw in private browsing and some AT browser profiles
    try {
        var stored = localStorage.getItem('theme');
        if (stored === 'dark' || stored === 'light') {
            theme = stored;
        }
    } catch (e) { /* ignore */ }

    // Fall back to OS preference
    if (!theme) {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    document.documentElement.setAttribute('data-theme', theme);

    // Sync aria-pressed on the toggle button.
    // Uses both DOMContentLoaded (normal load) and pageshow (back-forward cache
    // restore, where DOMContentLoaded does not re-fire).
    function syncPressed() {
        var btn = document.getElementById('theme-toggle');
        if (btn) {
            btn.setAttribute('aria-pressed',
                document.documentElement.getAttribute('data-theme') === 'dark' ? 'true' : 'false');
        }
    }

    document.addEventListener('DOMContentLoaded', syncPressed);
    window.addEventListener('pageshow', syncPressed);
}());
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/js/theme-init.js
git commit -m "feat: add theme-init.js — synchronous theme application before stylesheet"
```

---

## Task 7: Create `js/theme.js`

Deferred script — handles toggle button clicks and keeps `aria-pressed` / `localStorage` in sync.

**Files:**
- Create: `syncslide-websocket/js/theme.js`

- [ ] **Step 1: Create the file**

```js
(function () {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return; // Button absent on pages without nav — safe no-op

    // Defensive sync in case theme-init.js ran before DOM was fully available
    var html = document.documentElement;
    btn.setAttribute('aria-pressed', html.getAttribute('data-theme') === 'dark' ? 'true' : 'false');

    btn.addEventListener('click', function () {
        var current = html.getAttribute('data-theme');
        var next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        btn.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');

        try {
            localStorage.setItem('theme', next);
        } catch (e) { /* private browsing — fall back to session-only state */ }
    });
}());
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/js/theme.js
git commit -m "feat: add theme.js — toggle button interaction and localStorage persistence"
```

---

## Task 8: Template changes

Four templates need updating. The order matters: do `base.html` and `nav.html` first since the other two depend on them.

**Files:**
- Modify: `syncslide-websocket/templates/base.html`
- Modify: `syncslide-websocket/templates/nav.html`
- Modify: `syncslide-websocket/templates/audience.html`
- Modify: `syncslide-websocket/templates/recording.html`

### `base.html` — add script tags

- [ ] **Step 1: Add `theme-init.js` as the first tag inside `{% block head %}`**

Current `base.html` `{% block head %}` opens with `<meta name="viewport" ...>`. The init script must come before it.

Old:
```html
{% block head %}
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

New:
```html
{% block head %}
<script src="/js/theme-init.js"></script>
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

- [ ] **Step 2: Add `theme.js` alongside `ext-links.js` (outside `{% block head %}`)**

Old:
```html
<script src="/js/ext-links.js" defer></script>
</head>
```

New:
```html
<script src="/js/ext-links.js" defer></script>
<script src="/js/theme.js" defer></script>
</head>
```

### `nav.html` — add toggle button

- [ ] **Step 3: Add the toggle button after `</nav>`, inside `{% block nav %}`**

The button sits in the banner landmark (`<header>`) but outside the navigation landmark — it is not a list item.

Old (end of `{% block nav %}`):
```html
</nav>
{% endblock nav %}
```

New:
```html
</nav>
<button type="button" id="theme-toggle" aria-pressed="false">Dark mode</button>
{% endblock nav %}
```

Note on button label: "Dark mode" names the **action** (activating dark mode), not the current state. `aria-pressed="false"` means dark mode is not currently active. `theme-init.js` corrects the initial `aria-pressed` value on `DOMContentLoaded`. The button lives in the `<header>` banner landmark, after the navigation landmark, so screen readers announce it after the nav links.

### `audience.html` and `recording.html` — add nav

- [ ] **Step 4: Change `audience.html` to extend `nav.html`**

Old:
```html
{% extends "base.html" %}
```

New:
```html
{% extends "nav.html" %}
```

- [ ] **Step 5: Change `recording.html` to extend `nav.html`**

Old:
```html
{% extends "base.html" %}
```

New:
```html
{% extends "nav.html" %}
```

Note on `stage.html`: it extends `audience.html` and uses `{{ super() }}` in `{% block js %}`. This resolves to `audience.html`'s own `{% block js %}` content — the parent chain change is transparent. No change needed in `stage.html`.

Note on template context: all nav variables (`user`, `groups`, `pres_num`) are gated on `{% if user %}` in `nav.html`, so they are optional. Unauthenticated views render safely without them.

- [ ] **Step 6: Commit all template changes together**

```bash
git add syncslide-websocket/templates/base.html \
        syncslide-websocket/templates/nav.html \
        syncslide-websocket/templates/audience.html \
        syncslide-websocket/templates/recording.html
git commit -m "feat: wire dark/light mode toggle into all pages"
```

---

## Task 9: Push, deploy, and verify

- [ ] **Step 1: Push all commits**

```bash
git push
```

- [ ] **Step 2: Deploy on VPS**

```
config/update.bat
```

Wait for the build to complete and the service to restart.

- [ ] **Step 3: Manual smoke check — empty-context audience page**

Load a URL for a non-existent presentation (e.g. `/nonexistentuser/99999`). Confirm the page renders without a Tera panic (HTTP 404 or a graceful empty page, not a 500). This verifies that the `audience.html` → `nav.html` template change handles the missing-presentation case correctly — all nav variables are `{% if %}`-gated so this is expected to pass.

- [ ] **Step 4: Run all Playwright tests on VPS**

SSH to VPS, then:
```bash
cd tests && npx playwright test
```

Expected: all tests pass, including the theme tests written in Task 1 and the existing accessibility, auth, presentations, websocket, and help tests.

- [ ] **Step 5: If any theme test fails, diagnose before fixing**

Do not re-run tests hoping they pass. Read the Playwright error output, identify the specific assertion that failed, trace it to the relevant file, and fix the root cause.

- [ ] **Step 6: If any axe violation is reported in either theme, fix before merging**

Axe violations in the light theme most commonly mean a colour value that looked sufficient but fails at the actual contrast ratio. Correct the CSS custom property value, verify with the contrast checker, push, redeploy, and re-run.

---

## Completion Checklist

Before considering this feature done:

- [ ] All Playwright tests pass (including pre-existing tests — nothing regressed)
- [ ] Both themes pass axe-core WCAG checks
- [ ] Toggle button announced correctly by screen reader (verified manually or via NVDA/VoiceOver)
- [ ] Theme persists across page navigations
- [ ] No flash of wrong theme on hard reload
- [ ] Audience and recording pages have nav (and toggle)
- [ ] Non-existent presentation URL does not cause a 500 error
