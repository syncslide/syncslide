# Dark/Light Mode Toggle — Design Spec

**Date:** 2026-03-18
**Project:** SyncSlide
**Status:** Approved

---

## Overview

Add a user-controlled dark/light mode toggle to the entire site. The initial theme defaults to the OS preference (`prefers-color-scheme`). The user's choice is persisted in `localStorage` and applied on every subsequent page load without a visible flash.

---

## CSS Architecture

All hardcoded colour values in `syncslide-websocket/css/style.css` are converted to CSS custom properties. Two palettes are defined:

- `html[data-theme="dark"]` — current dark colours, unchanged
- `html[data-theme="light"]` — new light palette

Both palettes must meet WCAG 2.2 Level AAA contrast ratios (minimum 7:1 for normal text, 4.5:1 for large text). Contrast verification is a required implementation step — the light palette does not exist yet and values must be checked before shipping.

**`.terminal` removal:** Two `.terminal` rules exist in `style.css` and both are removed:
- The shared rule `.terminal, .file { padding: 10px; overflow-x: scroll; }` is split — `.file` retains its padding and overflow; the `.terminal` selector is removed
- The solo `.terminal { line-height: 1em; color: #00FF00; background-color: #000000; }` rule is deleted entirely

`.terminal` is not referenced in any template.

**Scope of colour conversion:** All colour values across the file are converted — including utility classes such as `.file`, `.pres-item summary`, `#page-info`, dialog form controls, and pagination controls, not just top-level body/link colours. The `clear-list` class has no rule in `style.css` (it is used in `nav.html` as a semantic hook but has no corresponding CSS declaration) and requires no changes.

**QR overlay:** `#qrOverlay` has `background: #fff` hardcoded. QR codes require a white background to be scannable, so the white background is kept in both themes — this value is left as a literal `#fff`, not a CSS custom property. A border is added in both themes so the overlay is visually distinct from the page in light mode. The border colour is a CSS custom property.

The QR markup (`#qrOverlay`, `#qrToggle`) appears in both `audience.html` and `stage.html`. The CSS fix covers both without any template changes.

**QR toggle pressed state:** `#qrToggle[aria-pressed="true"]` currently uses only a colour change (`outline: 2px solid #7ad`) to indicate the pressed state — this fails WCAG 2.2 SC 1.4.1 (Use of Colour). Fix by increasing the outline width to 4px when pressed, retaining the colour. This gives two simultaneous changes (size + colour) satisfying SC 1.4.1. Additionally, the outline colour (`#7ad`) must be verified for 3:1 contrast against the button's background colour in both themes per SC 1.4.11 (Non-text Contrast) — this is a required verification step during implementation. This is a pre-existing issue being corrected opportunistically since `style.css` is being touched.

**Motion:** Add a `@media (prefers-reduced-motion: reduce)` rule that sets `transition: none` on `summary::after`. This removes the `transform` animation on the triangle indicator when the user has requested reduced motion. This addresses WCAG 2.2 SC 2.3.3 (Animation from Interactions, AAA). No new transitions are introduced by this feature; this fixes a pre-existing gap.

`katex.css` is third-party and is not modified.

---

## Theme Initialisation — `js/theme-init.js`

A new file loaded **without `defer`** from `base.html`. It must be the **first tag inside `{% block head %}`**, before the viewport meta, charset, title, and stylesheet — so `data-theme` is set on `<html>` before the browser parses the stylesheet, preventing a flash of the wrong theme.

```html
{% block head %}
<script src="/js/theme-init.js"></script>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta charset="utf-8" />
<title>{% block title %}{% endblock title %} - SyncSlide</title>
<link rel="stylesheet" href="/css/style.css">
{% block js %}{% endblock js %}
{% endblock head %}
```

`theme.js` (deferred) is loaded outside `{% block head %}`, alongside the existing `ext-links.js`:

```html
<script src="/js/ext-links.js" defer></script>
<script src="/js/theme.js" defer></script>
```

The `js/` directory is already served by the existing `ServeDir` route in `main.rs` — no new route is needed.

**Init logic (runs immediately on script parse):**

1. Attempt to read `localStorage.getItem('theme')` inside a `try/catch` — `localStorage` can throw in private browsing and some AT browser profiles. The key `'theme'` is distinct from the existing `'syncslide_viewed'` key used in `presentations.html`.
2. If the stored value is exactly `"dark"` or `"light"`, use it
3. Otherwise (missing, invalid, or storage unavailable), check `window.matchMedia('(prefers-color-scheme: dark)').matches` — if true, use `"dark"`; otherwise use `"light"`
4. Set `document.documentElement.setAttribute('data-theme', theme)`

**`DOMContentLoaded` and `pageshow` listeners (also in this file):**

Register a handler on both `DOMContentLoaded` and `pageshow` (to cover browsers restoring pages from the back-forward cache, where `DOMContentLoaded` does not re-fire). The handler null-checks `#theme-toggle` before setting `aria-pressed` — the element may not exist on future pages that use `base.html` without `nav.html`. `DOMContentLoaded` fires before deferred scripts run, so `aria-pressed` is correct before `theme.js` executes.

`theme-init.js` and `theme.js` are unconditional in `base.html` and are not placed inside `{% block js %}` — they appear on every page regardless of which scripts child templates include in that block.

---

## Toggle Button — `nav.html` + `js/theme.js`

### HTML

The toggle is the last `<li>` in the nav list in `nav.html`:

```html
<li><button type="button" id="theme-toggle" aria-pressed="false">Dark mode</button></li>
```

- Label is stable: "Dark mode" — this names the **action** (activating dark mode), not the current state. When light mode is active, pressing the button activates dark mode; `aria-pressed="false"` confirms dark mode is not currently active. Announced as "Dark mode, toggle button, not pressed" in light mode; "Dark mode, toggle button, pressed" in dark mode.
- The button is the last focusable element in the `<nav>`; focus then moves to whatever follows the nav in DOM order (breadcrumb, content)
- `theme-init.js` corrects `aria-pressed` via `DOMContentLoaded`/`pageshow` before deferred scripts run — no mismatch window

### JS — `js/theme.js` (deferred)

Loaded with `defer` alongside `ext-links.js` in `base.html`. Handles all toggle interaction and any future theme control logic.

**On page load:**
- Confirm `aria-pressed` is correct (defensive check, since `theme-init.js` already set it)

**On button click:**
- Determine new theme (flip current `data-theme`)
- Set `data-theme` on `document.documentElement`
- Update `aria-pressed` on the button
- Write new theme to `localStorage` inside a `try/catch`

---

## Nav on Audience and Recording Pages

`audience.html` and `recording.html` currently extend `base.html` directly, bypassing the nav. They are changed to extend `nav.html` so the toggle (and nav) appears on every page of the site.

The nav was previously omitted from these pages to avoid distracting from the main content. A redesign of the nav to be less intrusive on presentation and recording pages is deferred to a separate spec and plan.

**Template inheritance:** `stage.html` extends `audience.html` and uses `{{ super() }}` in `{% block js %}`. This resolves directly to `audience.html`'s `{% block js %}` content — the new `audience.html` → `nav.html` parent chain is irrelevant to this resolution since `audience.html` still defines its own `{% block js %}`. No change to `stage.html` is needed.

**Context variables:** `nav.html` uses `user`, `groups`, and `pres_num`, but all three are gated on `{% if user %}` so they are optional for unauthenticated views. The shared `render()` wrapper in `main.rs` already injects these whenever a session exists — no code change is required for the nav variables. The `recording()` handler injects its own page-specific variables (`pres_user`, `is_owner`, `recording`, `pres`) independently; these are unaffected.

**Required test:** The empty-context fallback path in `audience()` (used when a presentation is not found) must be manually verified after the template change — load a URL for a non-existent presentation and confirm a valid page is returned rather than a Tera render panic. All nav variables are `{% if %}`-gated so this is expected to pass, but it must be confirmed before shipping.

**Note:** `presentations.html` contains a pre-existing inline `<script>` block. The constraint "no inline scripts" applies to new code introduced by this feature; this pre-existing exception is unaffected.

---

## Files Changed

| File | Change |
|------|--------|
| `syncslide-websocket/css/style.css` | Convert all colour values to CSS custom properties; add dark/light palettes; remove both `.terminal` rules; split `.terminal, .file` rule; add `#qrOverlay` border; fix `#qrToggle` pressed indicator (2px → 4px outline); add `prefers-reduced-motion` override for `summary::after` |
| `syncslide-websocket/templates/base.html` | Add `<script src="/js/theme-init.js">` as first tag in `{% block head %}`; add `<script src="/js/theme.js" defer>` alongside `ext-links.js` outside `{% block head %}` |
| `syncslide-websocket/templates/nav.html` | Add theme toggle button as last nav `<li>` |
| `syncslide-websocket/templates/audience.html` | Change `extends "base.html"` to `extends "nav.html"` |
| `syncslide-websocket/templates/recording.html` | Change `extends "base.html"` to `extends "nav.html"` |
| `syncslide-websocket/js/theme-init.js` | New file — sync theme initialisation + DOMContentLoaded/pageshow listeners for `aria-pressed` |
| `syncslide-websocket/js/theme.js` | New file — toggle button interaction and future theme controls |

No Rust changes. No new routes. No database changes.

---

## Accessibility

- Toggle button uses the ARIA APG toggle button pattern: stable label ("Dark mode") naming the action + `aria-pressed` conveying current state
- Both palettes must meet WCAG 2.2 Level AAA contrast ratios — verified during implementation
- Button is keyboard operable (native `<button>` element)
- No reliance on colour alone to convey any information
- `prefers-color-scheme` is respected as the default
- `localStorage` access is wrapped in `try/catch` — private browsing and some AT browser profiles fall back gracefully to OS preference
- `aria-pressed` is corrected via `DOMContentLoaded` and `pageshow` — covers both initial load and back-forward cache restores
- `#qrToggle` pressed state gains a non-colour indicator (outline width 2px → 4px), fixing a pre-existing WCAG 2.2 SC 1.4.1 violation
- `prefers-reduced-motion: reduce` override added for `summary::after` transition, addressing WCAG 2.2 SC 2.3.3
