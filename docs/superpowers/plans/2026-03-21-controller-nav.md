# Controller Slide Navigation & Canonical URL Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the controller role a working slide-navigation UI, and ensure every `/{uname}/{pid}` URL redirects to the canonical owner URL before serving any template.

**Architecture:** Three independent changes applied in order: (1) backend redirect + stage pres_user fix, (2) shared JS and template infrastructure extracted from stage, (3) controller template wired up and route updated.

**Tech Stack:** Rust/Axum, Tera templates, SQLx (SQLite), vanilla JS (no build step)

---

## File Map

| File | Change |
|------|--------|
| `syncslide-websocket/src/db.rs` | Add `User::get_by_id` |
| `syncslide-websocket/src/main.rs` | `present()` redirect, `stage()` pres_user param, tests |
| `syncslide-websocket/templates/stage.html` | Use `_slide_nav.html` include, fix QR username, update js block |
| `syncslide-websocket/templates/_slide_nav.html` | **New** — slide nav partial |
| `syncslide-websocket/templates/controller.html` | **New** — controller template |
| `syncslide-websocket/js/slide-nav.js` | **New** — extracted from handlers.js |
| `syncslide-websocket/js/handlers.js` | Remove slide-nav code (getH2s, updateSlide, goTo wiring, F8 key) |
| `syncslide-websocket/js/audience.js` | Remove unused `isStage()` |

---

## Task 1: Canonical URL Redirect + Stage pres_user Fix

**Files:**
- Modify: `syncslide-websocket/src/db.rs`
- Modify: `syncslide-websocket/src/main.rs`
- Modify: `syncslide-websocket/templates/stage.html`

- [ ] **Step 1: Write the failing redirect test**

  Add inside the `#[cfg(test)]` mod in `main.rs`:

  ```rust
  /// GET /{editor_name}/{pid} must redirect 301 to /{owner_name}/{pid}.
  #[tokio::test]
  async fn non_owner_uname_redirects_to_canonical_url() {
      let (server, state) = test_server().await;
      seed_user(&state.db_pool).await;
      let owner_uid = get_user_id("admin", &state.db_pool).await;
      let pid = seed_presentation(owner_uid, "Canon Test", &state.db_pool).await;
      let editor_uid = get_user_id("testuser", &state.db_pool).await;
      PresentationAccess::add(&state.db_pool, pid, editor_uid, "editor").await.unwrap();
      login_as(&server, "testuser", "testpass").await;

      let response = server.get(&format!("/testuser/{pid}")).await;

      assert_eq!(response.status_code(), 301);
      let location = response.headers()["location"].to_str().unwrap();
      assert_eq!(location, &format!("/admin/{pid}"));
  }

  /// GET /{wrong_name}/{pid}?pwd=x must redirect to /{owner_name}/{pid}?pwd=x.
  #[tokio::test]
  async fn canonical_redirect_preserves_pwd_param() {
      let (server, state) = test_server().await;
      seed_user(&state.db_pool).await;
      let owner_uid = get_user_id("admin", &state.db_pool).await;
      let pid = seed_presentation(owner_uid, "Pwd Redirect Test", &state.db_pool).await;

      let response = server.get(&format!("/testuser/{pid}?pwd=secret")).await;

      assert_eq!(response.status_code(), 301);
      let location = response.headers()["location"].to_str().unwrap();
      assert_eq!(location, &format!("/admin/{pid}?pwd=secret"));
  }

  /// GET /{nonexistent_name}/{pid} must still return generic audience (no change).
  #[tokio::test]
  async fn nonexistent_uname_returns_audience() {
      let (server, state) = test_server().await;
      let owner_uid = get_user_id("admin", &state.db_pool).await;
      let pid = seed_presentation(owner_uid, "Uname Test", &state.db_pool).await;

      let response = server.get(&format!("/nobody/{pid}")).await;

      assert_eq!(response.status_code(), 200);
  }
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Deploy to VPS and run:
  ```
  cargo test non_owner_uname_redirects_to_canonical_url canonical_redirect_preserves_pwd_param -- --nocapture
  ```
  Expected: FAIL — current code does not redirect.

- [ ] **Step 3: Add `User::get_by_id` to db.rs**

  In `syncslide-websocket/src/db.rs`, add this method to the `User` impl block (alongside `get_by_name`). Use the non-macro form to avoid needing a sqlx prepare run:

  ```rust
  pub async fn get_by_id(id: i64, db: &SqlitePool) -> Result<Option<Self>, Error> {
      sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = ?;")
          .bind(id)
          .fetch_optional(db)
          .await
          .map_err(Error::from)
  }
  ```

- [ ] **Step 4: Add the ownership redirect in `present()`**

  In `syncslide-websocket/src/main.rs`, in `present()`, insert this block after `pres` is resolved (after the `Ok(None) => return audience(...)` line for pres, before `let access = ...`):

  ```rust
  if pres.user_id != pres_user.id {
      let Ok(Some(owner)) = User::get_by_id(pres.user_id, &db).await else {
          return StatusCode::INTERNAL_SERVER_ERROR.into_response();
      };
      let redirect = if let Some(ref pwd) = query.pwd {
          format!("/{}/{pid}?pwd={}", owner.name, urlencoding::encode(pwd))
      } else {
          format!("/{}/{pid}", owner.name)
      };
      return Redirect::to(&redirect).into_response();
  }
  ```

  (`urlencoding` is already a dependency — it is used in `join_password_submit`.)

- [ ] **Step 5: Pass `pres_user` into `stage()` and insert into context**

  In `main.rs`, update the `stage` function signature to accept `pres_user`:

  ```rust
  async fn stage(
      tera: Tera,
      db: SqlitePool,
      auth_session: AuthSession,
      pid: i64,
      app_state: AppState,
      pres_user: User,
  ) -> impl IntoResponse {
  ```

  Inside the function body, add:
  ```rust
  ctx.insert("pres_user", &pres_user);
  ```

  Update the call site in `present()` (the `Owner | Editor` branch):
  ```rust
  AccessResult::Owner | AccessResult::Editor => {
      stage(tera, db, auth_session, pid, app_state, pres_user).await.into_response()
  }
  ```

- [ ] **Step 6: Fix the QR URL in `stage.html`**

  In `syncslide-websocket/templates/stage.html`, inside `{% block stage %}`, find the QR anchor and image (lines 8–10). Change both occurrences of `{{ user.name }}` to `{{ pres_user.name }}`:

  Before:
  ```html
  <a href="/{{ user.name }}/{{ pres.id }}"><img src="/qr/{{ user.name }}/{{ pres.id }}" alt="{{ pres.name }} QR code" width="150" height="150"></a>
  ```
  After:
  ```html
  <a href="/{{ pres_user.name }}/{{ pres.id }}"><img src="/qr/{{ pres_user.name }}/{{ pres.id }}" alt="{{ pres.name }} QR code" width="150" height="150"></a>
  ```

- [ ] **Step 7: Run all tests to verify they pass**

  ```
  cargo test
  ```
  Expected: all tests pass including the two new redirect tests.

- [ ] **Step 8: Commit**

  ```bash
  git add syncslide-websocket/src/db.rs syncslide-websocket/src/main.rs syncslide-websocket/templates/stage.html
  git commit -m "feat: redirect non-canonical presentation URLs to owner's URL"
  ```

---

## Task 2: Extract Slide-Nav Infrastructure

**Files:**
- Create: `syncslide-websocket/js/slide-nav.js`
- Modify: `syncslide-websocket/js/handlers.js`
- Create: `syncslide-websocket/templates/_slide_nav.html`
- Modify: `syncslide-websocket/templates/stage.html`

No new tests — existing tests verify the refactor did not break anything.

- [ ] **Step 1: Create `slide-nav.js`**

  Create `syncslide-websocket/js/slide-nav.js` with the following content (extracted from `handlers.js` lines 1–21 and 56–71, with `onCommit(goTo, updateSlide)` replaced by a direct `addEventListener`):

  ```js
  function getH2s(allHtml) {
  	const goTo = document.getElementById("goTo");
  	const oldSelection = goTo.value;
  	goTo.innerHTML = "";
  	const h2s = allHtml.querySelectorAll('h2');
  	for (const [i, e] of h2s.entries()) {
  		const newOption = document.createElement('option');
  		if (i == oldSelection) {
  			newOption.selected = true;
  		}
  		newOption.value = i;
  		newOption.innerText = (i+1) + ": " + e.innerText;
  		goTo.appendChild(newOption);
  	}
  }

  const updateSlide = async () => {
  	const slideChoice = document.getElementById("goTo").value;
  	socket.send(JSON.stringify({ type: "slide", data: Number(slideChoice) }));
  }

  // For a SELECT, onCommit (defined in handlers.js) is exactly addEventListener('input', fn).
  // Using addEventListener directly here avoids a cross-file dependency.
  const goTo = document.getElementById("goTo");
  goTo.addEventListener('input', updateSlide);

  document.addEventListener("keydown", (e) => {
  	if (e.key !== "F8") return;
  	e.preventDefault();
  	const goTo = document.getElementById("goTo");
  	const current = Number(goTo.value);
  	const max = goTo.options.length - 1;
  	if (e.shiftKey) {
  		if (current > 0) goTo.value = current - 1;
  	} else {
  		if (current < max) goTo.value = current + 1;
  	}
  	updateSlide();
  });
  ```

  Note: `socket` is defined in `common.js` which loads before this file.

- [ ] **Step 2: Remove extracted code from `handlers.js`**

  In `syncslide-websocket/js/handlers.js`, delete:
  - Lines 1–21: the `getH2s` function and `updateSlide` function
  - Lines 56–57: `const goTo = document.getElementById("goTo");` and `onCommit(goTo, updateSlide);`
  - Lines 59–71: the `document.addEventListener("keydown", ...)` block for F8

  After removal, `handlers.js` should start with `let lastSentMarkdown = null;` and contain only editing-related code.

- [ ] **Step 3: Create `_slide_nav.html`**

  Create `syncslide-websocket/templates/_slide_nav.html`:

  ```html
  <nav aria-label="Slide Navigation">
  <label for="goTo">Go to slide:</label>
  <select id="goTo" name="goTo"></select>
  </nav>
  ```

- [ ] **Step 4: Update `stage.html` — replace inline nav and update js block**

  In `syncslide-websocket/templates/stage.html`:

  Replace the inline nav block (currently lines 38–41):
  ```html
  <nav aria-label="Slide Navigation">
  <label for="goTo">Go to slide:</label>
  <select id="goTo" name="goTo"></select>
  </nav>
  ```
  With:
  ```html
  {% include "_slide_nav.html" %}
  ```

  Replace the `{% block js %}` line (currently line 3):
  ```
  {% block js %}{{ super() }}<script defer="defer" src="/js/handlers.js"></script>{% endblock js %}
  ```
  With (`slide-nav.js` must come before `handlers.js`):
  ```
  {% block js %}{{ super() }}<script defer="defer" src="/js/slide-nav.js"></script><script defer="defer" src="/js/handlers.js"></script>{% endblock js %}
  ```

- [ ] **Step 5: Run all tests to verify the refactor did not break anything**

  ```
  cargo test
  ```
  Expected: all tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add syncslide-websocket/js/slide-nav.js syncslide-websocket/js/handlers.js syncslide-websocket/templates/_slide_nav.html syncslide-websocket/templates/stage.html
  git commit -m "refactor: extract slide-nav.js and _slide_nav.html from stage"
  ```

---

## Task 3: Controller Template, Route Update, and Cleanup

**Files:**
- Create: `syncslide-websocket/templates/controller.html`
- Modify: `syncslide-websocket/src/main.rs`
- Modify: `syncslide-websocket/js/audience.js`

- [ ] **Step 1: Update the existing `controller_gets_audience_not_stage` test**

  In `main.rs`, find the test `controller_gets_audience_not_stage`. Update its assertions to:

  ```rust
  assert_eq!(response.status_code(), 200);
  assert!(
      response.text().contains(r#"id="goTo""#),
      "controller must see the slide navigation select"
  );
  assert!(
      !response.text().contains("markdown-input"),
      "controller must not see the stage textarea"
  );
  ```

- [ ] **Step 2: Run the updated test to verify it currently fails**

  ```
  cargo test controller_gets_audience_not_stage -- --nocapture
  ```
  Expected: FAIL — `id="goTo"` is not in the current audience.html response.

- [ ] **Step 3: Create `controller.html`**

  Create `syncslide-websocket/templates/controller.html`:

  ```html
  {% extends "audience.html" %}
  {% block title %}{{ pres.name }} (controller){% endblock title %}
  {% block js %}
  <script defer="defer" src="/js/remarkable.js"></script>
  <script defer="defer" src="/js/katex.js"></script>
  <script defer="defer" src="/js/auto-render.js"></script>
  <script defer="defer" src="/js/render-a11y-string.js"></script>
  <script defer="defer" src="/js/common.js"></script>
  <script defer="defer" src="/js/audience.js"></script>
  <script defer="defer" src="/js/slide-nav.js"></script>
  <link rel="stylesheet" href="/css/katex.css">
  {% endblock js %}
  {% block stage %}
  {% include "_slide_nav.html" %}
  {% endblock stage %}
  ```

  Note: `{% block js %}` is overridden completely (no `{{ super() }}`) to exclude `recording.js` (which crashes when its expected elements are absent) and `handlers.js` (editing only). `defer="defer"` is used throughout to match the existing codebase style (`audience.html`, `stage.html`).

- [ ] **Step 4: Update the route to serve `controller.html`**

  In `main.rs`, find the `_ =>` branch in `present()` (currently around line 462, comment says "Controller — serve audience view"). Change `"audience.html"` to `"controller.html"`:

  Before:
  ```rust
  _ => {
      // Controller — serve audience view
      let slide_index = current_slide_index(&app_state, pid);
      let initial_slide = render_slide(&pres.content, slide_index, &pres.name);
      let mut ctx = Context::new();
      ctx.insert("pres", &pres);
      ctx.insert("pres_user", &pres_user);
      ctx.insert("initial_slide", &initial_slide);
      tera.render("audience.html", ctx, auth_session, db).await.into_response()
  }
  ```
  After:
  ```rust
  _ => {
      // Controller — serve controller view (slide nav only)
      let slide_index = current_slide_index(&app_state, pid);
      let initial_slide = render_slide(&pres.content, slide_index, &pres.name);
      let mut ctx = Context::new();
      ctx.insert("pres", &pres);
      ctx.insert("pres_user", &pres_user);
      ctx.insert("initial_slide", &initial_slide);
      tera.render("controller.html", ctx, auth_session, db).await.into_response()
  }
  ```

- [ ] **Step 5: Remove `isStage()` from `audience.js`**

  In `syncslide-websocket/js/audience.js`, delete the unused `isStage` function (lines 15–17):

  ```js
  function isStage() {
  	return document.getElementById("goTo") !== null
  }
  ```

- [ ] **Step 6: Run all tests to verify they pass**

  ```
  cargo test
  ```
  Expected: all tests pass including the updated `controller_gets_audience_not_stage`.

- [ ] **Step 7: Commit**

  ```bash
  git add syncslide-websocket/templates/controller.html syncslide-websocket/src/main.rs syncslide-websocket/js/audience.js
  git commit -m "feat: add controller template with slide navigation"
  ```

---

## Deploy

Push and deploy:
```
git push
```
Then on the VPS run `config/update.bat` (or equivalent) to pull, build, and restart.
