//! `syncslide-websocket`
//!
//! Runs the backend of the `SyncSlide` project.
//!
//! Handles live web-sockets (updating of slides live), as well as templated-HTML for most pages.
//!
#![deny(clippy::all, clippy::pedantic, rustdoc::all, unsafe_code, missing_docs)]

use qrcode::{QrCode, render::svg};
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use axum::{
    Form, Router,
    body::Body,
    extract::{
        DefaultBodyLimit, FromRef, Multipart, Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
};
use axum_login::{AuthManagerLayerBuilder, AuthzBackend};
use futures_lite::future::or;
use futures_util::{SinkExt, StreamExt};
use sqlx::SqlitePool;
use sqlx::sqlite::SqliteConnectOptions;
use std::str::FromStr;
use tera::{Context, Tera as TeraBase};
use time::Duration;
use tower_http::services::ServeDir;
use tower_sessions::{Expiry, SessionManagerLayer};
use tower_sessions_sqlx_store::SqliteStore;

use tokio::sync::broadcast::{self, Receiver, Sender};

use serde::{Deserialize, Serialize};

use signal_hook::consts::signal::SIGUSR1;
use signal_hook_tokio::Signals;

use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, html as cmark_html};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

mod db;
use db::{
    check_access, AccessResult, AddUserForm, AuthSession, Backend, ChangePasswordForm, Group,
    LoginForm, Presentation as DbPresentation, PresentationAccess, Recording, RecordingSlide,
    RecordingSlideInput, User,
};

/// Wraps Tera renderer so that we can force a special render process.
#[derive(Clone)]
pub struct Tera {
    tera: Arc<TeraBase>,
}
impl Tera {
    fn new() -> Self {
        Tera {
            tera: Arc::new(TeraBase::new("templates/**/*.html").unwrap()),
        }
    }
    /// Used to render Tera templates w/ additional automatic variables defined on every page.
    async fn render(
        &self,
        name: &'static str,
        mut ctx: Context,
        auth_session: AuthSession,
        _db: SqlitePool,
    ) -> Response<Body> {
        if let Some(ref user) = auth_session.user {
            ctx.insert("user", &user);
            let groups = auth_session
                .backend
                .get_user_permissions(user)
                .await
                .unwrap();
            ctx.insert("groups", &groups);
        }
        let html = self.tera.render(name, &ctx).unwrap();
        Html(html).into_response()
    }
}

/// A message indicating a _change_ in [`Presentation`] state.
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
#[serde(rename_all = "lowercase")]
pub enum SlideMessage {
    /// Change the `content` field of the presentation.
    Text(String),
    /// Change the `slide` index.
    Slide(u32),
    /// Change the presentation name.
    Name(String),
    /// Start a new recording with elapsed time.
    #[serde(rename = "recording_start")]
    RecordingStart {
        /// Elapsed time in milliseconds.
        elapsed_ms: u64,
    },
    /// Pause an active recording.
    #[serde(rename = "recording_pause")]
    RecordingPause {
        /// Elapsed time in milliseconds.
        elapsed_ms: u64,
    },
    /// Resume a paused recording.
    #[serde(rename = "recording_resume")]
    RecordingResume {
        /// Elapsed time in milliseconds.
        elapsed_ms: u64,
    },
    /// Stop an active recording.
    #[serde(rename = "recording_stop")]
    RecordingStop,
}

struct RecordingEvent {
    offset_ms: u64,
    slide: u32,
}

struct RecordingState {
    db_id: i64,
    started_at: std::time::Instant,
    /// Total running time from all completed active periods (updated on each resume).
    active_ms: u64,
    is_paused: bool,
    pause_started_at: Option<std::time::Instant>,
    slides: Vec<RecordingEvent>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum RecordingMessage {
    RecordingStart,
    RecordingPause,
    RecordingResume,
    RecordingStop,
}

/// A specific presetation.
///
/// There is no key here, as presentations are stored in a hashmap with its associated keys.
pub struct Presentation {
    /// The full content of _all_ slides in the presentation.
    content: String,
    /// The slide index that is currently active.
    slide: u32,
    /// A set of channels for reading and writing to the sockets.
    channel: (Sender<SlideMessage>, Receiver<SlideMessage>),
    recording: Option<RecordingState>,
    presenter_count: usize,
}

/// The state of the entire application.
#[derive(Clone)]
pub struct AppState {
    /// Used to render HTML templates.
    tera: Tera,
    /// Used to store all the ongoing presentation.
    /// They Key here is a user-defined string, and the value is a [`Presentation`] struct.
    slides: Arc<Mutex<HashMap<String, Arc<Mutex<Presentation>>>>>,
    db_pool: SqlitePool,
}

impl FromRef<AppState> for SqlitePool {
    fn from_ref(state: &AppState) -> Self {
        state.db_pool.clone()
    }
}
impl FromRef<AppState> for Tera {
    fn from_ref(state: &AppState) -> Self {
        state.tera.clone()
    }
}

async fn broadcast_to_all(
    ws: WebSocketUpgrade,
    Path(pid): Path<String>,
    State(state): State<AppState>,
    auth_session: AuthSession,
) -> Response {
    // Resolve role at connect time. Password is not passed — the WebSocket
    // endpoint does not handle password authentication; the HTTP layer (plan 3)
    // gates who can reach the audience page in the first place.
    let pid_i64 = pid.parse::<i64>().unwrap_or(-1);
    let role = check_access(
        &state.db_pool,
        auth_session.user.as_ref(),
        pid_i64,
        None,
    )
    .await
    .unwrap_or(AccessResult::Denied);
    ws.on_upgrade(move |socket| ws_handle(socket, pid, state, role))
}

fn update_slide(pid: &str, msg: SlideMessage, state: &mut AppState) {
    let mut slides = state.slides.lock().unwrap();
    let mut pres = slides.get_mut(pid).unwrap().lock().unwrap();
    match msg {
        SlideMessage::Slide(sn) => {
            pres.slide = sn;
        }
        SlideMessage::Text(text) => {
            pres.content = text;
        }
        SlideMessage::Name(_) => {}
        _ => {}
    }
}

async fn add_client_handler_channel(pid: String, state: &mut AppState) -> Arc<Mutex<Presentation>> {
    // Check if already in memory without holding lock across await
    {
        let Ok(slides) = state.slides.lock() else {
            panic!("Unable to lock K/V store!");
        };
        if let Some(pres) = slides.get(&pid) {
            return Arc::clone(pres);
        }
    }
    // Not in memory — load content from DB so the initial WS message has real content
    let db_content = if let Ok(pid_i64) = pid.parse::<i64>() {
        DbPresentation::get_by_id(pid_i64, &state.db_pool)
            .await
            .ok()
            .flatten()
            .map(|p| p.content)
            .unwrap_or_default()
    } else {
        String::new()
    };
    let Ok(mut slides) = state.slides.lock() else {
        panic!("Unable to lock K/V store!");
    };
    let pres = slides.entry(pid).or_insert_with(|| {
        Arc::new(Mutex::new(Presentation {
            content: db_content,
            slide: 0,
            channel: broadcast::channel(1024),
            recording: None,
            presenter_count: 0,
        }))
    });
    Arc::clone(pres)
}

fn handle_socket(
    msg: Result<Message, axum::Error>,
    pid: &str,
    tx: &mut Sender<SlideMessage>,
    state: &mut AppState,
    role: &AccessResult,
) -> Result<bool, &'static str> {
    let Ok(raw) = msg else {
        cleanup(state);
        return Err("Disconnected");
    };
    if let Message::Close(_) = raw {
        cleanup(state);
        return Err("Closed");
    }
    let slide_msg: SlideMessage = match raw.to_text().ok().and_then(|t| serde_json::from_str(t).ok()) {
        Some(m) => m,
        None => return Err("Invalid message!"),
    };
    let permitted = match (role, &slide_msg) {
        (AccessResult::Owner, _) => true,
        (AccessResult::Editor, SlideMessage::Text(_) | SlideMessage::Slide(_)) => true,
        (AccessResult::Controller, SlideMessage::Slide(_)) => true,
        _ => false,
    };
    if !permitted {
        return Ok(true); // silently drop
    }
    update_slide(pid, slide_msg.clone(), state);
    if tx.send(slide_msg).is_err() {
        cleanup(state);
        return Err("Channel disconnected!");
    }
    Ok(true)
}

/// Handles a recording control message from a presenter.
///
/// Returns a [`SlideMessage`] to broadcast to all clients, or `None` if the
/// message is a no-op (e.g. start when already recording, pause when already paused).
async fn handle_recording_message(
    msg: RecordingMessage,
    pres: &Arc<Mutex<Presentation>>,
    presentation_id: i64,
    pool: &SqlitePool,
) -> Option<SlideMessage> {
    match msg {
        RecordingMessage::RecordingStart => {
            // Check and initialise under lock (placeholder db_id = -1)
            {
                let mut p = pres.lock().unwrap();
                if p.recording.is_some() {
                    return None;
                }
                let slide = p.slide;
                p.recording = Some(RecordingState {
                    db_id: -1,
                    started_at: std::time::Instant::now(),
                    active_ms: 0,
                    is_paused: false,
                    pause_started_at: None,
                    slides: vec![RecordingEvent { offset_ms: 0, slide }],
                });
            }
            // Create DB row
            let name = {
                let now = time::OffsetDateTime::now_utc();
                format!("Recording \u{2013} {}", now.format(&time::format_description::well_known::Rfc3339).unwrap_or_default())
            };
            let rec = Recording::create(presentation_id, name, None, String::new(), pool).await.ok()?;
            // Store real db_id
            pres.lock().unwrap().recording.as_mut()?.db_id = rec.id;
            Some(SlideMessage::RecordingStart { elapsed_ms: 0 })
        }

        RecordingMessage::RecordingPause => {
            let elapsed_ms = {
                let mut p = pres.lock().unwrap();
                let rec = p.recording.as_mut()?;
                if rec.is_paused { return None; }
                let elapsed_ms = (std::time::Instant::now() - rec.started_at).as_millis() as u64 + rec.active_ms;
                rec.pause_started_at = Some(std::time::Instant::now());
                rec.is_paused = true;
                elapsed_ms
            };
            Some(SlideMessage::RecordingPause { elapsed_ms })
        }

        RecordingMessage::RecordingResume => {
            let elapsed_ms = {
                let mut p = pres.lock().unwrap();
                let rec = p.recording.as_mut()?;
                if !rec.is_paused { return None; }
                let pause_start = rec.pause_started_at?;
                // Accumulate running time from last start to pause
                rec.active_ms += (pause_start - rec.started_at).as_millis() as u64;
                rec.started_at = std::time::Instant::now();
                rec.pause_started_at = None;
                rec.is_paused = false;
                // elapsed ≈ active_ms since started_at was just reset
                rec.active_ms
            };
            Some(SlideMessage::RecordingResume { elapsed_ms })
        }

        RecordingMessage::RecordingStop => {
            // Extract everything needed before async work
            let (db_id, slides, content) = {
                let mut p = pres.lock().unwrap();
                let rec = p.recording.take()?;
                (rec.db_id, rec.slides, p.content.clone())
            };
            if db_id < 0 {
                // DB row not yet created (start still in progress) — nothing to save
                return Some(SlideMessage::RecordingStop);
            }
            // Resolve slide indices to title/content
            let all_slides = render_all_slides(&content);
            let inputs: Vec<RecordingSlideInput> = slides
                .into_iter()
                .filter_map(|ev| {
                    let (title, html) = all_slides.get(ev.slide as usize)?.clone();
                    Some(RecordingSlideInput {
                        start_seconds: ev.offset_ms as f64 / 1000.0,
                        title,
                        content: html,
                    })
                })
                .collect();
            let _ = RecordingSlide::create_batch(db_id, inputs, pool).await;
            let _ = Recording::touch(db_id, pool).await;
            Some(SlideMessage::RecordingStop)
        }
    }
}

async fn ws_handle(mut socket: WebSocket, pid: String, mut state: AppState, role: AccessResult) {
    let pres = add_client_handler_channel(pid.clone(), &mut state).await;
    let is_presenter = matches!(role, AccessResult::Owner | AccessResult::Editor | AccessResult::Controller);

    // Increment presenter_count for authorized roles
    if is_presenter {
        pres.lock().unwrap().presenter_count += 1;
    }

    let (mut tx, mut rx, text, slide, recording_msg) = {
        let p = pres.lock().unwrap();
        let text = serde_json::to_string(&SlideMessage::Text(p.content.clone())).unwrap();
        let slide = serde_json::to_string(&SlideMessage::Slide(p.slide)).unwrap();
        let (tx, rx) = (p.channel.0.clone(), p.channel.0.subscribe());
        // Build connect-time recording state message if recording is active
        let recording_msg = p.recording.as_ref().map(|rec| {
            let elapsed_ms = if rec.is_paused {
                rec.active_ms
            } else {
                (std::time::Instant::now() - rec.started_at).as_millis() as u64 + rec.active_ms
            };
            if rec.is_paused {
                serde_json::to_string(&SlideMessage::RecordingPause { elapsed_ms }).unwrap()
            } else {
                serde_json::to_string(&SlideMessage::RecordingStart { elapsed_ms }).unwrap()
            }
        });
        (tx, rx, text, slide, recording_msg)
    };

    socket.send(Message::from(text)).await.unwrap();
    socket.send(Message::from(slide)).await.unwrap();
    if let Some(rec_msg) = recording_msg {
        let _ = socket.send(Message::from(rec_msg)).await;
    }

    let mut state1 = state.clone();
    let pid_i64 = pid.parse::<i64>().unwrap_or(-1);
    let pres1 = Arc::clone(&pres);
    let (mut sock_send, mut sock_recv) = socket.split();

    let socket_handler = async {
        while let Some(msg) = sock_recv.next().await {
            // Pre-extract text for recording dispatch and snapshot capture
            let text_val: Option<String> = msg
                .as_ref()
                .ok()
                .and_then(|m| m.to_text().ok())
                .map(String::from);

            let is_recording_msg = text_val
                .as_deref()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(t).ok())
                .and_then(|v| v["type"].as_str().map(|s| s.starts_with("recording_")))
                .unwrap_or(false);

            if is_recording_msg {
                if is_presenter {
                    if let Some(text) = &text_val {
                        if let Ok(rec_msg) = serde_json::from_str::<RecordingMessage>(text) {
                            if let Some(broadcast_msg) = handle_recording_message(
                                rec_msg, &pres1, pid_i64, &state1.db_pool,
                            ).await {
                                let _ = tx.send(broadcast_msg);
                            }
                        }
                    }
                }
                continue;
            }

            // Pre-parse slide index for snapshot capture (before handle_socket consumes msg)
            let slide_n: Option<u32> = text_val
                .as_deref()
                .and_then(|t| serde_json::from_str::<SlideMessage>(t).ok())
                .and_then(|m| if let SlideMessage::Slide(n) = m { Some(n) } else { None });

            if handle_socket(msg, &pid, &mut tx, &mut state1, &role).is_err() {
                return;
            }

            // Capture slide snapshot for active recording
            if let Some(n) = slide_n {
                if is_presenter {
                    let mut slides_map = state1.slides.lock().unwrap();
                    if let Some(p) = slides_map.get_mut(&pid) {
                        let mut p = p.lock().unwrap();
                        if let Some(ref mut rec) = p.recording {
                            if !rec.is_paused {
                                let offset_ms = (std::time::Instant::now() - rec.started_at)
                                    .as_millis() as u64 + rec.active_ms;
                                rec.slides.push(RecordingEvent { offset_ms, slide: n });
                            }
                        }
                    }
                }
            }
        }
    };

    let channel_handler = async {
        while let Ok(msg) = rx.recv().await {
            let text = serde_json::to_string(&msg).unwrap();
            sock_send.send(Message::from(text)).await.unwrap();
            let id = pid.parse().unwrap();
            if let SlideMessage::Text(text) = msg {
                let _ = DbPresentation::update_content(id, text, &state.db_pool).await;
            }
        }
    };

    let () = or(socket_handler, channel_handler).await;

    // Auto-stop recording if this was the last presenter
    if is_presenter {
        let should_stop = {
            let mut p = pres.lock().unwrap();
            p.presenter_count = p.presenter_count.saturating_sub(1);
            p.presenter_count == 0 && p.recording.is_some()
        };
        if should_stop {
            handle_recording_message(
                RecordingMessage::RecordingStop, &pres, pid_i64, &state.db_pool,
            ).await;
            // No broadcast: no clients remain
        }
    }

    drop(pres);
}

async fn join(
    State(tera): State<Tera>,
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
) -> impl IntoResponse {
    tera.render("join.html", Context::new(), auth_session, db)
        .await
}
/// Returns the HTML for a single slide from rendered markdown.
/// Splits at `<h2>` boundaries, mirroring the JS `addSiblings` function.
#[must_use]
fn render_slide(markdown: &str, slide_index: u32, pres_name: &str) -> String {
    let events: Vec<Event<'_>> = Parser::new_ext(markdown, Options::all()).collect();
    let slide_starts: Vec<usize> = events
        .iter()
        .enumerate()
        .filter_map(|(i, e)| match e {
            Event::Start(Tag::Heading { level: HeadingLevel::H2, .. }) => Some(i),
            _ => None,
        })
        .collect();
    if slide_starts.is_empty() {
        return String::new();
    }
    let idx = usize::try_from(slide_index)
        .unwrap_or(usize::MAX)
        .min(slide_starts.len() - 1);
    let start = slide_starts[idx];
    let end = slide_starts.get(idx + 1).copied().unwrap_or(events.len());
    let mut output = String::new();
    if !pres_name.is_empty() {
        output.push_str("<h1>");
        output.push_str(&html_escape(pres_name));
        output.push_str("</h1>");
    }
    cmark_html::push_html(&mut output, events[start..end].iter().cloned());
    output
}

/// Returns `(title, html_content)` for every `## ` slide in the markdown.
/// Uses the same pulldown-cmark parser as `render_slide`.
#[must_use]
fn render_all_slides(markdown: &str) -> Vec<(String, String)> {
    let events: Vec<Event<'_>> = Parser::new_ext(markdown, Options::all()).collect();
    let slide_starts: Vec<usize> = events
        .iter()
        .enumerate()
        .filter_map(|(i, e)| match e {
            Event::Start(Tag::Heading { level: HeadingLevel::H2, .. }) => Some(i),
            _ => None,
        })
        .collect();
    slide_starts
        .iter()
        .enumerate()
        .map(|(i, &start)| {
            let end = slide_starts.get(i + 1).copied().unwrap_or(events.len());
            // Extract heading text
            let title = events[start..end]
                .iter()
                .filter_map(|e| if let Event::Text(t) = e { Some(t.as_ref()) } else { None })
                .next()
                .unwrap_or("")
                .to_string();
            // Render full slide HTML
            let mut html = String::new();
            cmark_html::push_html(&mut html, events[start..end].iter().cloned());
            (title, html)
        })
        .collect()
}

/// Gets the current slide index from in-memory state, defaulting to 0.
#[must_use]
fn current_slide_index(app_state: &AppState, pid: i64) -> u32 {
    let Ok(map) = app_state.slides.lock() else { return 0; };
    map.get(&pid.to_string())
        .and_then(|p| p.lock().ok().map(|p| p.slide))
        .unwrap_or(0)
}

async fn audience(tera: Tera, auth_session: AuthSession, db: SqlitePool) -> impl IntoResponse {
    tera.render("audience.html", Context::new(), auth_session, db)
        .await
}
async fn start(
    State(tera): State<Tera>,
    auth_session: AuthSession,
    State(db): State<SqlitePool>,
) -> impl IntoResponse {
    if auth_session.user.is_none() {
        return Redirect::to("/auth/login").into_response();
    }
    tera.render("create.html", Context::new(), auth_session, db)
        .await
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct NameForm {
    name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PwdQuery {
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct AddAccessForm {
    username: String,
    role: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct RemoveAccessForm {
    user_id: i64,
}

#[derive(Deserialize)]
struct SetAccessModeForm {
    mode: String,
}

#[derive(Deserialize)]
struct SetRecordingAccessModeForm {
    action: String,
    mode: Option<String>,
}

#[derive(Deserialize)]
struct UserExistsQuery {
    username: Option<String>,
}

async fn user_exists(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Query(query): Query<UserExistsQuery>,
) -> impl IntoResponse {
    let Some(_) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Some(username) = query.username else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match User::get_by_name(username, &db).await {
        Ok(Some(_)) => StatusCode::OK.into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ChangeRoleForm {
    user_id: i64,
    role: String,
}

async fn start_pres(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Form(name_form): Form<NameForm>,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return Redirect::to("/auth/login").into_response();
    };
    if name_form.name.is_empty() {
        return Redirect::to("/start").into_response();
    }
    let pres = DbPresentation::new(&user, name_form.name, &db).await;
    if let Err(ref e) = pres {
        println!("{e:?}");
    }
    let Ok(pres) = pres else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    Redirect::to(&format!("/{}/{}/edit", user.name, pres.id)).into_response()
}

async fn present(
    State(tera): State<Tera>,
    State(db): State<SqlitePool>,
    State(app_state): State<AppState>,
    auth_session: AuthSession,
    Path((uname, pid)): Path<(String, i64)>,
) -> impl IntoResponse {
    let pres_user = User::get_by_name(uname.clone(), &db).await;
    let pres_user = match pres_user {
        Ok(Some(u)) => u,
        Ok(None) => return audience(tera, auth_session, db).await.into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let pres = DbPresentation::get_by_id(pid, &db).await;
    let pres = match pres {
        Ok(Some(p)) => p,
        Ok(None) => return audience(tera, auth_session, db).await.into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if pres.user_id != pres_user.id {
        let Ok(Some(owner)) = User::get_by_id(pres.user_id, &db).await else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        let redirect = format!("/{}/{pid}", owner.name);
        return Redirect::permanent(&redirect).into_response();
    }
    let access = match check_access(&db, auth_session.user.as_ref(), pid, None).await {
        Ok(a) => a,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };

    match access {
        AccessResult::Owner | AccessResult::Editor | AccessResult::Controller => {
            stage(tera, db, auth_session, pid, app_state, pres_user).await.into_response()
        }
        AccessResult::Audience | AccessResult::PublicOk => {
            let slide_index = current_slide_index(&app_state, pid);
            let initial_slide = render_slide(&pres.content, slide_index, &pres.name);
            let mut ctx = Context::new();
            ctx.insert("pres", &pres);
            ctx.insert("pres_user", &pres_user);
            ctx.insert("initial_slide", &initial_slide);
            tera.render("audience.html", ctx, auth_session, db).await.into_response()
        }
        AccessResult::Denied => {
            StatusCode::FORBIDDEN.into_response()
        }
    }
}

async fn stage(
    tera: Tera,
    db: SqlitePool,
    auth_session: AuthSession,
    pid: i64,
    app_state: AppState,
    pres_user: User,
) -> impl IntoResponse {
    if auth_session.user.is_none() {
        return Redirect::to("/auth/login").into_response();
    }
    let pres = DbPresentation::get_by_id(pid, &db).await.unwrap().unwrap();
    let slide_index = current_slide_index(&app_state, pid);
    let initial_slide = render_slide(&pres.content, slide_index, &pres.name);
    let mut ctx = Context::new();
    ctx.insert("pres", &pres);
    ctx.insert("pres_user", &pres_user);
    ctx.insert("initial_slide", &initial_slide);
    tera.render("stage.html", ctx, auth_session, db).await
}
async fn edit_pres(
    State(tera): State<Tera>,
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path((uname, pid)): Path<(String, i64)>,
) -> impl IntoResponse {
    if auth_session.user.is_none() {
        return Redirect::to("/auth/login").into_response();
    }
    let pres_user = match User::get_by_name(uname.clone(), &db).await {
        Ok(Some(u)) => u,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let pres = match DbPresentation::get_by_id(pid, &db).await {
        Ok(Some(p)) => p,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if pres.user_id != pres_user.id {
        let Ok(Some(owner)) = User::get_by_id(pres.user_id, &db).await else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        let redirect = format!("/{}/{pid}/edit", owner.name);
        return Redirect::permanent(&redirect).into_response();
    }
    let access = match check_access(&db, auth_session.user.as_ref(), pid, None).await {
        Ok(a) => a,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    match access {
        AccessResult::Owner | AccessResult::Editor => {
            let mut ctx = Context::new();
            ctx.insert("pres", &pres);
            ctx.insert("pres_user", &pres_user);
            tera.render("edit.html", ctx, auth_session, db).await.into_response()
        }
        AccessResult::Controller | AccessResult::Audience | AccessResult::PublicOk => {
            Redirect::to(&format!("/{uname}/{pid}")).into_response()
        }
        AccessResult::Denied => Redirect::to("/auth/login").into_response(),
    }
}

/// Returns an SVG QR code linking to the presentation at `/{uname}/{pid}`.
async fn qr_code(Path((uname, pid)): Path<(String, String)>, headers: HeaderMap) -> impl IntoResponse {
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("https");
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost");
    let url = format!("{proto}://{host}/{uname}/{pid}");
    let Ok(code) = QrCode::new(url.as_bytes()) else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let image = code
        .render::<svg::Color<'_>>()
        .min_dimensions(200, 200)
        .quiet_zone(false)
        .build();
    ([(axum::http::header::CONTENT_TYPE, "image/svg+xml")], image).into_response()
}

async fn presentations(
    State(tera): State<Tera>,
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
) -> impl IntoResponse {
    let Some(ref user) = auth_session.user else {
        return Redirect::to("/auth/login").into_response();
    };
    let Ok(owned) = DbPresentation::get_for_user(user, &db).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let Ok(shared) = DbPresentation::get_shared_with_user(user, &db).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let mut press_with_recordings = vec![];
    for pres in owned {
        let Ok(mut pwr) = Recording::get_by_presentation(pres, user.name.clone(), &db).await else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        pwr.role = "owner".to_string();
        press_with_recordings.push(pwr);
    }
    for (pres, role) in shared {
        let owner_name = match User::get_by_id(pres.user_id, &db).await {
            Ok(Some(owner)) => owner.name,
            _ => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
        let Ok(mut pwr) = Recording::get_by_presentation(pres, owner_name, &db).await else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        pwr.role = role;
        press_with_recordings.push(pwr);
    }
    let mut ctx = Context::new();
    ctx.insert("press", &press_with_recordings);
    tera.render("presentations.html", ctx, auth_session, db)
        .await
}
async fn login(
    State(tera): State<Tera>,
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
) -> impl IntoResponse {
    tera.render("login.html", Context::new(), auth_session, db)
        .await
}
async fn new_user_form(
    State(db): State<SqlitePool>,
    State(_tera): State<Tera>,
    auth_session: AuthSession,
    Form(new_user): Form<AddUserForm>,
) -> impl IntoResponse {
    let Some(ref user) = auth_session.user else {
        return Redirect::to("/auth/login").into_response();
    };
    if let Ok(is_admin) = auth_session.backend.has_perm(user, Group::Admin).await
        && !is_admin
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    User::new(&db, new_user).await.unwrap();
    Redirect::to("/user/presentations").into_response()
}
async fn new_user(
    State(db): State<SqlitePool>,
    State(tera): State<Tera>,
    auth_session: AuthSession,
) -> impl IntoResponse {
    let Some(ref _user) = auth_session.user else {
        return Redirect::to("/auth/login").into_response();
    };
    tera.render("user/add_user.html", Context::new(), auth_session, db)
        .await
}
async fn change_pwd(
    State(db): State<SqlitePool>,
    State(tera): State<Tera>,
    auth_session: AuthSession,
    Query(params): Query<PwdQuery>,
) -> impl IntoResponse {
    let Some(ref _user) = auth_session.user else {
        return Redirect::to("/auth/login").into_response();
    };
    let mut ctx = Context::new();
    if let Some(ref err) = params.error {
        ctx.insert("error", err);
    }
    tera.render("user/change_pwd.html", ctx, auth_session, db)
        .await
}
async fn change_pwd_form(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Form(pwd_form): Form<ChangePasswordForm>,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return Redirect::to("/auth/login").into_response();
    };
    if pwd_form.new != pwd_form.confirm {
        return Redirect::to("/user/change_pwd?error=Passwords+do+not+match").into_response();
    }
    let phash = PasswordHash::new(&user.password).unwrap();
    if Argon2::default()
        .verify_password(pwd_form.old.as_bytes(), &phash)
        .is_err()
    {
        return Redirect::to("/user/change_pwd?error=Current+password+is+incorrect").into_response();
    }
    if user.change_password(pwd_form.new, &db).await.is_err() {
        return Redirect::to("/user/change_pwd?error=Failed+to+update+password").into_response();
    }
    return Redirect::to("/").into_response();
}

async fn login_process(
    State(tera): State<Tera>,
    State(db): State<SqlitePool>,
    mut auth_session: AuthSession,
    Form(login): Form<LoginForm>,
) -> impl IntoResponse {
    let user = match auth_session.authenticate(login).await {
        Ok(Some(u)) => u,
        Ok(None) => {
            let mut ctx = Context::new();
            ctx.insert("error", "Invalid username or password.");
            return tera.render("login.html", ctx, auth_session, db).await;
        }
        Err(_) => {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    if auth_session.login(&user).await.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    Redirect::to("/").into_response()
}
async fn logout(mut auth_session: AuthSession) -> impl IntoResponse {
    match auth_session.logout().await {
        Ok(_) => Redirect::to("/").into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn recording(
    State(tera): State<Tera>,
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path((uname, pid, rid)): Path<(String, i64, i64)>,
) -> impl IntoResponse {
    let Ok(Some(pres_user)) = User::get_by_name(uname, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(Some(pres)) = DbPresentation::get_by_id(pid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if pres.user_id != pres_user.id {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(Some(rec)) = Recording::get_by_id(rid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if rec.presentation_id != pid {
        return StatusCode::NOT_FOUND.into_response();
    }
    let access = match check_access(&db, auth_session.user.as_ref(), pid, Some(rid)).await {
        Ok(a) => a,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if matches!(access, AccessResult::Denied) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let has_owner_controls = matches!(
        access,
        AccessResult::Owner | AccessResult::Editor | AccessResult::Controller
    );
    let mut ctx = Context::new();
    ctx.insert("recording", &rec);
    ctx.insert("pres", &pres);
    ctx.insert("pres_user", &pres_user);
    ctx.insert("is_owner", &has_owner_controls);
    tera.render("recording.html", ctx, auth_session, db)
        .await
        .into_response()
}

async fn demo(State(db): State<SqlitePool>) -> impl IntoResponse {
    let Ok(Some(user)) = User::get_by_name("admin".to_string(), &db).await else {
        return Redirect::to("/").into_response();
    };
    let Ok(presses) = DbPresentation::get_for_user(&user, &db).await else {
        return Redirect::to("/").into_response();
    };
    match presses.into_iter().next() {
        Some(pres) => Redirect::to(&format!("/{}/{}", user.name, pres.id)).into_response(),
        None => Redirect::to("/").into_response(),
    }
}

async fn index(
    State(tera): State<Tera>,
    auth_session: AuthSession,
    State(db): State<SqlitePool>,
) -> impl IntoResponse {
    tera.render("index.html", Context::new(), auth_session, db)
        .await
}

async fn help(
    State(tera): State<Tera>,
    auth_session: AuthSession,
    State(db): State<SqlitePool>,
) -> impl IntoResponse {
    tera.render("help.html", Context::new(), auth_session, db)
        .await
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn strip_leading_h1(content: &str) -> &str {
    let t = content.trim_start();
    if t.to_ascii_lowercase().starts_with("<h1") {
        if let Some(end) = t.to_ascii_lowercase().find("</h1>") {
            return t[end + 5..].trim_start();
        }
    }
    content
}

fn format_vtt_time(seconds: f64) -> String {
    let ms = ((seconds % 1.0) * 1000.0).round() as u64;
    let total_s = seconds as u64;
    let s = total_s % 60;
    let m = (total_s / 60) % 60;
    let h = total_s / 3600;
    format!("{h:02}:{m:02}:{s:02}.{ms:03}")
}

async fn slides_vtt(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path((uname, pid, rid)): Path<(String, i64, i64)>,
) -> impl IntoResponse {
    let Ok(Some(pres_user)) = User::get_by_name(uname, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(Some(pres)) = DbPresentation::get_by_id(pid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if pres.user_id != pres_user.id {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(Some(rec)) = Recording::get_by_id(rid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if rec.presentation_id != pid {
        return StatusCode::NOT_FOUND.into_response();
    }
    let access = match check_access(&db, auth_session.user.as_ref(), pid, Some(rid)).await {
        Ok(a) => a,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if matches!(access, AccessResult::Denied) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Ok(slides) = RecordingSlide::get_by_recording(rid, &db).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let mut vtt = String::from("WEBVTT\n\n");
    for (i, slide) in slides.iter().enumerate() {
        let start = format_vtt_time(slide.start_seconds);
        let end = slides
            .get(i + 1)
            .map(|s| format_vtt_time(s.start_seconds))
            .unwrap_or_else(|| "99:59:59.999".to_string());
        let json = serde_json::json!({
            "id": slide.id,
            "title": slide.title,
            "content": slide.content,
        });
        vtt.push_str(&format!("{start} --> {end}\n{json}\n\n"));
    }
    (
        [(axum::http::header::CONTENT_TYPE, "text/vtt; charset=utf-8")],
        vtt,
    )
        .into_response()
}

async fn slides_html(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path((uname, pid, rid)): Path<(String, i64, i64)>,
) -> impl IntoResponse {
    let Ok(Some(pres_user)) = User::get_by_name(uname, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(Some(pres)) = DbPresentation::get_by_id(pid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if pres.user_id != pres_user.id {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(Some(rec)) = Recording::get_by_id(rid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if rec.presentation_id != pid {
        return StatusCode::NOT_FOUND.into_response();
    }
    let access = match check_access(&db, auth_session.user.as_ref(), pid, Some(rid)).await {
        Ok(a) => a,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if matches!(access, AccessResult::Denied) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Ok(slides) = RecordingSlide::get_by_recording(rid, &db).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let rec_name = html_escape(&rec.name);
    let pres_name = html_escape(&pres.name);
    let mut html = format!(
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><title>{rec_name} - Slides</title></head><body>\n<h1>{pres_name}</h1>\n"
    );
    for slide in &slides {
        let content = strip_leading_h1(&slide.content);
        html.push_str(&format!("<section>\n{content}\n</section>\n"));
    }
    html.push_str("</body></html>");
    (
        [(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
        html,
    )
        .into_response()
}

async fn update_slide_time(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path((rid, sid)): Path<(i64, i64)>,
    body: String,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let owner_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM recording
         JOIN presentation ON presentation.id = recording.presentation_id
         WHERE recording.id = ? AND presentation.user_id = ?;",
    )
    .bind(rid)
    .bind(user.id)
    .fetch_one(&db)
    .await;
    if !matches!(owner_count, Ok(1)) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Ok(start_seconds) = body.trim().parse::<f64>() else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let slide_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM recording_slide WHERE id = ? AND recording_id = ?;",
    )
    .bind(sid)
    .bind(rid)
    .fetch_one(&db)
    .await;
    if !matches!(slide_count, Ok(1)) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match RecordingSlide::update_start_seconds(sid, start_seconds, &db).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn update_presentation_name(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(pid): Path<i64>,
    body: String,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let owner_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM presentation WHERE id = ? AND user_id = ?;",
    )
    .bind(pid)
    .bind(user.id)
    .fetch_one(&db)
    .await;
    if !matches!(owner_count, Ok(1)) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match DbPresentation::update_name(pid, body, &db).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn update_recording_name(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(rid): Path<i64>,
    body: String,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let owner_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM recording
         JOIN presentation ON presentation.id = recording.presentation_id
         WHERE recording.id = ? AND presentation.user_id = ?;",
    )
    .bind(rid)
    .bind(user.id)
    .fetch_one(&db)
    .await;
    if !matches!(owner_count, Ok(1)) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match Recording::update_name(rid, body, &db).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn delete_recording(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(rid): Path<i64>,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let owner_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM recording
         JOIN presentation ON presentation.id = recording.presentation_id
         WHERE recording.id = ? AND presentation.user_id = ?;",
    )
    .bind(rid)
    .bind(user.id)
    .fetch_one(&db)
    .await;
    if !matches!(owner_count, Ok(1)) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match Recording::delete(rid, &db).await {
        Ok(()) => Redirect::to("/user/presentations").into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn delete_presentation(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(pid): Path<i64>,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    match DbPresentation::delete(pid, user.id, &db).await {
        Ok(()) => Redirect::to("/user/presentations").into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn add_access(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(pid): Path<i64>,
    Form(form): Form<AddAccessForm>,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(pres)) = DbPresentation::get_by_id(pid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if pres.user_id != user.id {
        return StatusCode::NOT_FOUND.into_response();
    }
    if !["editor", "controller", "audience"].contains(&form.role.as_str()) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Ok(Some(target)) = User::get_by_name(form.username, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    // Don't allow adding the owner as a co-presenter
    if target.id == user.id {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match PresentationAccess::add(&db, pid, target.id, &form.role).await {
        Ok(()) => Redirect::to("/user/presentations").into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn remove_access(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(pid): Path<i64>,
    Form(form): Form<RemoveAccessForm>,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(pres)) = DbPresentation::get_by_id(pid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if pres.user_id != user.id {
        return StatusCode::NOT_FOUND.into_response();
    }
    // Don't allow removing the owner from their own presentation
    if form.user_id == user.id {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match PresentationAccess::remove(&db, pid, form.user_id).await {
        Ok(()) => Redirect::to("/user/presentations").into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn change_access_role(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(pid): Path<i64>,
    Form(form): Form<ChangeRoleForm>,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(pres)) = DbPresentation::get_by_id(pid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if pres.user_id != user.id {
        return StatusCode::NOT_FOUND.into_response();
    }
    if !["editor", "controller", "audience"].contains(&form.role.as_str()) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match PresentationAccess::change_role(&db, pid, form.user_id, &form.role).await {
        Ok(()) => Redirect::to("/user/presentations").into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn set_presentation_access_mode(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(pid): Path<i64>,
    Form(form): Form<SetAccessModeForm>,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(pres)) = DbPresentation::get_by_id(pid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if pres.user_id != user.id {
        return StatusCode::NOT_FOUND.into_response();
    }
    if !["public", "audience", "private"].contains(&form.mode.as_str()) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match DbPresentation::set_access_mode(pid, &form.mode, &db).await {
        Ok(()) => Redirect::to("/user/presentations").into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn set_recording_access_mode(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(rid): Path<i64>,
    Form(form): Form<SetRecordingAccessModeForm>,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let owner_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM recording
         JOIN presentation ON presentation.id = recording.presentation_id
         WHERE recording.id = ? AND presentation.user_id = ?",
    )
    .bind(rid)
    .bind(user.id)
    .fetch_one(&db)
    .await;
    if !matches!(owner_count, Ok(c) if c > 0) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let mode = if form.action == "inherit" {
        None
    } else {
        match form.mode.as_deref() {
            Some(m) if ["public", "audience", "private"].contains(&m) => Some(m.to_string()),
            _ => return StatusCode::BAD_REQUEST.into_response(),
        }
    };
    match Recording::set_access_mode(rid, mode.as_deref(), &db).await {
        Ok(()) => Redirect::to("/user/presentations").into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn update_recording_files(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(rid): Path<i64>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let owner_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM recording
         JOIN presentation ON presentation.id = recording.presentation_id
         WHERE recording.id = ? AND presentation.user_id = ?;",
    )
    .bind(rid)
    .bind(user.id)
    .fetch_one(&db)
    .await;
    if !matches!(owner_count, Ok(1)) {
        return StatusCode::NOT_FOUND.into_response();
    }

    let mut video_bytes: Option<(Vec<u8>, String)> = None;
    let mut captions_bytes: Option<Vec<u8>> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        match field.name().unwrap_or("") {
            "video" => {
                let ext = field
                    .file_name()
                    .and_then(|f| std::path::Path::new(f).extension())
                    .and_then(std::ffi::OsStr::to_str)
                    .unwrap_or("bin")
                    .to_string();
                if let Ok(b) = field.bytes().await {
                    if !b.is_empty() {
                        video_bytes = Some((b.to_vec(), ext));
                    }
                }
            }
            "captions" => {
                if let Ok(b) = field.bytes().await {
                    if !b.is_empty() {
                        captions_bytes = Some(b.to_vec());
                    }
                }
            }
            _ => {}
        }
    }

    let dir = format!("assets/{rid}");

    if let Some((video_data, video_ext)) = video_bytes {
        let video_filename = format!("video.{video_ext}");
        if tokio::fs::write(format!("{dir}/{video_filename}"), &video_data).await.is_err() {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        if sqlx::query("UPDATE recording SET video_path = ?, last_edited = strftime('%s', 'now') WHERE id = ?;")
            .bind(&video_filename)
            .bind(rid)
            .execute(&db)
            .await
            .is_err()
        {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }

    if let Some(captions_data) = captions_bytes {
        if tokio::fs::write(format!("{dir}/captions.vtt"), &captions_data).await.is_err() {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        let _ = sqlx::query("UPDATE recording SET last_edited = strftime('%s', 'now') WHERE id = ?;")
            .bind(rid)
            .execute(&db)
            .await;
    }

    StatusCode::OK.into_response()
}

async fn add_recording(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(pid): Path<i64>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let has_access = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM (
            SELECT 1 FROM presentation WHERE id = ? AND user_id = ?
            UNION ALL
            SELECT 1 FROM presentation_access WHERE presentation_id = ? AND user_id = ? AND role IN ('controller', 'editor')
        )",
    )
    .bind(pid)
    .bind(user.id)
    .bind(pid)
    .bind(user.id)
    .fetch_one(&db)
    .await;
    if !matches!(has_access, Ok(n) if n > 0) {
        return StatusCode::FORBIDDEN.into_response();
    }

    let mut name = String::new();
    let mut video_bytes: Option<(Vec<u8>, String)> = None;
    let mut slides_json: Option<String> = None;
    let mut captions_bytes: Option<Vec<u8>> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        match field.name().unwrap_or("") {
            "name" => {
                name = field.text().await.unwrap_or_default();
            }
            "video" => {
                let ext = field
                    .file_name()
                    .and_then(|f| std::path::Path::new(f).extension())
                    .and_then(std::ffi::OsStr::to_str)
                    .unwrap_or("bin")
                    .to_string();
                if let Ok(b) = field.bytes().await {
                    if !b.is_empty() {
                        video_bytes = Some((b.to_vec(), ext));
                    }
                }
            }
            "slides" => {
                if let Ok(text) = field.text().await {
                    if !text.is_empty() {
                        slides_json = Some(text);
                    }
                }
            }
            "captions" => {
                if let Ok(b) = field.bytes().await {
                    if !b.is_empty() {
                        captions_bytes = Some(b.to_vec());
                    }
                }
            }
            _ => {}
        }
    }

    let Some(slides_str) = slides_json else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if name.is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Ok(slides) = serde_json::from_str::<Vec<RecordingSlideInput>>(&slides_str) else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    let captions_data = captions_bytes.unwrap_or_else(|| b"WEBVTT\n".to_vec());
    let (video_path, video_data) = match video_bytes {
        Some((data, ext)) => (Some(format!("video.{ext}")), Some(data)),
        None => (None, None),
    };

    let rec = match Recording::create(pid, name, video_path.clone(), "captions.vtt".to_string(), &db).await {
        Ok(r) => r,
        Err(e) => { eprintln!("add_recording: Recording::create failed: {e:?}"); return StatusCode::INTERNAL_SERVER_ERROR.into_response(); }
    };

    let dir = format!("assets/{}", rec.id);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        eprintln!("add_recording: create_dir_all {dir} failed: {e:?}");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    if let (Some(filename), Some(data)) = (video_path, video_data) {
        if let Err(e) = tokio::fs::write(format!("{dir}/{filename}"), &data).await {
            eprintln!("add_recording: write video failed: {e:?}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }
    if let Err(e) = tokio::fs::write(format!("{dir}/captions.vtt"), &captions_data).await {
        eprintln!("add_recording: write captions failed: {e:?}");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    if let Err(e) = RecordingSlide::create_batch(rec.id, slides, &db).await {
        eprintln!("add_recording: create_batch failed: {e:?}");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    Redirect::to("/user/presentations").into_response()
}

/// Builds the application router and state from an already-migrated database pool.
///
/// Accepts any `SqlitePool` (file-based or in-memory). The caller is responsible
/// for running migrations before passing the pool in. Returns both the router (for
/// serving) and the app state (so the caller can retain it for signal handling).
pub async fn build_app(db_pool: SqlitePool) -> (Router, AppState) {
    let session_store = SqliteStore::new(db_pool.clone());
    session_store.migrate().await.unwrap();
    let session_layer = SessionManagerLayer::new(session_store)
        // with_secure(false): Caddy terminates TLS; this binary binds to localhost:5002 only.
        // Session cookies are never sent over plain HTTP in production.
        .with_secure(false)
        .with_expiry(Expiry::OnInactivity(Duration::days(1)));
    let tera = Tera::new();
    let backend = Backend::new(db_pool.clone());
    let auth_layer = AuthManagerLayerBuilder::new(backend, session_layer).build();
    let state = AppState {
        tera,
        slides: Arc::new(Mutex::new(HashMap::new())),
        db_pool,
    };
    let router = Router::new()
        .route("/", get(index))
        .route("/auth/login", get(login))
        .route("/auth/login", post(login_process))
        .route("/auth/logout", get(logout))
        .route("/user/presentations", get(presentations))
        .route("/user/recordings/{rid}/delete", post(delete_recording))
        .route("/user/presentations/{pid}/delete", post(delete_presentation))
        .route("/user/presentations/{pid}/access/add", post(add_access))
        .route("/user/presentations/{pid}/access/remove", post(remove_access))
        .route("/users/exists", get(user_exists))
        .route(
            "/user/presentations/{pid}/access/change-role",
            post(change_access_role),
        )
        .route(
            "/user/presentations/{pid}/access/mode",
            post(set_presentation_access_mode),
        )
        .route(
            "/user/recordings/{rid}/access/mode",
            post(set_recording_access_mode),
        )
        .route(
            "/user/recordings/{rid}/slides/{sid}/time",
            post(update_slide_time),
        )
        .route("/user/recordings/{rid}/name", post(update_recording_name))
        .route(
            "/user/presentations/{pid}/name",
            post(update_presentation_name),
        )
        .route("/user/change_pwd", get(change_pwd))
        .route("/user/change_pwd", post(change_pwd_form))
        .route("/user/new", get(new_user))
        .route("/user/new", post(new_user_form))
        .route("/join", get(join))
        .route("/create", get(start))
        .route("/create", post(start_pres))
        .route("/{uname}/{pid}", get(present))
        .route("/qr/{uname}/{pid}", get(qr_code))
        .route("/ws/{pid}", get(broadcast_to_all))
        .route("/demo", get(demo))
        .route("/help", get(help))
        .route("/{uname}/{pid}/edit", get(edit_pres))
        .route("/{uname}/{pid}/{rid}", get(recording))
        .route("/{uname}/{pid}/{rid}/slides.vtt", get(slides_vtt))
        .route("/{uname}/{pid}/{rid}/slides.html", get(slides_html))
        .nest_service("/css", ServeDir::new("css/"))
        .nest_service("/js", ServeDir::new("js/"))
        .nest_service("/assets", ServeDir::new("assets/"))
        .merge(
            Router::new()
                .route(
                    "/user/presentations/{pid}/recordings",
                    post(add_recording),
                )
                .route(
                    "/user/recordings/{rid}/files",
                    post(update_recording_files),
                )
                .layer(DefaultBodyLimit::disable()),
        )
        .with_state(state.clone())
        .layer(auth_layer);
    (router, state)
}

/// Dynamic cleanup of still open presentations.
fn cleanup(state: &mut AppState) {
    let mut slides = state.slides.lock().unwrap();
    slides.retain(|_k, v| Arc::strong_count(v) > 1);
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let port = std::env::var("APP_PORT").unwrap_or_else(|_| "5002".to_string());
    let db_url = std::env::var("APP_DB").unwrap_or_else(|_| "sqlite://db.sqlite3".to_string());
    let mut signals = Signals::new([SIGUSR1]).unwrap();
    let sig_handle = signals.handle();
    let migrate_pool = SqlitePool::connect_with(
        SqliteConnectOptions::from_str(&db_url)
            .unwrap()
            .create_if_missing(true)
            .foreign_keys(false),
    )
    .await
    .unwrap();
    sqlx::migrate!("./migrations").run(&migrate_pool).await.unwrap();
    migrate_pool.close().await;
    let db_pool = SqlitePool::connect_with(
        SqliteConnectOptions::from_str(&db_url)
            .unwrap()
            .create_if_missing(true)
            .foreign_keys(true),
    )
    .await
    .unwrap();
    let (app, state) = build_app(db_pool).await;
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .unwrap();
    let mut state_for_signal = state;
    let signal_task = tokio::spawn(async move {
        use futures_util::StreamExt;
        while let Some(_sig) = signals.next().await {
            cleanup(&mut state_for_signal);
        }
    });
    axum::serve(listener, app).await.unwrap();
    sig_handle.close();
    let _ = signal_task.await;
}

#[cfg(test)]
#[allow(clippy::pedantic, missing_docs)]
mod tests {
    use super::*;
    use axum_test::TestServer;
    use sqlx::sqlite::SqlitePoolOptions;

    /// Creates a `TestServer` backed by a fresh isolated in-memory database.
    ///
    /// Uses `max_connections(1)` so that all queries share one SQLite connection
    /// (and therefore one in-memory database). Migrations run with FK enforcement
    /// off (some migrations DROP TABLE), then FK enforcement is enabled before
    /// handing the pool to `build_app`.
    ///
    /// Returns both the server and the app state. The test has access to
    /// `state.db_pool` for seeding data before making requests.
    async fn test_server() -> (TestServer, AppState) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::from_str("sqlite::memory:")
                    .unwrap()
                    .foreign_keys(false),
            )
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        // Enable FK enforcement on the single connection now that migrations are done.
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .unwrap();
        let (router, state) = build_app(pool).await;
        // save_cookies() makes the TestServer persist Set-Cookie headers between
        // requests, which is how session auth is maintained across test steps.
        //
        // API note: if this call does not compile for the installed version of
        // axum-test, check the crate docs for the equivalent cookie persistence
        // configuration (look for TestServerConfig, save_cookies, or similar).
        let server = TestServer::builder()
            .save_cookies()
            .build(router)
            .unwrap();
        (server, state)
    }

    /// Seeds one user into the database using the same `User::new` path the app uses.
    ///
    /// The groups table row for id=1 ("admin") is created by migrations.
    /// Do not re-insert it. This user is not added to any group; group membership
    /// is not needed for basic login and session tests.
    async fn seed_user(pool: &SqlitePool) {
        User::new(
            pool,
            AddUserForm {
                name: "testuser".to_string(),
                email: "test@example.com".to_string(),
                password: "testpass".to_string(),
            },
        )
        .await
        .unwrap();
    }

    async fn seed_admin_user(pool: &SqlitePool) {
        User::new(
            pool,
            AddUserForm {
                name: "adminuser".to_string(),
                email: "admin2@example.com".to_string(),
                password: "adminpass".to_string(),
            },
        )
        .await
        .unwrap();
        sqlx::query("INSERT INTO group_users (user_id, group_id) VALUES ((SELECT id FROM users WHERE name = 'adminuser'), 1)")
            .execute(pool)
            .await
            .unwrap();
    }

    async fn login_as(server: &axum_test::TestServer, username: &str, password: &str) {
        server
            .post("/auth/login")
            .form(&serde_json::json!({ "username": username, "password": password }))
            .await;
    }

    async fn seed_presentation(user_id: i64, name: &str, pool: &SqlitePool) -> i64 {
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO presentation (name, user_id, content) VALUES (?, ?, '') RETURNING id",
        )
        .bind(name)
        .bind(user_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn get_user_id(name: &str, pool: &SqlitePool) -> i64 {
        sqlx::query_scalar::<_, i64>("SELECT id FROM users WHERE name = ?")
            .bind(name)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// POST /create with a valid name must redirect to /{username}/{pid}/edit.
    #[tokio::test]
    async fn create_presentation_redirects_to_edit() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        login_as(&server, "testuser", "testpass").await;

        let response = server
            .post("/create")
            .form(&serde_json::json!({ "name": "Test Pres" }))
            .await;

        assert_eq!(response.status_code(), 303);
        let location = response.headers()["location"].to_str().unwrap();
        assert!(
            location.starts_with("/testuser/") && location.ends_with("/edit"),
            "create must redirect to /{{username}}/{{pid}}/edit, got: {location}"
        );
    }

    /// Deleting your own presentation must redirect to /user/presentations
    /// and the row must be gone from the database.
    #[tokio::test]
    async fn delete_own_presentation_removes_it() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let uid = get_user_id("testuser", &state.db_pool).await;
        let pid = seed_presentation(uid, "To Delete", &state.db_pool).await;
        login_as(&server, "testuser", "testpass").await;

        let response = server
            .post(&format!("/user/presentations/{pid}/delete"))
            .await;

        assert_eq!(response.status_code(), 303);
        assert_eq!(response.headers()["location"], "/user/presentations");

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM presentation WHERE id = ?")
                .bind(pid)
                .fetch_one(&state.db_pool)
                .await
                .unwrap();
        assert_eq!(count, 0, "deleted presentation must not exist in the database");
    }

    /// Attempting to delete another user's presentation must leave it intact.
    /// The handler redirects (303) but the ownership check in the SQL means
    /// no row is deleted when user_id does not match.
    #[tokio::test]
    async fn delete_other_users_presentation_is_noop() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        seed_admin_user(&state.db_pool).await;
        let owner_id = get_user_id("adminuser", &state.db_pool).await;
        let pid = seed_presentation(owner_id, "Owner's Pres", &state.db_pool).await;
        // Log in as a different user (testuser) and try to delete adminuser's presentation.
        login_as(&server, "testuser", "testpass").await;

        server
            .post(&format!("/user/presentations/{pid}/delete"))
            .await;

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM presentation WHERE id = ?")
                .bind(pid)
                .fetch_one(&state.db_pool)
                .await
                .unwrap();
        assert_eq!(count, 1, "another user's presentation must not be deleted");
    }

    /// POST /user/presentations/{pid}/name with a plain-text body must return 200.
    #[tokio::test]
    async fn rename_presentation_returns_200() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let uid = get_user_id("testuser", &state.db_pool).await;
        let pid = seed_presentation(uid, "Old Name", &state.db_pool).await;
        login_as(&server, "testuser", "testpass").await;

        let response = server
            .post(&format!("/user/presentations/{pid}/name"))
            .text("New Name")
            .await;

        assert_eq!(response.status_code(), 200);
    }

    /// Successful login must redirect to `/` (HTTP 303 See Other).
    #[tokio::test]
    async fn login_correct_credentials_redirects_to_home() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;

        let response = server
            .post("/auth/login")
            .form(&serde_json::json!({
                "username": "testuser",
                "password": "testpass"
            }))
            .await;

        assert_eq!(response.status_code(), 303);
        assert_eq!(
            response.headers()["location"],
            "/",
            "successful login must redirect to /"
        );
    }

    /// Wrong password must re-render the login page (HTTP 200), not redirect.
    #[tokio::test]
    async fn login_wrong_password_returns_login_page() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;

        let response = server
            .post("/auth/login")
            .form(&serde_json::json!({
                "username": "testuser",
                "password": "wrongpass"
            }))
            .await;

        assert_eq!(
            response.status_code(),
            200,
            "wrong password should return 200 (re-render login page), not redirect"
        );
        assert!(
            response.text().contains("Invalid username or password."),
            "wrong password must show an error message (WCAG 3.3.1 Error Identification)"
        );
    }

    /// Accessing a protected route without a session must redirect to `/auth/login`.
    #[tokio::test]
    async fn presentations_without_session_redirects_to_login() {
        let (server, _state) = test_server().await;

        let response = server.get("/user/presentations").await;

        assert_eq!(response.status_code(), 303);
        assert_eq!(
            response.headers()["location"],
            "/auth/login",
            "unauthenticated request must redirect to /auth/login"
        );
    }

    /// Inserts a recording row for the given presentation and returns its id.
    async fn seed_recording(presentation_id: i64, pool: &SqlitePool) -> i64 {
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO recording (presentation_id, name, captions_path, start) VALUES (?, 'Test Recording', 'captions.vtt', '2026-01-01T00:00:00+00:00') RETURNING id",
        )
        .bind(presentation_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Inserts a recording_slide row for the given recording and returns its id.
    async fn seed_recording_slide(recording_id: i64, pool: &SqlitePool) -> i64 {
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO recording_slide (recording_id, start_seconds, position, title, content) VALUES (?, 0.0, 0, 'Slide 1', 'content') RETURNING id",
        )
        .bind(recording_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Deleting a presentation must remove all its recording_slide rows.
    /// recording_slide has no ON DELETE CASCADE — DbPresentation::delete
    /// performs the cleanup manually. If this ever breaks, recording_slide
    /// rows become orphaned and FK enforcement will block future deletions.
    #[tokio::test]
    async fn delete_presentation_removes_recording_slides() {
        let (_server, state) = test_server().await;
        // test_server seeds admin/admin from migrations; use that directly.
        let uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(uid, "With Recordings", &state.db_pool).await;
        let rid = seed_recording(pid, &state.db_pool).await;
        let sid = seed_recording_slide(rid, &state.db_pool).await;

        DbPresentation::delete(pid, uid, &state.db_pool).await.unwrap();

        let pres_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM presentation WHERE id = ?")
                .bind(pid)
                .fetch_one(&state.db_pool)
                .await
                .unwrap();
        let rec_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM recording WHERE id = ?")
                .bind(rid)
                .fetch_one(&state.db_pool)
                .await
                .unwrap();
        let slide_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM recording_slide WHERE id = ?")
                .bind(sid)
                .fetch_one(&state.db_pool)
                .await
                .unwrap();

        assert_eq!(pres_count, 0, "presentation row must be deleted");
        assert_eq!(rec_count, 0, "recording row must be deleted");
        assert_eq!(slide_count, 0, "recording_slide row must be deleted (manual cascade)");
    }

    /// POST /user/new by a non-admin authenticated user must return 404.
    /// The handler explicitly returns NOT_FOUND (not 403) to avoid leaking
    /// the existence of the admin-only endpoint to non-admin users.
    #[tokio::test]
    async fn create_user_by_non_admin_returns_404() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        // testuser has no group membership — not in the admin group.
        login_as(&server, "testuser", "testpass").await;

        let response = server
            .post("/user/new")
            .form(&serde_json::json!({
                "name": "newuser",
                "email": "new@example.com",
                "password": "password123"
            }))
            .await;

        assert_eq!(
            response.status_code(),
            404,
            "non-admin must not be able to create users"
        );
        // The user must not have been created.
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE name = 'newuser'")
                .fetch_one(&state.db_pool)
                .await
                .unwrap();
        assert_eq!(count, 0, "new user must not exist after rejected request");
    }

    /// After a successful login, the session cookie must grant access to protected routes.
    #[tokio::test]
    async fn presentations_with_valid_session_returns_200() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;

        // Establish a session. The TestServer saves the Set-Cookie from this
        // response and sends it on subsequent requests.
        server
            .post("/auth/login")
            .form(&serde_json::json!({
                "username": "testuser",
                "password": "testpass"
            }))
            .await;

        let response = server.get("/user/presentations").await;
        assert_eq!(
            response.status_code(),
            200,
            "authenticated request should return 200"
        );
    }

    // --- FAQ merge tests ---

    #[tokio::test]
    async fn test_home_faq_presenter_section_removed() {
        let (server, _state) = test_server().await;
        let response = server.get("/").await;
        response.assert_status_ok();
        let body = response.text();
        assert!(
            !body.contains("For Presenters"),
            "home page should not contain the For Presenters heading after merge"
        );
    }

    #[tokio::test]
    async fn test_home_faq_audience_section_intact() {
        let (server, _state) = test_server().await;
        let response = server.get("/").await;
        response.assert_status_ok();
        let body = response.text();
        assert!(
            body.contains("How does an audience member follow along"),
            "home page should still contain audience FAQ questions"
        );
    }

    #[tokio::test]
    async fn test_help_editing_slides_expanded() {
        let (server, _state) = test_server().await;
        let response = server.get("/help").await;
        response.assert_status_ok();
        let body = response.text();
        assert!(
            body.contains("KaTeX"),
            "help page should mention KaTeX math support"
        );
        assert!(
            body.contains("saved as you type"),
            "help page should mention autosave"
        );
        assert!(
            body.contains("pushed to all connected audience members instantly"),
            "help page should mention live sync pushing edits instantly"
        );
    }

    #[tokio::test]
    async fn test_help_recording_expanded() {
        let (server, _state) = test_server().await;
        let response = server.get("/help").await;
        response.assert_status_ok();
        let body = response.text();
        assert!(
            body.contains("WebVTT"),
            "help page should mention WebVTT export in the Recording section"
        );
        assert!(
            body.contains("12.5s"),
            "help page should show dropdown label format example including timestamp"
        );
    }

    /// The presentation_access table must exist after migrations and accept
    /// a valid (presentation_id, user_id, role) row.
    #[tokio::test]
    async fn presentation_access_table_exists_and_accepts_rows() {
        let (_server, state) = test_server().await;
        let uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(uid, "Access Test", &state.db_pool).await;

        // Insert a second user to be the co-presenter
        User::new(
            &state.db_pool,
            AddUserForm {
                name: "copresenter".to_string(),
                email: "co@example.com".to_string(),
                password: "copass".to_string(),
            },
        )
        .await
        .unwrap();
        let co_uid = get_user_id("copresenter", &state.db_pool).await;

        sqlx::query(
            "INSERT INTO presentation_access (presentation_id, user_id, role) VALUES (?, ?, 'editor')",
        )
        .bind(pid)
        .bind(co_uid)
        .execute(&state.db_pool)
        .await
        .expect("presentation_access table must accept a valid row");

        let role: String = sqlx::query_scalar(
            "SELECT role FROM presentation_access WHERE presentation_id = ? AND user_id = ?",
        )
        .bind(pid)
        .bind(co_uid)
        .fetch_one(&state.db_pool)
        .await
        .unwrap();
        assert_eq!(role, "editor");
    }

    /// A Controller role must not be permitted to send a Name message.
    /// handle_socket must return Ok(true) (keep connection open, message dropped).
    #[tokio::test]
    async fn ws_controller_cannot_send_name_message() {
        let (_server, state) = test_server().await;
        let (tx, _rx) = tokio::sync::broadcast::channel::<SlideMessage>(8);
        let mut tx = tx;
        let msg = axum::extract::ws::Message::text(
            serde_json::to_string(&SlideMessage::Name("hacked".to_string())).unwrap(),
        );
        let mut state_clone = state.clone();
        let uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(uid, "WS Test", &state.db_pool).await;
        let result = handle_socket(Ok(msg), &pid.to_string(), &mut tx, &mut state_clone, &AccessResult::Controller);
        assert!(
            matches!(result, Ok(true)),
            "Controller sending Name must be silently dropped (Ok(true)), not an error"
        );
    }

    /// An Editor role must be permitted to send a Slide message.
    #[tokio::test]
    async fn ws_editor_can_send_slide_message() {
        let (_server, state) = test_server().await;
        let uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(uid, "WS Test 2", &state.db_pool).await;
        let mut state_clone = state.clone();

        {
            let (tx_inner, rx_inner) = tokio::sync::broadcast::channel::<SlideMessage>(8);
            state_clone.slides.lock().unwrap().insert(
                pid.to_string(),
                Arc::new(Mutex::new(Presentation {
                    content: String::new(),
                    slide: 0,
                    channel: (tx_inner, rx_inner),
                    recording: None,
                    presenter_count: 0,
                })),
            );
        }

        let (tx, mut rx) = tokio::sync::broadcast::channel::<SlideMessage>(8);
        let mut tx_clone = tx;
        let msg = axum::extract::ws::Message::text(
            serde_json::to_string(&SlideMessage::Slide(2)).unwrap(),
        );
        let result = handle_socket(Ok(msg), &pid.to_string(), &mut tx_clone, &mut state_clone, &AccessResult::Editor);
        assert!(matches!(result, Ok(true)), "Editor must be able to send Slide");
        let received = rx.try_recv();
        assert!(
            matches!(received, Ok(SlideMessage::Slide(2))),
            "Slide message must be broadcast when sent by Editor"
        );
    }

    /// POST /user/presentations/{pid}/access/add by the owner must insert the row
    /// and redirect to /user/presentations.
    #[tokio::test]
    async fn add_access_as_owner_inserts_row() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let uid = get_user_id("testuser", &state.db_pool).await;
        let pid = seed_presentation(uid, "Shared Pres", &state.db_pool).await;
        // Create a second user to add as co-presenter
        User::new(
            &state.db_pool,
            AddUserForm {
                name: "couser".to_string(),
                email: "co@example.com".to_string(),
                password: "copass".to_string(),
            },
        )
        .await
        .unwrap();
        login_as(&server, "testuser", "testpass").await;

        let response = server
            .post(&format!("/user/presentations/{pid}/access/add"))
            .form(&serde_json::json!({ "username": "couser", "role": "editor" }))
            .await;

        assert_eq!(response.status_code(), 303);
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM presentation_access WHERE presentation_id = ?",
        )
        .bind(pid)
        .fetch_one(&state.db_pool)
        .await
        .unwrap();
        assert_eq!(count, 1, "access row must be inserted");
    }

    /// POST .../access/add by a non-owner must return 404.
    #[tokio::test]
    async fn add_access_by_non_owner_returns_404() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        seed_admin_user(&state.db_pool).await;
        let owner_id = get_user_id("adminuser", &state.db_pool).await;
        let pid = seed_presentation(owner_id, "Owner Pres", &state.db_pool).await;
        login_as(&server, "testuser", "testpass").await;

        let response = server
            .post(&format!("/user/presentations/{pid}/access/add"))
            .form(&serde_json::json!({ "username": "adminuser", "role": "editor" }))
            .await;

        assert_eq!(response.status_code(), 404);
    }

    /// POST .../access/remove by the owner must delete the row.
    #[tokio::test]
    async fn remove_access_as_owner_deletes_row() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let uid = get_user_id("testuser", &state.db_pool).await;
        let pid = seed_presentation(uid, "Rm Pres", &state.db_pool).await;
        User::new(
            &state.db_pool,
            AddUserForm {
                name: "couser2".to_string(),
                email: "co2@example.com".to_string(),
                password: "copass2".to_string(),
            },
        )
        .await
        .unwrap();
        let co_uid = get_user_id("couser2", &state.db_pool).await;
        PresentationAccess::add(&state.db_pool, pid, co_uid, "editor").await.unwrap();
        login_as(&server, "testuser", "testpass").await;

        let response = server
            .post(&format!("/user/presentations/{pid}/access/remove"))
            .form(&serde_json::json!({ "user_id": co_uid }))
            .await;

        assert_eq!(response.status_code(), 303);
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM presentation_access WHERE presentation_id = ?")
                .bind(pid)
                .fetch_one(&state.db_pool)
                .await
                .unwrap();
        assert_eq!(count, 0, "access row must be deleted");
    }

    /// POST .../access/change-role by the owner must update the role in the DB.
    #[tokio::test]
    async fn change_access_role_as_owner_updates_role() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let uid = get_user_id("testuser", &state.db_pool).await;
        let pid = seed_presentation(uid, "Change Role Pres", &state.db_pool).await;
        User::new(
            &state.db_pool,
            AddUserForm {
                name: "couser3".to_string(),
                email: "co3@example.com".to_string(),
                password: "copass3".to_string(),
            },
        )
        .await
        .unwrap();
        let co_uid = get_user_id("couser3", &state.db_pool).await;
        PresentationAccess::add(&state.db_pool, pid, co_uid, "editor").await.unwrap();
        login_as(&server, "testuser", "testpass").await;

        let response = server
            .post(&format!("/user/presentations/{pid}/access/change-role"))
            .form(&serde_json::json!({ "user_id": co_uid, "role": "controller" }))
            .await;

        assert_eq!(response.status_code(), 303);
        let role: String = sqlx::query_scalar(
            "SELECT role FROM presentation_access WHERE presentation_id = ? AND user_id = ?",
        )
        .bind(pid)
        .bind(co_uid)
        .fetch_one(&state.db_pool)
        .await
        .unwrap();
        assert_eq!(role, "controller", "role must be updated to controller");
    }

    /// GET /{uname}/{pid} by an editor must redirect to the stage (same as owner).
    /// The response is 200 (stage.html is rendered, not a redirect — stage() renders directly).
    /// stage.html does not contain the markdown editor; that is in edit.html.
    #[tokio::test]
    async fn editor_gets_stage_access() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(uid, "Editor Stage Test", &state.db_pool).await;
        User::new(
            &state.db_pool,
            AddUserForm {
                name: "editoruser".to_string(),
                email: "ed@example.com".to_string(),
                password: "edpass".to_string(),
            },
        )
        .await
        .unwrap();
        let ed_uid = get_user_id("editoruser", &state.db_pool).await;
        PresentationAccess::add(&state.db_pool, pid, ed_uid, "editor").await.unwrap();
        login_as(&server, "editoruser", "edpass").await;

        let response = server.get(&format!("/admin/{pid}")).await;

        assert_eq!(response.status_code(), 200);
        assert!(
            response.text().contains(r#"id="recordPause""#),
            "editor must see the record button on stage"
        );
        assert!(
            !response.text().contains(r#"id="markdown-input""#),
            "editor must not see the markdown editor on stage"
        );
    }

    /// GET /user/presentations must include presentations shared with the user.
    #[tokio::test]
    async fn presentations_list_includes_shared() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let admin_id = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(admin_id, "Shared With Testuser", &state.db_pool).await;
        let testuser_id = get_user_id("testuser", &state.db_pool).await;
        PresentationAccess::add(&state.db_pool, pid, testuser_id, "editor").await.unwrap();
        login_as(&server, "testuser", "testpass").await;

        let response = server.get("/user/presentations").await;

        assert_eq!(response.status_code(), 200);
        assert!(
            response.text().contains("Shared With Testuser"),
            "shared presentation must appear in testuser's list"
        );
    }

    /// GET /user/presentations must link shared presentations using the owner's username, not the viewer's.
    #[tokio::test]
    async fn presentations_list_shared_link_uses_owner_name() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let admin_id = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(admin_id, "Owner Link Test", &state.db_pool).await;
        let testuser_id = get_user_id("testuser", &state.db_pool).await;
        PresentationAccess::add(&state.db_pool, pid, testuser_id, "editor").await.unwrap();
        login_as(&server, "testuser", "testpass").await;

        let response = server.get("/user/presentations").await;
        let body = response.text();

        assert!(
            body.contains(&format!("/admin/{pid}")),
            "shared presentation link must use owner's username (admin), not viewer's"
        );
        assert!(
            !body.contains(&format!("/testuser/{pid}")),
            "shared presentation link must not use viewer's username"
        );
    }

    /// GET /{uname}/{pid} by a controller must get stage access.
    #[tokio::test]
    async fn controller_gets_stage_access() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(uid, "Controller Stage Test", &state.db_pool).await;
        User::new(
            &state.db_pool,
            AddUserForm {
                name: "ctrluser".to_string(),
                email: "ctrl@example.com".to_string(),
                password: "ctrlpass".to_string(),
            },
        )
        .await
        .unwrap();
        let ctrl_uid = get_user_id("ctrluser", &state.db_pool).await;
        PresentationAccess::add(&state.db_pool, pid, ctrl_uid, "controller").await.unwrap();
        login_as(&server, "ctrluser", "ctrlpass").await;

        let response = server.get(&format!("/admin/{pid}")).await;
        assert_eq!(response.status_code(), 200);
        assert!(
            response.text().contains(r#"id="recordPause""#),
            "controller must see the record button on stage"
        );
        assert!(
            !response.text().contains(r#"id="markdown-input""#),
            "controller must not see the markdown editor"
        );
    }

    /// GET /{editor_name}/{pid} must redirect 308 (permanent) to /{owner_name}/{pid}.
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

        assert_eq!(response.status_code(), 308);
        let location = response.headers()["location"].to_str().unwrap();
        assert_eq!(location, &format!("/admin/{pid}"));
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

    /// GET /users/exists?username=testuser returns 200 when user exists and caller is authenticated.
    #[tokio::test]
    async fn user_exists_returns_200_for_known_user() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        login_as(&server, "testuser", "testpass").await;
        let response = server
            .get("/users/exists")
            .add_query_param("username", "testuser")
            .await;
        assert_eq!(response.status_code(), 200);
    }

    /// GET /users/exists?username=nobody returns 404 when user does not exist.
    #[tokio::test]
    async fn user_exists_returns_404_for_unknown_user() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        login_as(&server, "testuser", "testpass").await;
        let response = server
            .get("/users/exists")
            .add_query_param("username", "nobody")
            .await;
        assert_eq!(response.status_code(), 404);
    }

    /// GET /users/exists without the username query param must return 400 Bad Request.
    #[tokio::test]
    async fn user_exists_returns_400_when_username_missing() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        login_as(&server, "testuser", "testpass").await;
        let response = server.get("/users/exists").await;
        assert_eq!(response.status_code(), 400);
    }

    /// GET /users/exists without a session must return 401 Unauthorized.
    #[tokio::test]
    async fn user_exists_requires_auth() {
        let (server, _state) = test_server().await;
        // axum-test does not follow redirects — the raw response status is returned.
        let response = server
            .get("/users/exists")
            .add_query_param("username", "admin")
            .await;
        assert_eq!(response.status_code(), 401u16);
    }

    /// GET /users/exists without session AND without username param must return 401, not 400.
    #[tokio::test]
    async fn user_exists_unauthenticated_missing_param_returns_401() {
        let (server, _state) = test_server().await;
        let response = server.get("/users/exists").await;
        assert_eq!(response.status_code(), 401u16);
    }

    /// POST /user/presentations/{pid}/access/mode must save the mode and redirect.
    #[tokio::test]
    async fn set_presentation_access_mode_as_owner() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let uid = get_user_id("testuser", &state.db_pool).await;
        let pid = seed_presentation(uid, "Mode Test", &state.db_pool).await;
        login_as(&server, "testuser", "testpass").await;

        let resp = server
            .post(&format!("/user/presentations/{pid}/access/mode"))
            .form(&serde_json::json!({ "mode": "private" }))
            .await;
        assert_eq!(resp.status_code(), 303);

        let mode: String = sqlx::query_scalar("SELECT access_mode FROM presentation WHERE id = ?")
            .bind(pid)
            .fetch_one(&state.db_pool)
            .await
            .unwrap();
        assert_eq!(mode, "private");
    }

    /// POST /user/presentations/{pid}/access/mode by a non-owner must return 404.
    #[tokio::test]
    async fn set_presentation_access_mode_non_owner_returns_404() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let admin_uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(admin_uid, "Admin Pres", &state.db_pool).await;
        login_as(&server, "testuser", "testpass").await;

        let resp = server
            .post(&format!("/user/presentations/{pid}/access/mode"))
            .form(&serde_json::json!({ "mode": "private" }))
            .await;
        assert_eq!(resp.status_code(), 404);
    }

    /// POST /user/recordings/{rid}/access/mode must save the mode.
    #[tokio::test]
    async fn set_recording_access_mode_as_owner() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let uid = get_user_id("testuser", &state.db_pool).await;
        let pid = seed_presentation(uid, "Rec Mode Test", &state.db_pool).await;
        login_as(&server, "testuser", "testpass").await;

        let rid: i64 = sqlx::query_scalar(
            "INSERT INTO recording (presentation_id, name, captions_path)
             VALUES (?, 'Rec', 'rec.vtt') RETURNING id"
        )
        .bind(pid)
        .fetch_one(&state.db_pool)
        .await
        .unwrap();

        let resp = server
            .post(&format!("/user/recordings/{rid}/access/mode"))
            .form(&serde_json::json!({ "action": "set", "mode": "private" }))
            .await;
        assert_eq!(resp.status_code(), 303);

        let mode: Option<String> = sqlx::query_scalar("SELECT access_mode FROM recording WHERE id = ?")
            .bind(rid)
            .fetch_one(&state.db_pool)
            .await
            .unwrap();
        assert_eq!(mode, Some("private".to_string()));
    }

    /// POST /user/recordings/{rid}/access/mode with action=inherit must set NULL.
    #[tokio::test]
    async fn set_recording_access_mode_inherit() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let uid = get_user_id("testuser", &state.db_pool).await;
        let pid = seed_presentation(uid, "Rec Inherit Test", &state.db_pool).await;
        login_as(&server, "testuser", "testpass").await;

        let rid: i64 = sqlx::query_scalar(
            "INSERT INTO recording (presentation_id, name, captions_path, access_mode)
             VALUES (?, 'Rec', 'rec.vtt', 'private') RETURNING id"
        )
        .bind(pid)
        .fetch_one(&state.db_pool)
        .await
        .unwrap();

        let resp = server
            .post(&format!("/user/recordings/{rid}/access/mode"))
            .form(&serde_json::json!({ "action": "inherit" }))
            .await;
        assert_eq!(resp.status_code(), 303);

        let mode: Option<String> = sqlx::query_scalar("SELECT access_mode FROM recording WHERE id = ?")
            .bind(rid)
            .fetch_one(&state.db_pool)
            .await
            .unwrap();
        assert!(mode.is_none(), "inherit action must set access_mode to NULL");
    }

    /// POST /user/presentations/{pid}/access/add with role=audience must insert the row.
    #[tokio::test]
    async fn add_audience_member_as_owner() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let uid = get_user_id("testuser", &state.db_pool).await;
        let pid = seed_presentation(uid, "Audience Test", &state.db_pool).await;
        User::new(
            &state.db_pool,
            AddUserForm {
                name: "vieweruser".to_string(),
                email: "viewer@example.com".to_string(),
                password: "viewerpass".to_string(),
            },
        ).await.unwrap();
        login_as(&server, "testuser", "testpass").await;

        let resp = server
            .post(&format!("/user/presentations/{pid}/access/add"))
            .form(&serde_json::json!({ "username": "vieweruser", "role": "audience" }))
            .await;
        assert_eq!(resp.status_code(), 303);

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM presentation_access WHERE presentation_id = ? AND role = 'audience'"
        )
        .bind(pid)
        .fetch_one(&state.db_pool)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }

    /// GET /{uname}/{pid}/{rid} must return 403 for unauthenticated access on a private presentation.
    #[tokio::test]
    async fn recording_handler_denies_access_in_private_mode() {
        let (server, state) = test_server().await;
        let uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(uid, "Private Rec Test", &state.db_pool).await;

        sqlx::query("UPDATE presentation SET access_mode = 'private' WHERE id = ?")
            .bind(pid)
            .execute(&state.db_pool)
            .await
            .unwrap();

        let rid: i64 = sqlx::query_scalar(
            "INSERT INTO recording (presentation_id, name, captions_path)
             VALUES (?, 'Rec', 'rec.vtt') RETURNING id"
        )
        .bind(pid)
        .fetch_one(&state.db_pool)
        .await
        .unwrap();

        let resp = server
            .get(&format!("/admin/{pid}/{rid}"))
            .await;
        assert_eq!(resp.status_code(), 403);
    }

    /// GET /{uname}/{pid}/edit by the owner must serve the edit page.
    #[tokio::test]
    async fn owner_gets_edit_page() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(uid, "Edit Page Test", &state.db_pool).await;
        login_as(&server, "admin", "admin").await;

        let response = server.get(&format!("/admin/{pid}/edit")).await;
        assert_eq!(response.status_code(), 200);
        assert!(
            response.text().contains(r#"id="edit-heading""#),
            "edit page must have the edit-heading H1"
        );
        assert!(
            response.text().contains(r#"id="markdown-input""#),
            "edit page must have the markdown textarea"
        );
        assert!(
            !response.text().contains(r#"id="recordPause""#),
            "edit page must not have the record button"
        );
    }

    /// GET /{uname}/{pid}/edit by a controller must redirect to the stage page.
    #[tokio::test]
    async fn controller_edit_redirects_to_stage() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(uid, "Edit Redirect Test", &state.db_pool).await;
        User::new(
            &state.db_pool,
            AddUserForm {
                name: "ctrluser2".to_string(),
                email: "ctrl2@example.com".to_string(),
                password: "ctrlpass2".to_string(),
            },
        )
        .await
        .unwrap();
        let ctrl_uid = get_user_id("ctrluser2", &state.db_pool).await;
        PresentationAccess::add(&state.db_pool, pid, ctrl_uid, "controller").await.unwrap();
        login_as(&server, "ctrluser2", "ctrlpass2").await;

        // axum-test does not follow redirects; verify the redirect then follow manually.
        let redirect_resp = server.get(&format!("/admin/{pid}/edit")).await;
        assert!(
            redirect_resp.status_code().is_redirection(),
            "edit route must redirect a controller"
        );
        let location = redirect_resp
            .headers()
            .get("location")
            .expect("redirect must have a Location header")
            .to_str()
            .unwrap()
            .to_string();
        let stage_resp = server.get(&location).await;
        assert_eq!(stage_resp.status_code(), 200);
        assert!(
            stage_resp.text().contains(r#"id="recordPause""#),
            "controller redirected to stage should see recordPause"
        );
    }

    /// A controller must be able to POST to add_recording.
    #[tokio::test]
    async fn controller_can_add_recording() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(uid, "Recording Perm Test", &state.db_pool).await;
        User::new(
            &state.db_pool,
            AddUserForm {
                name: "ctrlrec".to_string(),
                email: "ctrlrec@example.com".to_string(),
                password: "ctrlrecpass".to_string(),
            },
        )
        .await
        .unwrap();
        let ctrl_uid = get_user_id("ctrlrec", &state.db_pool).await;
        PresentationAccess::add(&state.db_pool, pid, ctrl_uid, "controller").await.unwrap();
        login_as(&server, "ctrlrec", "ctrlrecpass").await;

        // Multipart form with required fields: name + slides JSON
        let form = axum_test::multipart::MultipartForm::new()
            .add_text("name", "Test Recording")
            .add_text("slides", "[]");
        let response = server
            .post(&format!("/user/presentations/{pid}/recordings"))
            .multipart(form)
            .await;
        // Must not be 403
        assert_ne!(
            response.status_code(),
            axum::http::StatusCode::FORBIDDEN,
            "controller must not be forbidden from adding a recording"
        );
    }

    /// render_all_slides must return one (title, html) pair per ## heading.
    #[test]
    fn render_all_slides_splits_on_h2() {
        let md = "## Intro\nHello world\n\n## Second\nContent here";
        let slides = render_all_slides(md);
        assert_eq!(slides.len(), 2);
        assert_eq!(slides[0].0, "Intro");
        assert!(slides[0].1.contains("Hello world"), "got: {}", slides[0].1);
        assert_eq!(slides[1].0, "Second");
        assert!(slides[1].1.contains("Content here"), "got: {}", slides[1].1);
    }

    /// render_all_slides must return empty vec for content with no ## headings.
    #[test]
    fn render_all_slides_empty_for_no_headings() {
        let slides = render_all_slides("just some text");
        assert_eq!(slides.len(), 0);
    }

    /// Creates an isolated in-memory pool with migrations applied.
    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::from_str("sqlite::memory:")
                    .unwrap()
                    .foreign_keys(false),
            )
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    /// Creates a user with the given name and returns the User struct.
    async fn make_user(pool: &SqlitePool, name: &str) -> User {
        User::new(
            pool,
            AddUserForm {
                name: name.to_string(),
                email: format!("{name}@example.com"),
                password: "testpass".to_string(),
            },
        )
        .await
        .unwrap();
        User::get_by_name(name.to_string(), pool).await.unwrap().unwrap()
    }

    /// Creates a presentation owned by the given user and returns the DbPresentation.
    async fn make_presentation(owner: &User, pool: &SqlitePool) -> DbPresentation {
        DbPresentation::new(owner, "Test Presentation".to_string(), pool)
            .await
            .unwrap()
    }

    /// Creates an in-memory Presentation arc for unit tests.
    fn make_presentation_arc() -> Arc<Mutex<Presentation>> {
        let (tx, _rx) = broadcast::channel(8);
        let (_, rx_inner) = broadcast::channel(8);
        Arc::new(Mutex::new(Presentation {
            content: "## Intro\nHello\n\n## Second\nWorld".to_string(),
            slide: 0,
            channel: (tx, rx_inner),
            recording: None,
            presenter_count: 0,
        }))
    }

    /// recording_start must insert a recording row and set in-memory state.
    #[tokio::test]
    async fn recording_start_creates_db_row() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner").await;
        let pres_db = make_presentation(&owner, &pool).await;
        let pres = make_presentation_arc();

        let result = handle_recording_message(
            RecordingMessage::RecordingStart,
            &pres,
            pres_db.id,
            &pool,
        ).await;

        assert!(matches!(result, Some(SlideMessage::RecordingStart { elapsed_ms: 0 })));
        assert!(pres.lock().unwrap().recording.is_some());
        // DB row exists
        let rec_id = pres.lock().unwrap().recording.as_ref().unwrap().db_id;
        let row = Recording::get_by_id(rec_id, &pool).await.unwrap();
        assert!(row.is_some());
        assert!(row.unwrap().name.starts_with("Recording"));
    }

    /// recording_start when already active must return None (no-op).
    #[tokio::test]
    async fn recording_start_ignored_if_active() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner2").await;
        let pres_db = make_presentation(&owner, &pool).await;
        let pres = make_presentation_arc();

        handle_recording_message(RecordingMessage::RecordingStart, &pres, pres_db.id, &pool).await;
        let result = handle_recording_message(RecordingMessage::RecordingStart, &pres, pres_db.id, &pool).await;

        assert!(result.is_none());
        // Only one DB row
        let rows: Vec<Recording> = sqlx::query_as::<_, Recording>(
            "SELECT * FROM recording WHERE presentation_id = ?",
        )
        .bind(pres_db.id)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(rows.len(), 1);
    }

    /// recording_stop must write recording_slide rows and clear in-memory state.
    #[tokio::test]
    async fn recording_stop_saves_slides() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner3").await;
        let pres_db = make_presentation(&owner, &pool).await;
        let pres = make_presentation_arc();

        handle_recording_message(RecordingMessage::RecordingStart, &pres, pres_db.id, &pool).await;

        // Simulate a slide change at 2000ms
        {
            let mut p = pres.lock().unwrap();
            let rec = p.recording.as_mut().unwrap();
            rec.slides.push(RecordingEvent { offset_ms: 2000, slide: 1 });
        }

        let result = handle_recording_message(RecordingMessage::RecordingStop, &pres, pres_db.id, &pool).await;

        assert!(matches!(result, Some(SlideMessage::RecordingStop)));
        assert!(pres.lock().unwrap().recording.is_none());

        // recording_slide rows exist
        let rows = sqlx::query_as::<_, RecordingSlide>(
            "SELECT * FROM recording_slide WHERE recording_id = (SELECT id FROM recording WHERE presentation_id = ? ORDER BY id DESC LIMIT 1) ORDER BY position",
        )
        .bind(pres_db.id)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].position, 0);
        assert_eq!(rows[0].title, "Intro");
        assert!((rows[0].start_seconds - 0.0).abs() < 0.001);
        assert_eq!(rows[1].position, 1);
        assert_eq!(rows[1].title, "Second");
        assert!((rows[1].start_seconds - 2.0).abs() < 0.001);
    }

    /// Elapsed time must account for paused periods.
    #[tokio::test]
    async fn recording_pause_resume_elapsed() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner").await;
        let pres_db = make_presentation(&owner, &pool).await;
        let pres = make_presentation_arc();

        // Start
        handle_recording_message(RecordingMessage::RecordingStart, &pres, pres_db.id, &pool).await;

        // Pause immediately — elapsed should be very small (< 100ms)
        let pause_msg = handle_recording_message(RecordingMessage::RecordingPause, &pres, pres_db.id, &pool).await;
        let elapsed_at_pause = match pause_msg {
            Some(SlideMessage::RecordingPause { elapsed_ms }) => elapsed_ms,
            _ => panic!("expected RecordingPause"),
        };
        assert!(elapsed_at_pause < 200, "elapsed at pause was {elapsed_at_pause}ms, expected < 200ms");
        assert!(pres.lock().unwrap().recording.as_ref().unwrap().is_paused);

        // Resume — elapsed should still be small
        let resume_msg = handle_recording_message(RecordingMessage::RecordingResume, &pres, pres_db.id, &pool).await;
        let elapsed_at_resume = match resume_msg {
            Some(SlideMessage::RecordingResume { elapsed_ms }) => elapsed_ms,
            _ => panic!("expected RecordingResume"),
        };
        assert!(!pres.lock().unwrap().recording.as_ref().unwrap().is_paused);
        // elapsed at resume should be >= elapsed at pause (not reset to 0)
        assert!(elapsed_at_resume >= elapsed_at_pause,
            "elapsed at resume ({elapsed_at_resume}) should be >= elapsed at pause ({elapsed_at_pause})");
    }

    /// Pausing when already paused must return None.
    #[tokio::test]
    async fn recording_pause_noop_when_already_paused() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner").await;
        let pres_db = make_presentation(&owner, &pool).await;
        let pres = make_presentation_arc();
        handle_recording_message(RecordingMessage::RecordingStart, &pres, pres_db.id, &pool).await;
        handle_recording_message(RecordingMessage::RecordingPause, &pres, pres_db.id, &pool).await;
        let result = handle_recording_message(RecordingMessage::RecordingPause, &pres, pres_db.id, &pool).await;
        assert!(result.is_none());
    }

    /// When presenter_count drops to 0 with an active recording, the stop logic saves slides.
    #[tokio::test]
    async fn recording_auto_stop_on_last_presenter_disconnect() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner").await;
        let pres_db = make_presentation(&owner, &pool).await;
        let pres = make_presentation_arc();

        // Start recording
        handle_recording_message(RecordingMessage::RecordingStart, &pres, pres_db.id, &pool).await;
        let rec_id = pres.lock().unwrap().recording.as_ref().unwrap().db_id;

        // Simulate auto-stop (same as stop, but called by disconnect handler)
        let result = handle_recording_message(RecordingMessage::RecordingStop, &pres, pres_db.id, &pool).await;
        assert!(matches!(result, Some(SlideMessage::RecordingStop)));
        assert!(pres.lock().unwrap().recording.is_none());

        // last_edited was set
        let rec = Recording::get_by_id(rec_id, &pool).await.unwrap().unwrap();
        assert!(rec.last_edited.is_some());
    }

    /// GET /auth/logout must clear the session and redirect to /.
    #[tokio::test]
    async fn logout_clears_session_and_redirects() {
        let (server, _state) = test_server().await;
        login_as(&server, "admin", "admin").await;

        // Authenticated: presentations page is accessible.
        let before = server.get("/user/presentations").await;
        assert_eq!(before.status_code(), 200);

        let resp = server.get("/auth/logout").await;
        assert!(resp.status_code().is_redirection());

        // After logout: presentations page redirects to login.
        let after = server.get("/user/presentations").await;
        assert!(after.status_code().is_redirection());
        let loc = after.headers().get("location").unwrap().to_str().unwrap();
        assert!(loc.contains("/auth/login"), "expected redirect to login, got {loc}");
    }

    /// POST /user/new by an admin must create the user and redirect.
    #[tokio::test]
    async fn admin_can_create_user() {
        let (server, state) = test_server().await;
        login_as(&server, "admin", "admin").await;

        let resp = server
            .post("/user/new")
            .form(&serde_json::json!({
                "name": "newbie",
                "email": "newbie@example.com",
                "password": "newbiepass"
            }))
            .await;
        assert!(resp.status_code().is_redirection());

        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE name = 'newbie'")
            .fetch_one(&state.db_pool)
            .await
            .unwrap();
        assert_eq!(exists, 1);
    }

    /// POST /user/change_pwd with correct old password must update it.
    #[tokio::test]
    async fn change_pwd_succeeds_with_correct_old_password() {
        let (server, state) = test_server().await;
        login_as(&server, "admin", "admin").await;

        let resp = server
            .post("/user/change_pwd")
            .form(&serde_json::json!({
                "old": "admin",
                "new": "newpass123",
                "confirm": "newpass123"
            }))
            .await;
        assert!(resp.status_code().is_redirection());

        // New password must work for login.
        let login_resp = server
            .post("/auth/login")
            .form(&serde_json::json!({ "username": "admin", "password": "newpass123" }))
            .await;
        assert!(login_resp.status_code().is_redirection());

        // Drop pool to silence unused warning in test context.
        let _ = &state.db_pool;
    }

    /// POST /user/change_pwd with wrong old password must redirect back with an error.
    #[tokio::test]
    async fn change_pwd_rejects_wrong_old_password() {
        let (server, _state) = test_server().await;
        login_as(&server, "admin", "admin").await;

        let resp = server
            .post("/user/change_pwd")
            .form(&serde_json::json!({
                "old": "wrongpassword",
                "new": "newpass123",
                "confirm": "newpass123"
            }))
            .await;
        assert!(resp.status_code().is_redirection());
        let loc = resp.headers().get("location").unwrap().to_str().unwrap();
        assert!(loc.contains("error="), "expected error query param, got {loc}");
    }

    /// POST /user/change_pwd with mismatched new/confirm must redirect with an error.
    #[tokio::test]
    async fn change_pwd_rejects_mismatched_confirm() {
        let (server, _state) = test_server().await;
        login_as(&server, "admin", "admin").await;

        let resp = server
            .post("/user/change_pwd")
            .form(&serde_json::json!({
                "old": "admin",
                "new": "newpass123",
                "confirm": "differentpass"
            }))
            .await;
        assert!(resp.status_code().is_redirection());
        let loc = resp.headers().get("location").unwrap().to_str().unwrap();
        assert!(loc.contains("error="), "expected error query param, got {loc}");
    }

    /// POST /user/recordings/{rid}/delete by owner must remove the row and redirect.
    #[tokio::test]
    async fn delete_recording_as_owner_removes_row() {
        let (server, state) = test_server().await;
        let uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(uid, "Rec Delete Test", &state.db_pool).await;
        let rid: i64 = sqlx::query_scalar(
            "INSERT INTO recording (presentation_id, name, captions_path) VALUES (?, 'Rec', 'r.vtt') RETURNING id"
        )
        .bind(pid)
        .fetch_one(&state.db_pool)
        .await
        .unwrap();

        login_as(&server, "admin", "admin").await;
        let resp = server.post(&format!("/user/recordings/{rid}/delete")).await;
        assert!(resp.status_code().is_redirection());

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM recording WHERE id = ?")
            .bind(rid)
            .fetch_one(&state.db_pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    /// POST /user/recordings/{rid}/delete by non-owner must return 403.
    #[tokio::test]
    async fn delete_recording_as_non_owner_returns_403() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let owner_uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(owner_uid, "Rec Delete Perm Test", &state.db_pool).await;
        let rid: i64 = sqlx::query_scalar(
            "INSERT INTO recording (presentation_id, name, captions_path) VALUES (?, 'Rec', 'r.vtt') RETURNING id"
        )
        .bind(pid)
        .fetch_one(&state.db_pool)
        .await
        .unwrap();

        login_as(&server, "testuser", "testpass").await;
        let resp = server.post(&format!("/user/recordings/{rid}/delete")).await;
        assert_eq!(resp.status_code(), 403);
    }

    /// POST /user/recordings/{rid}/name by owner must update the name.
    #[tokio::test]
    async fn update_recording_name_as_owner() {
        let (server, state) = test_server().await;
        let uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(uid, "Rename Rec Test", &state.db_pool).await;
        let rid: i64 = sqlx::query_scalar(
            "INSERT INTO recording (presentation_id, name, captions_path) VALUES (?, 'OldName', 'r.vtt') RETURNING id"
        )
        .bind(pid)
        .fetch_one(&state.db_pool)
        .await
        .unwrap();

        login_as(&server, "admin", "admin").await;
        let resp = server
            .post(&format!("/user/recordings/{rid}/name"))
            .text("NewName")
            .await;
        assert_eq!(resp.status_code(), 200);

        let name: String = sqlx::query_scalar("SELECT name FROM recording WHERE id = ?")
            .bind(rid)
            .fetch_one(&state.db_pool)
            .await
            .unwrap();
        assert_eq!(name, "NewName");
    }

    /// POST /user/recordings/{rid}/name by non-owner must return 403.
    #[tokio::test]
    async fn update_recording_name_as_non_owner_returns_403() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;
        let owner_uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(owner_uid, "Rename Rec Perm", &state.db_pool).await;
        let rid: i64 = sqlx::query_scalar(
            "INSERT INTO recording (presentation_id, name, captions_path) VALUES (?, 'OldName', 'r.vtt') RETURNING id"
        )
        .bind(pid)
        .fetch_one(&state.db_pool)
        .await
        .unwrap();

        login_as(&server, "testuser", "testpass").await;
        let resp = server
            .post(&format!("/user/recordings/{rid}/name"))
            .text("Hack")
            .await;
        assert_eq!(resp.status_code(), 403);
    }

    /// GET /{uname}/{pid}/{rid}/slides.vtt must return VTT content for accessible recordings.
    #[tokio::test]
    async fn slides_vtt_returns_content_for_public_recording() {
        let (server, state) = test_server().await;
        let uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(uid, "VTT Test", &state.db_pool).await;
        let rid: i64 = sqlx::query_scalar(
            "INSERT INTO recording (presentation_id, name, captions_path) VALUES (?, 'Rec', 'r.vtt') RETURNING id"
        )
        .bind(pid)
        .fetch_one(&state.db_pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO recording_slide (recording_id, position, title, content, start_seconds) VALUES (?, 0, 'Intro', '<h2>Intro</h2>', 0.0)"
        )
        .bind(rid)
        .execute(&state.db_pool)
        .await
        .unwrap();

        let resp = server.get(&format!("/admin/{pid}/{rid}/slides.vtt")).await;
        assert_eq!(resp.status_code(), 200);
        let body = resp.text();
        assert!(body.starts_with("WEBVTT"), "response must be VTT");
        assert!(body.contains("Intro"), "VTT must include slide title");
    }

    /// GET /{uname}/{pid}/{rid}/slides.html must return HTML for accessible recordings.
    #[tokio::test]
    async fn slides_html_returns_content_for_public_recording() {
        let (server, state) = test_server().await;
        let uid = get_user_id("admin", &state.db_pool).await;
        let pid = seed_presentation(uid, "HTML Test", &state.db_pool).await;
        let rid: i64 = sqlx::query_scalar(
            "INSERT INTO recording (presentation_id, name, captions_path) VALUES (?, 'Rec', 'r.vtt') RETURNING id"
        )
        .bind(pid)
        .fetch_one(&state.db_pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO recording_slide (recording_id, position, title, content, start_seconds) VALUES (?, 0, 'Intro', '<h2>Intro</h2>', 0.0)"
        )
        .bind(rid)
        .execute(&state.db_pool)
        .await
        .unwrap();

        let resp = server.get(&format!("/admin/{pid}/{rid}/slides.html")).await;
        assert_eq!(resp.status_code(), 200);
        let body = resp.text();
        assert!(body.contains("<!DOCTYPE html>"), "response must be HTML");
        assert!(body.contains("<section>"), "response must contain slide sections");
    }
}
