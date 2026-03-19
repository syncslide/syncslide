# Mobile Nav Hamburger — Design Spec

**Date:** 2026-03-19
**Status:** Approved

## Summary

Add a hamburger toggle to the primary navigation at mobile widths (≤768px), and replace the Account `<details>`/`<summary>` submenu with a `<button aria-expanded>` disclosure pattern at all widths. Desktop nav (≥769px) keeps inline links unchanged except for reduced padding.

## Scope

This spec builds on the nav structure defined in `2026-03-18-nav-design.md`. The landmark structure, link order, skip link, and `<main id="main">` are all unchanged. This spec covers only the toggle behaviour, the hamburger button, and the Account submenu pattern change.

## Breakpoint

- **≥769px (desktop):** Primary nav links always visible as a horizontal inline row. Hamburger button hidden.
- **≤768px (mobile):** Primary nav links hidden by default. Hamburger button visible. Links revealed below the header on toggle.

## Hamburger Button

- Element: `<button aria-expanded="false" aria-controls="primary-nav">`
- Visible only at ≤768px via CSS
- Contains two child spans, swapped via CSS based on `aria-expanded`:
  - **Closed state:** inline SVG (three horizontal lines) + text "Menu"
  - **Open state:** inline SVG (✕) + text "Close"
- Both SVGs carry `aria-hidden="true"`; the accessible name comes from the visible text
- Announced by screen readers as e.g. *"Menu, button, collapsed"* / *"Close, button, expanded"*

## Account Submenu

- Replaces `<details>`/`<summary>` from the previous nav spec at all screen sizes
- Element: `<button aria-expanded="false" aria-controls="account-menu">{{ user.name }}</button>`
- A chevron SVG inside the button indicates open/closed state via CSS rotation (`transform: rotate(180deg)` when expanded); chevron carries `aria-hidden="true"`
- Controlled element: `<ul id="account-menu">` containing Change Password, (Add User if admin), Logout
- Announced as e.g. *"Alice, button, collapsed"*

## JavaScript (`js/nav.js`)

- Plain JS, no dependencies, no inline scripts
- Loaded via `<script src="/js/nav.js" defer></script>` in `base.html`
- Finds all `<button[aria-expanded]>` elements within `<nav>` landmarks
- On click: toggles `aria-expanded` between `"true"` and `"false"`; uses `aria-controls` value to find the controlled element and toggles a `is-open` CSS class on it
- CSS handles all showing/hiding based on `aria-expanded` and `is-open`; JS only manages state

## CSS Changes (`css/style.css`)

### Desktop (≥769px)

- Primary nav links: `display: flex; flex-wrap: wrap` — horizontal row
- Reduced link padding: `0.5em 0.75em` (down from `1em 0`) — compact toolbar appearance
- Hamburger button: `display: none`

### Mobile (≤768px)

- Primary nav links: `display: none` by default; `display: flex; flex-direction: column` when `is-open` class present — full-width vertical list
- Hamburger button: visible
- Each nav link: full-width row, generous tap target (minimum 44×44px per WCAG 2.5.5)

### Button label swap (both sizes)

- Inside hamburger button: `.menu-label` visible by default, `.close-label` hidden; swapped when `[aria-expanded="true"]`
- Inside Account button: chevron SVG rotated 180deg when `[aria-expanded="true"]`

## Tab and Reading Order

Focus does not move automatically when either menu opens or closes. The user stays on the activating button and navigates forward from there.

### Mobile — menu closed
1. Skip link (visible on focus)
2. Menu button (`aria-expanded="false"`)
3. Dark mode toggle

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
8. Account button (`aria-expanded`) — username
   - *(when open)* Change Password
   - *(when open)* Logout
9. Dark mode toggle

### Mobile — menu open (logged-in, admin)
Same as above, with Add User between Change Password and Logout.

### Desktop tab order
Unchanged from `2026-03-18-nav-design.md`.

## Accessibility Notes

- WCAG 2.1 AAA target throughout
- `aria-expanded` + `aria-controls` is the APG-recommended pattern for disclosure navigation
- No focus trapping — menus are not modal; users navigate forward from the trigger
- Tap targets ≥44×44px on mobile (WCAG 2.5.5)
- SVG icons carry `aria-hidden="true"` — accessible names from visible text only
- Pattern reference: GOV.UK Design System disclosure navigation; ARIA APG Disclosure Navigation Menu

## Files Affected

| File | Change |
|------|--------|
| `templates/base.html` | Add `<script src="/js/nav.js" defer>` |
| `templates/nav.html` | Add hamburger `<button aria-expanded>` (mobile); replace `<details>`/`<summary>` on Account submenu with `<button aria-expanded>` |
| `js/nav.js` | New file — disclosure toggle logic |
| `css/style.css` | Add mobile nav styles (breakpoint, hamburger show/hide, label swap, tap targets); reduce desktop nav padding |
