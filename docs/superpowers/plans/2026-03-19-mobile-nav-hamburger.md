# Mobile Nav Hamburger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hamburger toggle for the primary nav at mobile widths (≤768px) and replace the Account `<details>`/`<summary>` submenu with a `<button aria-expanded>` disclosure pattern at all widths.

**Architecture:** CSS drives all show/hide and label-swap logic via `aria-expanded` attribute selectors and an `is-open` class. A new `js/nav.js` file manages state (sets `aria-expanded`, toggles `is-open`) and handles Escape. `nav.html` adds the hamburger button and rewrites the Account submenu. `base.html` loads `nav.js`. No Rust changes — `ServeDir` already serves `js/`.

**Tech Stack:** Tera templates, plain JS (no framework, no dependencies), CSS, Playwright (tests run against VPS at `http://localhost:5003`)

---

## Deployment loop (no local server)

Every "deploy and run" step means:
1. `git push` to remote
2. SSH to `arch@clippycat.ca`, run `config/update.bat` (pulls, builds, reloads Caddy, restarts service)
3. From `tests/` on VPS: `npx playwright test`

This codebase never runs locally.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `tests/nav.spec.js` | Modify | Update 3 account-nav tests to use button locators; add hamburger, mobile viewport, keyboard, Escape, and `role="list"` tests |
| `tests/auth.spec.js` | Modify | Update 2 logout tests: replace `summary` locator with `button[aria-expanded]` |
| `css/style.css` | Modify | Remove old 600px nav rules; narrow `summary::after`; update `prefers-reduced-motion`; add `:focus-visible`; add desktop flex + reduced padding; add mobile 768px nav; add label-swap + chevron CSS; add account menu show/hide |
| `syncslide-websocket/templates/nav.html` | Modify | Add hamburger `<button aria-expanded>` as first child of primary nav; add `id="primary-nav-list"` + `role="list"` to primary nav `<ul>`; replace `<details>`/`<summary>` with `<button aria-expanded>` + `<ul id="account-menu" role="list">` |
| `syncslide-websocket/js/nav.js` | Create | Click handler toggles `aria-expanded` + `is-open`; Escape handler closes all open menus + returns focus to hamburger |
| `syncslide-websocket/templates/base.html` | Modify | Add `<script src="/js/nav.js" defer>` before `ext-links.js` |

---

## Task 1: Update and add Playwright tests (write first; they must fail before implementation)

**Files:**
- Modify: `tests/nav.spec.js`

The three existing account-nav tests use `locator('summary')`. After the template change these will fail if left unchanged. Update them now so they drive the new pattern. The new hamburger/mobile tests also fail until Tasks 2–4 are done.

- [ ] **Step 1: Update the three existing account-nav tests in `tests/nav.spec.js`**

Replace these three existing tests:

```js
test('account nav exists with username as disclosure trigger', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await expect(accountNav).toBeVisible();
    await expect(accountNav.locator('summary')).toContainText('admin');
});

test('account submenu reveals Change Password and Logout when opened', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await accountNav.locator('summary').click();
    await expect(accountNav.getByRole('link', { name: 'Change Password' })).toBeVisible();
    await expect(accountNav.getByRole('link', { name: 'Logout' })).toBeVisible();
});

test('account submenu reveals Add User link for admin users', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await accountNav.locator('summary').click();
    await expect(accountNav.getByRole('link', { name: 'Add User' })).toBeVisible();
});
```

With:

```js
test('account nav exists with username as disclosure trigger', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await expect(accountNav).toBeVisible();
    await expect(accountNav.locator('button[aria-expanded]')).toContainText('admin');
});

test('account submenu reveals Change Password and Logout when opened', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await accountNav.locator('button[aria-expanded]').click();
    await expect(accountNav.getByRole('link', { name: 'Change Password' })).toBeVisible();
    await expect(accountNav.getByRole('link', { name: 'Logout' })).toBeVisible();
});

test('account submenu reveals Add User link for admin users', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await accountNav.locator('button[aria-expanded]').click();
    await expect(accountNav.getByRole('link', { name: 'Add User' })).toBeVisible();
});
```

- [ ] **Step 2: Append the new tests to `tests/nav.spec.js`**

Add after the last existing test:

```js
// -- Hamburger: desktop --
test('hamburger button is not visible on desktop', async ({ page }) => {
    await page.goto('/');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await expect(hamburger).toBeHidden();
});

// -- Hamburger: mobile --
test('hamburger button is visible on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await expect(hamburger).toBeVisible();
});

test('primary nav links are hidden by default on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.locator('#primary-nav-list')).toBeHidden();
});

test('clicking hamburger shows primary nav links on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await hamburger.click();
    await expect(page.locator('#primary-nav-list')).toBeVisible();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
});

test('clicking hamburger again hides primary nav links on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await hamburger.click();
    await hamburger.click();
    await expect(page.locator('#primary-nav-list')).toBeHidden();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
});

// -- Keyboard: hamburger --
test('hamburger toggles with Enter key on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await hamburger.focus();
    await page.keyboard.press('Enter');
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
});

test('hamburger toggles with Space key on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await hamburger.focus();
    await page.keyboard.press('Space');
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
});

// -- Escape key --
test('Escape closes open hamburger menu and returns focus to hamburger', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await hamburger.click();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    await expect(hamburger).toBeFocused();
});

test('Escape closes open Account submenu', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountBtn = page.locator('nav[aria-label="Account"] button[aria-expanded]');
    await accountBtn.click();
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'false');
});

test('Escape on desktop does not move focus to hidden hamburger', async ({ page }) => {
    // Desktop viewport: hamburger is display:none. Escape from Account submenu
    // must not send focus to the hidden hamburger element — focus stays on Account button.
    await loginAsAdmin(page);
    await page.goto('/');
    const accountBtn = page.locator('nav[aria-label="Account"] button[aria-expanded]');
    await accountBtn.click();
    await page.keyboard.press('Escape');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await expect(hamburger).not.toBeFocused();
    await expect(accountBtn).toBeFocused();
});

test('Escape while Account submenu open on mobile returns focus to hamburger', async ({ page }) => {
    // On mobile, both menus are visible. Escape from the Account submenu (without
    // opening the primary nav) must still return focus to the hamburger — the
    // spec defines the hamburger as the outermost trigger for focus return.
    await loginAsAdmin(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const accountBtn = page.locator('nav[aria-label="Account"] button[aria-expanded]');
    const hamburger = page.locator('nav[aria-label="Primary navigation"] button[aria-expanded]');
    await accountBtn.click();
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(hamburger).toBeFocused();
});

// -- Account submenu: aria-expanded state --
test('account button has aria-expanded="false" when submenu is closed', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountBtn = page.locator('nav[aria-label="Account"] button[aria-expanded]');
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'false');
});

test('account button has aria-expanded="true" when submenu is open', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountBtn = page.locator('nav[aria-label="Account"] button[aria-expanded]');
    await accountBtn.click();
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'true');
});

test('account submenu links not in tab sequence when closed', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    await expect(page.locator('#account-menu')).toBeHidden();
});

// -- role="list" on nav ULs --
test('primary nav ul has role="list"', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#primary-nav-list')).toHaveAttribute('role', 'list');
});

test('account menu ul has role="list"', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    await expect(page.locator('#account-menu')).toHaveAttribute('role', 'list');
});
```

- [ ] **Step 3: Also update `tests/auth.spec.js` — logout tests use `summary` locator**

Find both occurrences of this pattern in `auth.spec.js`:
```js
await page.locator('nav[aria-label="Account"] summary').click();
await page.locator('nav[aria-label="Account"] a[href="/auth/logout"]').click();
```

Replace `summary` with `button[aria-expanded]` in both:
```js
await page.locator('nav[aria-label="Account"] button[aria-expanded]').click();
await page.locator('nav[aria-label="Account"] a[href="/auth/logout"]').click();
```

- [ ] **Step 4: Commit**

```bash
git add tests/nav.spec.js tests/auth.spec.js
git commit -m "test(nav): update account tests for button pattern; add hamburger, mobile, keyboard, Escape, role=list tests"
```

- [ ] **Step 5: Deploy and confirm the new/updated tests fail**

Push, deploy, run:
```bash
git push
# SSH to VPS, run config/update.bat
npx playwright test tests/nav.spec.js tests/auth.spec.js
```

Expected: the 3 updated account-nav tests and all new tests fail (template still has `<details>`/`<summary>`, no hamburger, no `nav.js`). The remaining nav tests and auth tests should still pass.

---

## Task 2: CSS changes

**Files:**
- Modify: `css/style.css`

All CSS changes in one commit. Safe to land before the template/JS — the new mobile rules have no effect without the matching HTML.

- [ ] **Step 1: Remove old 600px nav rules (keep the `body` rule)**

Find line 88:
```css
@media screen and (max-width: 600px) { body { width: 90%; } nav { text-align: left; width: 100%; } nav a { display: block; text-align: left; padding-left: 0; margin-left: 0; } }
```

Replace with:
```css
@media screen and (max-width: 600px) { body { width: 90%; } }
```

- [ ] **Step 2: Add `:focus-visible` baseline rule after the `.skip-link:focus` rule (around line 42)**

After:
```css
.skip-link:focus { position: static; width: auto; height: auto; margin: 0; overflow: visible; clip: auto; white-space: normal; }
```

Add:
```css
:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
```

- [ ] **Step 3: Narrow `summary::after` to `.pres-item summary::after` and update `prefers-reduced-motion`**

Find:
```css
summary { cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
summary::after { content: ""; display: inline-block; width: 0; height: 0; border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-left: 6px solid currentColor; flex-shrink: 0; margin-left: .5em; transition: transform .15s; }
details[open] > summary::after { transform: rotate(90deg); }
@media (prefers-reduced-motion: reduce) { summary::after { transition: none; } }
```

Replace with:
```css
summary { cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
.pres-item summary::after { content: ""; display: inline-block; width: 0; height: 0; border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-left: 6px solid currentColor; flex-shrink: 0; margin-left: .5em; transition: transform .15s; }
.pres-item details[open] > summary::after { transform: rotate(90deg); }
@media (prefers-reduced-motion: reduce) { .pres-item summary::after, .chevron { transition: none; } }
```

- [ ] **Step 4: Add new nav rules before the `/* external link indicator */` comment (around line 110)**

Insert this block immediately before `/* external link indicator */`:

```css
/* nav: desktop (≥769px) */
@media screen and (min-width: 769px) {
  nav[aria-label="Primary navigation"] ul { display: flex; flex-wrap: wrap; align-items: center; }
  nav[aria-label="Primary navigation"] a { padding: 0.5em 0.75em; }
  nav[aria-label="Primary navigation"] button[aria-expanded] { display: none; }
}

/* nav: mobile (≤768px) */
@media screen and (max-width: 768px) {
  nav[aria-label="Primary navigation"] button[aria-expanded] { display: inline-flex; align-items: center; gap: 0.4em; }
  #primary-nav-list { display: none; }
  #primary-nav-list.is-open { display: flex; flex-direction: column; width: 100%; }
  #primary-nav-list a { display: block; width: 100%; min-height: 44px; line-height: 44px; box-sizing: border-box; }
}

/* account submenu: hidden until toggled */
#account-menu { display: none; }
#account-menu.is-open { display: block; }

/* hamburger: label swap driven by aria-expanded on the button */
.close-label { display: none; }
button[aria-expanded="true"] .menu-label { display: none; }
button[aria-expanded="true"] .close-label { display: inline-flex; align-items: center; gap: 0.4em; }

/* chevron: rotates when account button is expanded */
.chevron { transition: transform 0.2s ease; }
button[aria-expanded="true"] .chevron { transform: rotate(180deg); }
```

- [ ] **Step 5: Commit**

```bash
git add css/style.css
git commit -m "style(nav): 768px mobile breakpoint, hamburger label-swap, chevron, focus-visible, remove old 600px nav rules"
```

---

## Task 3: Update `nav.html`

**Files:**
- Modify: `syncslide-websocket/templates/nav.html`

Replace the entire file. This adds the hamburger button, updates the primary nav `<ul>`, and rewrites the Account submenu.

- [ ] **Step 1: Replace `nav.html` with the following**

```html
{% extends "base.html" %}
{% block nav %}
<nav aria-label="Primary navigation">
<button type="button" aria-expanded="false" aria-controls="primary-nav-list">
  <span class="menu-label">
    <svg width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect y="2"  width="16" height="2" rx="1"/>
      <rect y="7"  width="16" height="2" rx="1"/>
      <rect y="12" width="16" height="2" rx="1"/>
    </svg>
    Menu
  </span>
  <span class="close-label">
    <svg width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="-1" y="7" width="18" height="2" rx="1" transform="rotate(45 8 8)"/>
      <rect x="-1" y="7" width="18" height="2" rx="1" transform="rotate(-45 8 8)"/>
    </svg>
    Close
  </span>
</button>
<ul id="primary-nav-list" class="clear-list" role="list">
<li><a href="/">Home</a></li>
<li><a href="/join">Join presentation</a></li>
<li><a href="/help">Help</a></li>
{% if user %}
<li><a href="/create">Create presentation</a></li>
<li><a href="/user/presentations">Presentations ({{ pres_num }})</a></li>
{% else %}
<li><a href="/auth/login">Login</a></li>
{% endif %}
</ul>
</nav>
{% if user %}
<nav aria-label="Account">
<button type="button" aria-expanded="false" aria-controls="account-menu">
  {{ user.name }}
  <svg class="chevron" width="0.75em" height="0.75em" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M2 5l6 6 6-6H2z"/>
  </svg>
</button>
<ul id="account-menu" role="list">
<li><a href="/user/change_pwd">Change Password</a></li>
{% if 'admin' in groups %}<li><a href="/user/new">Add User</a></li>{% endif %}
<li><a href="/auth/logout">Logout</a></li>
</ul>
</nav>
{% endif %}
<button type="button" id="theme-toggle" aria-pressed="false">Dark mode</button>
{% endblock nav %}

{% block footer %}
<footer>
<ul class ="clear-list">
<li><a href="/demo">Demo</a></li>
<li><a href="https://github.com/ClippyCat/syncslide/">SyncSlide on github</a></li>
</ul>
</footer>
{% endblock footer %}
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/templates/nav.html
git commit -m "feat(nav): add hamburger button; replace account details/summary with button aria-expanded pattern"
```

---

## Task 4: Create `js/nav.js`

**Files:**
- Create: `syncslide-websocket/js/nav.js`

- [ ] **Step 1: Create the file**

```js
(function () {
  'use strict';

  var headerBtnSelector = 'header nav button[aria-expanded]';

  function closeAll() {
    document.querySelectorAll(headerBtnSelector).forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
      var controlled = document.getElementById(btn.getAttribute('aria-controls'));
      if (controlled) { controlled.classList.remove('is-open'); }
    });
  }

  function toggle(btn) {
    var expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    var controlled = document.getElementById(btn.getAttribute('aria-controls'));
    if (controlled) { controlled.classList.toggle('is-open', !expanded); }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest(headerBtnSelector);
    if (btn) { toggle(btn); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') { return; }
    var hamburger = document.querySelector(
      'nav[aria-label="Primary navigation"] button[aria-expanded]'
    );
    closeAll();
    // Only focus the hamburger if it is visible (mobile). On desktop it is
    // display:none; sending focus there would move focus to a hidden element.
    if (hamburger && hamburger.offsetParent !== null) { hamburger.focus(); }
  });
}());
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/js/nav.js
git commit -m "feat(nav): add nav.js — hamburger and account submenu toggle with Escape key support"
```

---

## Task 5: Add script tag to `base.html`

**Files:**
- Modify: `syncslide-websocket/templates/base.html`

- [ ] **Step 1: Add `nav.js` `<script>` tag**

Find:
```html
<script src="/js/ext-links.js" defer></script>
<script src="/js/theme.js" defer></script>
```

Replace with:
```html
<script src="/js/nav.js" defer></script>
<script src="/js/ext-links.js" defer></script>
<script src="/js/theme.js" defer></script>
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/templates/base.html
git commit -m "feat(nav): load nav.js in base.html"
```

---

## Task 6: Deploy and verify all tests pass

- [ ] **Step 1: Push all commits**

```bash
git push
```

- [ ] **Step 2: Deploy on VPS**

SSH to `arch@clippycat.ca`, run:
```
config/update.bat
```

Expected: Rust build succeeds, Caddy reloads, service restarts cleanly.

- [ ] **Step 3: Run the full test suite**

From `tests/` on VPS:
```bash
npx playwright test
```

Expected: all tests pass. Existing 47 Playwright tests plus the new nav and hamburger tests.

- [ ] **Step 4: Diagnose any failures before retrying**

Do not re-run until you have read the failure output and identified the cause.

| Symptom | Likely cause |
|---------|-------------|
| Account button test fails "not found" | Template still has old `<details>` — check `nav.html` was saved and pushed |
| `#primary-nav-list` not found | Missing `id` attribute on `<ul>` in `nav.html` |
| Hamburger not hidden on desktop | Missing `display: none` in the `min-width: 769px` media query |
| Mobile nav links still visible | `#primary-nav-list { display: none }` missing from mobile CSS, or `is-open` class not being removed |
| Escape test: focus not returned | `hamburger.focus()` in `closeAll` — check `nav.js` was created and loaded |
| `role="list"` test fails | Missing `role="list"` attribute on `<ul>` in `nav.html` |
| Auth logout test fails | `auth.spec.js` still using old `summary` locator — check Task 1 Step 3 |
| Pres-item chevron stops rotating | CSS selector wrong — must be `.pres-item details[open] > summary::after`, not `details[open] > .pres-item summary::after` |
