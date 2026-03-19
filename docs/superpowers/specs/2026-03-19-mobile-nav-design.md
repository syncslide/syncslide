# Mobile Nav Hamburger — Design Spec

**Date:** 2026-03-19
**Status:** Approved

## Summary

Add a hamburger toggle to the primary navigation at mobile widths (≤768px), and replace the Account `<details>`/`<summary>` submenu with a `<button aria-expanded>` disclosure pattern at all widths. Desktop nav (≥769px) keeps inline links unchanged except for reduced padding.

## Scope

This spec builds on the nav structure defined in `2026-03-18-nav-design.md`. The landmark structure, link order, skip link, and `<main id="main">` are all unchanged. The Account `<nav aria-label="Account">` remains a sibling of `<nav aria-label="Primary navigation">` in the header — this spec does not alter that structural relationship. This spec covers only the toggle behaviour, the hamburger button, and the Account submenu pattern change.

## Breakpoint

- **≥769px (desktop):** Primary nav links always visible as a horizontal inline row. Hamburger button hidden.
- **≤768px (mobile):** Primary nav links hidden by default. Hamburger button visible. When the menu opens, the `<ul>` stays inside `<nav>` inside `<header>` — the header grows to accommodate it. "Below the header" describes the visual result, not a DOM move.

The existing `@media (max-width: 600px)` nav rules in `style.css` (`nav { text-align: left; width: 100% }`, `nav a { display: block }`) are superseded by the new 768px rules and must be removed. The non-nav rule in that block (`body { width: 90% }`) may remain if desired.

## Hamburger Button

```html
<button type="button" aria-expanded="false" aria-controls="primary-nav-list">
  <span class="menu-label">
    <svg aria-hidden="true"><!-- three horizontal lines --></svg>
    Menu
  </span>
  <span class="close-label">
    <svg aria-hidden="true"><!-- × --></svg>
    Close
  </span>
</button>
```

- Placed as the **first child** of `<nav aria-label="Primary navigation">`, immediately before the `<ul>` of links
- Needs no `id` attribute and no CSS class — it is targeted by `[aria-expanded]` in CSS and JS
- `id="primary-nav-list"` is added to the primary nav `<ul>` alongside its existing `class="clear-list"`; the class is not removed. Also add `role="list"` to this `<ul>` — Safari/VoiceOver removes list semantics from `<ul>` elements styled with `list-style: none`
- Visible only at ≤768px via CSS (`display: none` at ≥769px)
- `.menu-label` shown by default; `.close-label` hidden. Swapped via CSS when `aria-expanded="true"`
- Both SVGs use `fill="currentColor"` only — no `stroke`. Stroke-based SVGs proved invisible in this codebase (ext-links bug); all new SVGs must be fill-based
- Accessible name comes from visible text only; SVGs are `aria-hidden="true"` and purely decorative

**Hamburger SVG** (three filled rects, 16×16):
```html
<svg width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
  <rect y="2"  width="16" height="2" rx="1"/>
  <rect y="7"  width="16" height="2" rx="1"/>
  <rect y="12" width="16" height="2" rx="1"/>
</svg>
```

**Close SVG** (two crossed filled rects, 16×16):
```html
<svg width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
  <rect x="-1" y="7" width="18" height="2" rx="1" transform="rotate(45 8 8)"/>
  <rect x="-1" y="7" width="18" height="2" rx="1" transform="rotate(-45 8 8)"/>
</svg>
```
- Announced as e.g. *"Menu, button, collapsed"* / *"Close, button, expanded"*
- Changing the accessible name between "Menu" and "Close" on activation is expected behaviour. Some screen readers re-announce the name before the `aria-expanded` state change; this is acceptable and consistent with the pattern used by GOV.UK Design System and USWDS.

## Account Submenu

```html
<button type="button" aria-expanded="false" aria-controls="account-menu">
  {{ user.name }}
  <!-- chevron: fill-based downward-pointing triangle -->
  <svg class="chevron" width="0.75em" height="0.75em" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M2 5l6 6 6-6H2z"/>
  </svg>
</button>
<ul id="account-menu" role="list">
  <li><a href="/user/change_pwd">Change Password</a></li>
  {% if 'admin' in groups %}<li><a href="/user/new">Add User</a></li>{% endif %}
  <li><a href="/auth/logout">Logout</a></li>
</ul>
```

- Rendered only when a user session exists (`{% if user %}`); visible at all screen sizes
- Replaces `<details>`/`<summary>` from `2026-03-18-nav-design.md`
- `<ul id="account-menu">` immediately follows its trigger button in DOM order — focus order and reading order match
- `role="list"` added to `<ul id="account-menu">` for the same VoiceOver reason as above
- `is-open` is toggled directly on `<ul id="account-menu">` by JS; `display: none` applies when `is-open` is absent
- Account submenu contents are not in the tab sequence while closed
- The chevron SVG is a supplemental visual indicator of open/closed state. `aria-expanded` on the button is the primary state indicator; the chevron is decorative (`aria-hidden="true"`) and not required for accessible operation
- Chevron rotates 180° via CSS when `aria-expanded="true"` on the button
- Announced as e.g. *"Alice, button, collapsed"*

## JavaScript (`js/nav.js`)

- Plain JS, no dependencies, no inline scripts
- Loaded via `<script src="/js/nav.js" defer></script>` in `base.html`
- No route change needed — `main.rs` already serves all files under `js/` via `ServeDir`
- **Selector scope:** `header nav button[aria-expanded]` — covers both nav landmarks in the header while excluding any `aria-expanded` buttons outside the header
- **On click:** toggles `aria-expanded` between `"true"` and `"false"` on the button; uses the `aria-controls` value to find the controlled element and toggles an `is-open` CSS class on it
- **Escape key:** listener is on `document` (keydown). When Escape is pressed, all open menus in the header are closed (all `aria-expanded` set to `"false"`, all `is-open` removed) and focus returns to the hamburger button. This handles the edge case where both the primary nav and the Account submenu are open simultaneously on mobile — closing everything and returning focus to the outermost trigger is the simplest and most predictable behaviour.
- **No live region:** no `aria-live` announcement is made when menus open or close. The user remains on the trigger button and navigates forward — this is sufficient. Adding a live region would create a double announcement and is not recommended by the APG for disclosure patterns.
- `.is-open` is never present in server-rendered HTML (confirmed for `nav.html`; child templates of `base.html` do not override `{% block nav %}`)
- CSS handles all showing/hiding; JS only manages state and focus

### Why two mechanisms (`aria-expanded` and `is-open`)?

`aria-expanded` is on the button. CSS can target button children directly (`[aria-expanded="true"] .close-label`) — no extra class needed for label swapping or chevron rotation. CSS cannot select an element by its `aria-controls` target, so `is-open` is toggled on the controlled `<ul>` to show/hide it. One mechanism per location: `aria-expanded` drives button internals, `is-open` drives the controlled element.

## CSS Changes (`css/style.css`)

### Desktop (≥769px)

- Primary nav: `display: flex; flex-wrap: wrap; align-items: center` — horizontal row
- Reduced link padding: `0.5em 0.75em` (down from `1em 0`) — compact toolbar appearance
- Hamburger button: `display: none`

### Mobile (≤768px)

- Primary nav `<ul id="primary-nav-list">`: `display: none` by default; `display: flex; flex-direction: column` when `.is-open` present — full-width vertical list below the header
- Hamburger button: visible
- Each nav link: full-width row, minimum tap target 44×44px (WCAG 2.5.5)
- Account submenu `<ul id="account-menu">`: `display: none` by default; `display: block` when `.is-open` present (same behaviour as desktop)

### Button label swap

```css
.close-label { display: none; }
button[aria-expanded="true"] .menu-label { display: none; }
button[aria-expanded="true"] .close-label { display: inline-flex; align-items: center; gap: 0.4em; }
```

### Chevron rotation

```css
.chevron { transition: transform 0.2s ease; }
button[aria-expanded="true"] .chevron { transform: rotate(180deg); }
```

### Motion

After removing the Account `<details>`, `summary::after` in `style.css` still applies to `.pres-item summary` (presentation list items) — it is not dead code. As part of this work, narrow the existing `summary::after` rule to `.pres-item summary::after` to make the scope explicit. Update the `prefers-reduced-motion` block to cover the new chevron transition:

```css
@media (prefers-reduced-motion: reduce) {
  .pres-item summary::after,
  .chevron { transition: none; }
}
```

### Focus indicator

No general `:focus-visible` rule currently exists in `style.css` (only `.skip-link:focus` and `#qrToggle`). Add a baseline rule covering all interactive elements:

```css
:focus-visible {
  outline: 3px solid currentColor;
  outline-offset: 2px;
}
```

`currentColor` inherits the element's text colour, which already has high contrast against the page background in both themes (light: `--link-nav: #1a1a1a` on `--bg: #ffffff` ≈ 18:1; dark: `--link-nav: #ffffff` on `--bg: #222222` ≈ 16:1). Both exceed the WCAG 2.4.13 (AAA) 3:1 minimum by a wide margin.

### Contrast verification

Nav link and button text use `--link-nav` against `--bg` (header has no separate background). Verify both themes:

- Light: `#1a1a1a` on `#ffffff` ≈ 18:1 ✓ (AAA 7:1 required)
- Dark: `#ffffff` on `#222222` ≈ 16:1 ✓ (AAA 7:1 required)

Both pass. No additional colour changes needed.

## Tab and Reading Order

Focus does not move automatically when either menu opens or closes. The user stays on the activating button and navigates forward from there. Pressing Escape closes all open menus and returns focus to the hamburger button.

Note: the Account button's ordinal position in the tab sequence shifts depending on whether the primary nav links are visible. On mobile with the hamburger closed, the Account button is the second focusable element after the hamburger. With the hamburger open, it follows all the primary nav links. This is correct and expected — DOM order is consistent; only the visibility of the primary nav links changes.

### Mobile — menu closed (logged-out)
1. Skip link (visible on focus)
2. Menu button (`aria-expanded="false"`)
3. Dark mode toggle

### Mobile — menu closed (logged-in)
1. Skip link (visible on focus)
2. Menu button (`aria-expanded="false"`)
3. Account button — username (`aria-expanded="false"`) — Account nav is a separate landmark; always visible. Submenu contents hidden (`display: none`; not in tab sequence).
4. Dark mode toggle

### Mobile — menu open (logged-out)
1. Skip link (visible on focus)
2. Close button (`aria-expanded="true"`)
3. Home
4. Join presentation
5. Help
6. Login
7. Dark mode toggle

### Mobile — menu open (logged-in, non-admin)
1. Skip link (visible on focus)
2. Close button (`aria-expanded="true"`)
3. Home
4. Join presentation
5. Help
6. Create presentation
7. Presentations (N)
8. Account button — username (`aria-expanded`)
   - *(when open)* Change Password
   - *(when open)* Logout
9. Dark mode toggle

### Mobile — menu open (logged-in, admin)
Same as above, with Add User between Change Password and Logout.

### Desktop — logged-out
1. Skip link (visible on focus)
2. *(Primary navigation landmark)* Home
3. Join presentation
4. Help
5. Login
6. Dark mode toggle

### Desktop — logged-in, non-admin, Account submenu closed
1. Skip link (visible on focus)
2. *(Primary navigation landmark)* Home
3. Join presentation
4. Help
5. Create presentation
6. Presentations (N)
7. *(Account navigation landmark)* Account button — username (`aria-expanded="false"`)
8. Dark mode toggle

*(Account button now announces with deterministic `aria-expanded` state — an improvement over the previous `<details>/<summary>` announcement variance.)*

### Desktop — logged-in, non-admin, Account submenu open
1. Skip link (visible on focus)
2. *(Primary navigation landmark)* Home
3. Join presentation
4. Help
5. Create presentation
6. Presentations (N)
7. *(Account navigation landmark)* Account button — username (`aria-expanded="true"`)
8. Change Password
9. Logout
10. Dark mode toggle

*(Admin: Add User between Change Password and Logout.)*

### Desktop — logged-in, admin, Account submenu closed
Same as non-admin above, steps 1–8.

### Desktop — logged-in, admin, Account submenu open
Same as non-admin submenu-open, with Add User between Change Password (step 9) and Logout (step 10); Dark mode toggle shifts to step 11.

## Accessibility Notes

- WCAG 2.1 AAA target throughout
- `aria-expanded` + `aria-controls` is the APG-recommended pattern for disclosure navigation
- `type="button"` on all new `<button>` elements
- `role="list"` on all nav `<ul>` elements — required for VoiceOver to announce list semantics when `list-style: none` is applied
- No focus trapping — menus are not modal; users navigate forward from the trigger
- Escape closes all open menus and returns focus to hamburger button (document-level keydown listener; per APG Disclosure Navigation recommendation)
- No live region — disclosure patterns do not require one; adding one would cause double announcements
- Tap targets ≥44×44px on mobile (WCAG 2.5.5)
- SVG icons carry `aria-hidden="true"` — accessible names from visible text only; chevron is supplemental decoration
- All SVGs use `fill="currentColor"` only, no `stroke` — stroke-based SVGs proved unreliable in this codebase
- `:focus-visible` baseline rule added; `prefers-reduced-motion` respected for chevron transition
- Colour contrast verified: both themes exceed WCAG 1.4.6 (AAA) 7:1 requirement
- Pattern references: ARIA APG Disclosure Navigation Menu; GOV.UK Design System; USWDS

## Files Affected

| File | Change |
|------|--------|
| `templates/base.html` | Add `<script src="/js/nav.js" defer>` |
| `templates/nav.html` | Add hamburger `<button type="button" aria-expanded>` as first child of primary `<nav>`; add `id="primary-nav-list"` and `role="list"` to primary nav `<ul>`; replace `<details>`/`<summary>` on Account submenu with `<button type="button" aria-expanded>` + `<ul id="account-menu" role="list">` |
| `js/nav.js` | New file — disclosure toggle logic (hamburger + account submenu + Escape key) |
| `css/style.css` | Remove old 600px nav rules; narrow `summary::after` to `.pres-item summary::after`; update `prefers-reduced-motion` block; add `:focus-visible` baseline rule; add 768px mobile nav styles (hamburger show/hide, nav collapse, label swap, chevron rotation, tap targets); reduce desktop nav padding |
| `tests/nav.spec.js` (or equivalent) | Add/update Playwright tests for: hamburger toggle (`aria-expanded` state), keyboard toggle (Enter/Space), Escape key, focus return, Account submenu toggle, mobile breakpoint behaviour |

`main.rs` is not affected — `js/` is already served by the existing `ServeDir` handler.
