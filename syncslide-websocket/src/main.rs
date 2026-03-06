//! `syncslide-websocket`
//!
//! Runs the backend of the `SyncSlide` project.
//!
//! Handles live web-sockets (updating of slides live), as well as templated-HTML for most pages.
//!
#![deny(clippy::all, clippy::pedantic, rustdoc::all, unsafe_code, missing_docs)]

use argon2::{Argon2, PasswordHash, PasswordVerifier};
use qrcode::{QrCode, render::svg};
use axum::{
    Form, Router,
    body::Body,
    extract::{
        DefaultBodyLimit, FromRef, Multipart, Path, State,
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
use tera::{Context, Tera as TeraBase};
use time::Duration;
use tower_http::services::ServeDir;
use tower_sessions::{Expiry, SessionManagerLayer};
use tower_sessions_sqlx_store::SqliteStore;

use tokio::sync::broadcast::{self, Receiver, Sender};

use serde::{Deserialize, Serialize};

use signal_hook::consts::signal::SIGUSR1;
use signal_hook_tokio::Signals;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

mod db;
use db::{
    AddUserForm, AuthSession, Backend, ChangePasswordForm, Group, LoginForm,
    Presentation as DbPresentation, Recording, User,
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
        db: SqlitePool,
    ) -> Response<Body> {
        if let Some(ref user) = auth_session.user {
            ctx.insert("user", &user);
            let pn = DbPresentation::num_for_user(&user, &db).await.unwrap();
            let groups = auth_session
                .backend
                .get_user_permissions(user)
                .await
                .unwrap();
            ctx.insert("pres_num", &pn);
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
    if auth_session.user.is_some() {
        ws.on_upgrade(|socket| ws_handle(socket, pid, state, true))
    } else {
        ws.on_upgrade(|socket| ws_handle(socket, pid, state, false))
    }
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
        }))
    });
    Arc::clone(pres)
}

fn handle_socket(
    msg: Result<Message, axum::Error>,
    pid: &str,
    tx: &mut Sender<SlideMessage>,
    state: &mut AppState,
) -> Result<bool, &'static str> {
    let Ok(msg) = msg else {
        cleanup(state);
        return Err("Disconnected");
    };
    if let Message::Close(_) = msg {
        cleanup(state);
        return Err("Closed");
    }
    let msg: SlideMessage = match serde_json::from_str(msg.to_text().unwrap()) {
        Ok(msg) => msg,
        Err(_e) => {
            // TODO: proper error handling
            return Err("Invalid message!");
        }
    };
    update_slide(pid, msg.clone(), state);

    if tx.send(msg).is_err() {
        cleanup(state);
        // disconnected
        return Err("Channel disconnected!");
    }
    Ok(true)
}

async fn ws_handle(mut socket: WebSocket, pid: String, mut state: AppState, auth: bool) {
    let pres = add_client_handler_channel(pid.clone(), &mut state).await;
    let (mut tx, mut rx, text, slide) = {
        let p = pres.lock().unwrap();
        let text = serde_json::to_string(&SlideMessage::Text(p.content.clone())).unwrap();
        let slide = serde_json::to_string(&SlideMessage::Slide(p.slide)).unwrap();
        let (tx, rx) = (p.channel.0.clone(), p.channel.0.subscribe());
        (tx, rx, text, slide)
    };
    socket.send(Message::from(text)).await.unwrap();
    socket.send(Message::from(slide)).await.unwrap();

    let mut state1 = state.clone();
    let (mut sock_send, mut sock_recv) = socket.split();
    let socket_handler = async {
        while let Some(msg) = sock_recv.next().await {
            if !auth {
                continue;
            }
            if handle_socket(msg, &pid, &mut tx, &mut state1).is_err() {
                return;
            }
        }
    };
    let channel_handler = async {
        while let Ok(msg) = rx.recv().await {
            update_slide(&pid, msg.clone(), &mut state);
            let text = serde_json::to_string(&msg).unwrap();
            sock_send.send(Message::from(text)).await.unwrap();
            let id = pid.parse().unwrap();
            if let SlideMessage::Text(text) = msg {
                let _ = DbPresentation::update_content(id, text, &state.db_pool).await;
            }
        }
    };
    let () = or(socket_handler, channel_handler).await;
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
    Redirect::to(&format!("/{}/{}", user.name, pres.id)).into_response()
}

async fn present(
    State(tera): State<Tera>,
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path((uname, pid)): Path<(String, i64)>,
) -> impl IntoResponse {
    let pres_user = User::get_by_name(uname, &db).await;
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
    let is_owner = auth_session.user.as_ref().map_or(false, |u| u.id == pres_user.id);
    if !is_owner {
        let mut ctx = Context::new();
        ctx.insert("pres", &pres);
        ctx.insert("pres_user", &pres_user);
        return tera.render("audience.html", ctx, auth_session, db).await.into_response();
    }
    stage(tera, db, auth_session, pid).await.into_response()
}

async fn stage(
    tera: Tera,
    db: SqlitePool,
    auth_session: AuthSession,
    pid: i64,
) -> impl IntoResponse {
    if auth_session.user.is_none() {
        return Redirect::to("/auth/login").into_response();
    }
    let pres = DbPresentation::get_by_id(pid, &db).await.unwrap();
    let mut ctx = Context::new();
    ctx.insert("pres", &pres);
    tera.render("stage.html", ctx, auth_session, db).await
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
    let press = DbPresentation::get_for_user(&user, &db).await;
    let Ok(press) = press else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let mut press_with_recordings = vec![];
    for pres in press {
        let Ok(pres_with_recs) = Recording::get_by_presentation(pres, &db).await else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        press_with_recordings.push(pres_with_recs);
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
    State(tera): State<Tera>,
    auth_session: AuthSession,
    Form(new_user): Form<AddUserForm>,
) -> impl IntoResponse {
    let Some(ref user) = auth_session.user else {
        return Redirect::to("/auth/login").into_response();
    };
    if let Ok(is_admin) = auth_session.backend.has_perm(user, Group::Admin).await
        && is_admin
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    User::new(&db, new_user).await.unwrap();
    tera.render("/", Context::new(), auth_session, db).await
}
async fn new_user(
    State(db): State<SqlitePool>,
    State(tera): State<Tera>,
    auth_session: AuthSession,
) -> impl IntoResponse {
    let Some(ref user) = auth_session.user else {
        return Redirect::to("/auth/login").into_response();
    };
    tera.render("user/add_user.html", Context::new(), auth_session, db)
        .await
}
async fn change_pwd(
    State(db): State<SqlitePool>,
    State(tera): State<Tera>,
    auth_session: AuthSession,
) -> impl IntoResponse {
    let Some(ref user) = auth_session.user else {
        return Redirect::to("/auth/login").into_response();
    };
    tera.render("user/change_pwd.html", Context::new(), auth_session, db)
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
        // TODO: send messages with response
        return Redirect::to("/user/change_pwd").into_response();
    }
    let phash = PasswordHash::new(&user.password).unwrap();
    if Argon2::default()
        .verify_password(pwd_form.old.as_bytes(), &phash)
        .is_err()
    {
        // TODO: send messages with response
        return Redirect::to("/user/change_pwd").into_response();
    }
    if user.change_password(pwd_form.new, &db).await.is_err() {
        // TODO: send messages with response
        return Redirect::to("/user/change_pwd").into_response();
    }
    // TODO: send messages with response
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
            return tera
                .render("login.html", Context::new(), auth_session, db)
                .await;
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
    let is_owner = auth_session.user.as_ref().map_or(false, |u| u.id == pres_user.id);
    let mut ctx = Context::new();
    ctx.insert("recording", &rec);
    ctx.insert("is_owner", &is_owner);
    tera.render("recording.html", ctx, auth_session, db)
        .await
        .into_response()
}

async fn demo() -> impl IntoResponse {
    Redirect::to("/admin/1/1")
}

async fn index(
    State(tera): State<Tera>,
    auth_session: AuthSession,
    State(db): State<SqlitePool>,
) -> impl IntoResponse {
    tera.render("index.html", Context::new(), auth_session, db)
        .await
}

async fn update_slides_vtt(
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
    if tokio::fs::write(format!("assets/{rid}/slides.vtt"), body.as_bytes()).await.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let _ = sqlx::query!("UPDATE recording SET last_edited = strftime('%s', 'now') WHERE id = ?;", rid)
        .execute(&db)
        .await;
    StatusCode::OK.into_response()
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

async fn add_recording(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(pid): Path<i64>,
    mut multipart: Multipart,
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

    let mut name = String::new();
    let mut video_bytes: Option<(Vec<u8>, String)> = None;
    let mut vtt_bytes: Option<Vec<u8>> = None;
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
                    video_bytes = Some((b.to_vec(), ext));
                }
            }
            "vtt" => {
                if let Ok(b) = field.bytes().await {
                    vtt_bytes = Some(b.to_vec());
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

    let (Some((video_data, video_ext)), Some(vtt_data)) = (video_bytes, vtt_bytes) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if name.is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let video_filename = format!("video.{video_ext}");
    let captions_data = captions_bytes.unwrap_or_else(|| b"WEBVTT\n".to_vec());

    let rec = match Recording::create(
        pid,
        name,
        video_filename.clone(),
        "slides.vtt".to_string(),
        "captions.vtt".to_string(),
        &db,
    )
    .await
    {
        Ok(r) => r,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };

    let dir = format!("assets/{}", rec.id);
    if tokio::fs::create_dir_all(&dir).await.is_err()
        || tokio::fs::write(format!("{dir}/{video_filename}"), &video_data)
            .await
            .is_err()
        || tokio::fs::write(format!("{dir}/slides.vtt"), &vtt_data)
            .await
            .is_err()
        || tokio::fs::write(format!("{dir}/captions.vtt"), &captions_data)
            .await
            .is_err()
    {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    Redirect::to("/user/presentations").into_response()
}

/// Dynamic cleanup of still open presentations.
fn cleanup(state: &mut AppState) {
    let mut slides = state.slides.lock().unwrap();
    slides.retain(|_k, v| Arc::strong_count(v) > 1);
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    // USR1 signal causes cleanup routine
    let sig_handle = Signals::new([SIGUSR1]).unwrap().handle();
    let db_pool = SqlitePool::connect("sqlite://db.sqlite3").await.unwrap();
    let session_store = SqliteStore::new(db_pool.clone());
    session_store.migrate().await.unwrap();
    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(false)
        .with_expiry(Expiry::OnInactivity(Duration::days(1)));
    let tera = Tera::new();
    let backend = Backend::new(db_pool.clone());
    let auth_layer = AuthManagerLayerBuilder::new(backend, session_layer).build();

    let mut state = AppState {
        tera,
        slides: Arc::new(Mutex::new(HashMap::new())),
        db_pool,
    };
    let app = Router::new()
        .route("/", get(index))
        .route("/auth/login", get(login))
        .route("/auth/login", post(login_process))
        .route("/auth/logout", get(logout))
        .route("/user/presentations", get(presentations))
        .route("/user/recordings/{rid}/delete", post(delete_recording))
        .route("/user/recordings/{rid}/slides_vtt", post(update_slides_vtt))
        .route("/user/recordings/{rid}/name", post(update_recording_name))
        .route("/user/presentations/{pid}/name", post(update_presentation_name))
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
        .route("/{uname}/{pid}/{rid}", get(recording))
        .nest_service("/css", ServeDir::new("css/"))
        .nest_service("/js", ServeDir::new("js/"))
        .nest_service("/assets", ServeDir::new("assets/"))
        .merge(
            Router::new()
                .route("/user/presentations/{pid}/recordings", post(add_recording))
                .layer(DefaultBodyLimit::disable()),
        )
        .with_state(state.clone())
        .layer(auth_layer);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:5002").await.unwrap();
    let signal_task = tokio::spawn(async move { cleanup(&mut state) });
    axum::serve(listener, app).await.unwrap();
    sig_handle.close();
    let _ = signal_task.await;
}
