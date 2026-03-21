# Controller Slide Navigation & Canonical URL Fix

**Date:** 2026-03-21
**Status:** Approved

## Problem

Two related issues:

1. The `controller` role has backend permission to send `Slide` messages over WebSocket, but is served `audience.html` which has no UI to do so. Controllers cannot actually control slides.
2. The `/{uname}/{pid}` route never verifies that `uname` matches the presentation owner. An editor visiting `editor_name/pid` is served the stage with `{{ user.name }}` (the logged-in editor) used in the QR URL, producing a non-canonical link.

## Goals

- Give controllers the same slide navigation UI (the `#goTo` select and associated JS) as owners and editors.
- Ensure `/{uname}/{pid}` always resolves to the canonical owner URL before serving any template.
- Keep template and JS responsibilities clearly separated.

## Out of Scope

- Recording controls (controllers cannot send `Text` messages; recording is an owner/editor workflow).
- Changes to how editors or owners interact with the stage.

---

## Section 1: Canonical URL Redirect

In the `/{uname}/{pid}` route handler (`present()`), after resolving both `pres_user` (from the URL's `uname`) and `pres` (from `pid`), add an ownership check before `check_access`:

```
if pres.user_id != pres_user.id:
    look up real owner by pres.user_id
    if not found → 500
    redirect 301 to /{owner_name}/{pid}[?pwd=...]
```

The `?pwd=` query param is forwarded so password-protected presentations continue to work after redirect.

**Behaviour change:** Previously, visiting `/{any_valid_user}/{pid}` would proceed to `check_access` and serve the appropriate view (with the wrong user as `pres_user`). After this change, any URL where `uname` is not the owner is redirected to the canonical owner URL before any template is served. This is intentional.

After this check, all branches below it can assume `pres_user` is the presentation owner.

### Stage QR fix

The `stage` function currently does not pass `pres_user` to its template context, and `stage.html`'s `{% block stage %}` contains a QR button/overlay that uses `{{ user.name }}` (the logged-in user). Two changes are needed:

1. Pass `pres_user` into the `stage` function and insert it into the template context.
2. In `stage.html`, update the QR `href` and `img alt` in `{% block stage %}` from `{{ user.name }}` to `{{ pres_user.name }}`.

Note: `audience.html` also renders a QR button/overlay (outside `{% block stage %}`) using `{{ pres_user.name }}`. That button is already correct once `pres_user` is the owner. The duplicate QR in `stage.html` is a pre-existing layout issue and is not changed by this spec beyond fixing the username reference.

## Section 2: Templates

### New: `_slide_nav.html`

A Tera partial containing only the slide navigation control:

```html
<nav aria-label="Slide Navigation">
<label for="goTo">Go to slide:</label>
<select id="goTo" name="goTo"></select>
</nav>
```

### New: `controller.html`

Extends `audience.html`. Fills `{% block stage %}` with the slide nav partial only (no editing tools, no recording).

`audience.html` renders a QR button/overlay when `pres_user` is set. This will appear on controller pages — this is intentional. A controller may want to show the QR code to the audience.

**`{% block js %}` is overridden completely** (without `{{ super() }}`) to list scripts explicitly, excluding `recording.js` (which has no null guard and would crash on elements that don't exist on this page) and `handlers.js` (editing only), and adding `slide-nav.js`:

```
{% extends "audience.html" %}
{% block title %}{{ pres.name }} (controller){% endblock title %}
{% block js %}
<script defer src="/js/remarkable.js"></script>
<script defer src="/js/katex.js"></script>
<script defer src="/js/auto-render.js"></script>
<script defer src="/js/render-a11y-string.js"></script>
<script defer src="/js/common.js"></script>
<script defer src="/js/audience.js"></script>
<script defer src="/js/slide-nav.js"></script>
<link rel="stylesheet" href="/css/katex.css">
{% endblock js %}
{% block stage %}
{% include "_slide_nav.html" %}
{% endblock stage %}
```

### Updated: `stage.html`

- Replaces the inline `<nav aria-label="Slide Navigation">` block with `{% include "_slide_nav.html" %}`.
- Updates `{% block js %}` to load `slide-nav.js` before `handlers.js` (required: `handlers.js` calls `getH2s()` at module initialisation, which is defined in `slide-nav.js`):

```
{% block js %}{{ super() }}<script defer="defer" src="/js/slide-nav.js"></script><script defer="defer" src="/js/handlers.js"></script>{% endblock js %}
```

### Updated: Route handler

The `_ =>` (Controller) branch in `present()` changes from rendering `audience.html` to rendering `controller.html`, with the same context: `pres`, `pres_user`, `initial_slide`.

## Section 3: JavaScript

### New: `slide-nav.js`

Extracted from `handlers.js`. Contains all slide navigation wiring:

- `getH2s(allHtml)` — populates the `#goTo` select with slide titles from parsed HTML
- `updateSlide()` — sends `{"type":"slide","data":n}` over the WebSocket
- `const goTo = document.getElementById("goTo")` and `onCommit(goTo, updateSlide)` — the input listener on the select (this wiring moves from `handlers.js` lines 56–57 into this file)
- The F8 / Shift+F8 keyboard handler for next/previous slide

This file is loaded by both `stage.html` and `controller.html`. It must load **before** `handlers.js` on stage.

### Updated: `handlers.js`

Removes the code extracted into `slide-nav.js`. `handlers.js` is loaded **only by `stage.html`** — loading it on any other template would crash because it accesses `#markdown-input` at module scope with no null guard.

Retains:

- `onCommit(el, fn)` utility
- `updateMarkdown()`
- `syncFromSlides()`, `markdownToSlides()`, `slidesToMarkdown()`
- Slide table rendering and actions
- Slide dialog (add/edit)
- Presentation name input handler

### Updated: `audience.js`

`isStage()` is currently defined but never called. It is removed entirely.

## Section 4: Testing

### Existing tests to update

- `controller_gets_audience_not_stage` — update assertion: response must contain `id="goTo"` (slide nav present) and must not contain `id="markdown-input"` (no editor).

### New tests

| Test | Assertion |
|------|-----------|
| Canonical URL redirect | `GET /editor_name/pid` as editor → 301 to `/owner_name/pid` |
| Canonical URL redirect preserves pwd | `GET /wrong_name/pid?pwd=x` → 301 to `/owner_name/pid?pwd=x` |
| Controller gets slide nav | Controller response HTML contains `id="goTo"` |
| Nonexistent uname returns generic audience | `GET /nobody/pid` → 200 with generic audience (existing behaviour, no change) |
