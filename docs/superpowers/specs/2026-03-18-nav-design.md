# Nav Menu Structure — Design Spec

**Date:** 2026-03-18
**Status:** Approved

## Summary

Restructure the site navigation to improve reading/tab order, add a skip link, and group account management links into a dedicated landmark with a disclosure submenu.

## Header Reading/Tab Order

```
[skip link: "Skip to main content" → #main]
<nav aria-label="Primary navigation">
  Home
  Join presentation
  Help
  [if logged in] Create presentation
  [if logged in] Presentations (N)
  [if logged out] Login
</nav>
<nav aria-label="Account">   ← logged-in users only
  <details>
    <summary>{username}</summary>
    <ul>
      <li>Change Password</li>
      [if admin] <li>Add User</li>
      <li>Logout</li>
    </ul>
  </details>
</nav>
<button id="theme-toggle" aria-pressed="false">Dark mode</button>
```

## Skip Link

- First element inside `<body>`, before `<header>`
- Visually hidden by default; becomes visible on focus
- Points to `id="main"` on the `<main>` element
- `<main id="main">` moves to `base.html` wrapping `{% block content %}`, guaranteeing the target always exists
- Individual templates must remove their own `<main>` wrapper tags — `base.html` now provides it

## Primary Navigation (`nav.html`)

### Logged-out tab sequence
1. Home
2. Join presentation
3. Help
4. Login

### Logged-in tab sequence
1. Home
2. Join presentation
3. Help
4. Create presentation
5. Presentations (N)
6. {username} (disclosure trigger — opens account submenu)
   - Change Password
   - Add User *(admin only)*
   - Logout
7. Dark mode toggle

## Account Navigation

- Rendered only when a user session exists
- Uses `<details>`/`<summary>` for the disclosure; no JavaScript required
- `<summary>` text is the logged-in username pulled from the session context variable
- Announcement varies across screen readers (NVDA/JAWS/VoiceOver may say "collapsed/expanded" or "button") — this is a known trade-off; if testing reveals problems, the `<details>` can be replaced with a `<button aria-expanded>` disclosure button inside the same `<nav>` landmark without changing the surrounding structure

## Accessibility Notes

- WCAG 2.1 AAA target throughout
- Two navigation landmarks on every logged-in page: "Primary navigation" and "Account" — screen readers can jump between landmarks via the landmark rotor
- Skip link satisfies WCAG 2.4.1 (Bypass Blocks)
- `<details>`/`<summary>` is an HTML-native disclosure; no ARIA roles required on the widget itself
- Theme toggle remains in the header tab sequence after both nav landmarks

## Files Affected

| File | Change |
|------|--------|
| `templates/base.html` | Add skip link before `<header>`; add `<main id="main">` wrapping `{% block content %}` |
| `templates/nav.html` | Reorder links; add Account `<nav>` with `<details>` submenu |
| `templates/index.html` | Remove `<main>` wrapper (now in base) |
| `templates/audience.html` | Remove `<main>` wrapper (now in base) |
| `templates/help.html` | Remove `<main>` wrapper if present |
| `templates/create.html` | Remove `<main>` wrapper if present |
| `templates/presentations.html` | Remove `<main>` wrapper if present |
| `templates/join.html` | Remove `<main>` wrapper if present |
| `templates/login.html` | Remove `<main>` wrapper if present |
| `templates/recording.html` | Remove `<main>` wrapper if present |
| `templates/user/change_pwd.html` | Remove `<main>` wrapper if present |
| `templates/user/add_user.html` | Remove `<main>` wrapper if present |
