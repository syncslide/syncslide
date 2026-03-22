use argon2::password_hash::{SaltString, rand_core::OsRng};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum_login::{AuthUser, AuthnBackend, AuthzBackend, UserId};
use serde::{Deserialize, Serialize};
use sqlx::types::time::OffsetDateTime;
use sqlx::{self, FromRow, SqlitePool};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresentationRecordings {
    pub id: i64,
    pub user_id: i64,
    pub content: String,
    pub name: String,
    pub recordings: Vec<Recording>,
    pub access: Vec<PresentationAccess>,
    pub role: String,
    pub owner_name: String,
    pub access_mode: String,
}

#[derive(Clone, Debug, Hash, Eq, PartialEq, Serialize, Deserialize, FromRow)]
pub struct Recording {
    pub id: i64,
    pub presentation_id: i64,
    pub name: String,
    #[serde(with = "time::serde::rfc3339")]
    pub start: OffsetDateTime,
    pub video_path: Option<String>,
    pub captions_path: String,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_edited: Option<OffsetDateTime>,
    pub access_mode: Option<String>,
}
impl Recording {
    pub async fn get_by_presentation(
        pres: Presentation,
        owner_name: String,
        db: &SqlitePool,
    ) -> Result<PresentationRecordings, Error> {
        let recordings = sqlx::query_as::<_, Recording>(
            "SELECT * FROM recording WHERE presentation_id = ?;",
        )
        .bind(pres.id)
        .fetch_all(db)
        .await
        .map_err(Error::from)?;
        let access = PresentationAccess::get_for_presentation(db, pres.id).await?;
        Ok(PresentationRecordings {
            recordings,
            access,
            role: "owner".to_string(),
            id: pres.id,
            name: pres.name,
            user_id: pres.user_id,
            content: pres.content,
            owner_name,
            access_mode: pres.access_mode,
        })
    }
    pub async fn get_by_id(id: i64, db: &SqlitePool) -> Result<Option<Self>, Error> {
        sqlx::query_as::<_, Recording>("SELECT * FROM recording WHERE id = ?;")
            .bind(id)
            .fetch_optional(db)
            .await
            .map_err(Error::from)
    }
    pub async fn delete(id: i64, db: &SqlitePool) -> Result<(), Error> {
        sqlx::query("DELETE FROM recording_slide WHERE recording_id = ?;")
            .bind(id)
            .execute(db)
            .await
            .map_err(Error::from)?;
        sqlx::query("DELETE FROM recording WHERE id = ?;")
            .bind(id)
            .execute(db)
            .await
            .map_err(Error::from)
            .map(|_| ())
    }
    pub async fn update_name(id: i64, name: String, db: &SqlitePool) -> Result<(), Error> {
        sqlx::query(
            "UPDATE recording SET name = ?, last_edited = strftime('%s', 'now') WHERE id = ?;",
        )
        .bind(name)
        .bind(id)
        .execute(db)
        .await
        .map_err(Error::from)
        .map(|_| ())
    }
    pub async fn create(
        presentation_id: i64,
        name: String,
        video_path: Option<String>,
        captions_path: String,
        db: &SqlitePool,
    ) -> Result<Recording, Error> {
        sqlx::query_as::<_, Recording>(
            "INSERT INTO recording (presentation_id, name, video_path, captions_path)
             VALUES (?, ?, ?, ?) RETURNING *;",
        )
        .bind(presentation_id)
        .bind(name)
        .bind(video_path)
        .bind(captions_path)
        .fetch_one(db)
        .await
        .map_err(Error::from)
    }

    /// Sets the access mode override. Pass `None` to inherit from the presentation.
    pub async fn set_access_mode(id: i64, mode: Option<&str>, db: &SqlitePool) -> Result<(), Error> {
        sqlx::query("UPDATE recording SET access_mode = ? WHERE id = ?")
            .bind(mode)
            .bind(id)
            .execute(db)
            .await
            .map_err(Error::from)
            .map(|_| ())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RecordingSlide {
    pub id: i64,
    pub recording_id: i64,
    pub start_seconds: f64,
    pub position: i64,
    pub title: String,
    pub content: String,
}
#[derive(Debug, Deserialize)]
pub struct RecordingSlideInput {
    pub start_seconds: f64,
    pub title: String,
    pub content: String,
}
impl RecordingSlide {
    pub async fn get_by_recording(recording_id: i64, db: &SqlitePool) -> Result<Vec<Self>, Error> {
        sqlx::query_as::<_, RecordingSlide>(
            "SELECT * FROM recording_slide WHERE recording_id = ? ORDER BY position;",
        )
        .bind(recording_id)
        .fetch_all(db)
        .await
        .map_err(Error::from)
    }
    pub async fn create_batch(
        recording_id: i64,
        slides: Vec<RecordingSlideInput>,
        db: &SqlitePool,
    ) -> Result<(), Error> {
        let mut tx = db.begin().await.map_err(Error::from)?;
        for (position, slide) in slides.into_iter().enumerate() {
            sqlx::query(
                "INSERT INTO recording_slide (recording_id, start_seconds, position, title, content)
                 VALUES (?, ?, ?, ?, ?);",
            )
            .bind(recording_id)
            .bind(slide.start_seconds)
            .bind(position as i64)
            .bind(slide.title)
            .bind(slide.content)
            .execute(&mut *tx)
            .await
            .map_err(Error::from)?;
        }
        tx.commit().await.map_err(Error::from)
    }
    pub async fn update_start_seconds(
        id: i64,
        start_seconds: f64,
        db: &SqlitePool,
    ) -> Result<(), Error> {
        sqlx::query("UPDATE recording_slide SET start_seconds = ? WHERE id = ?;")
            .bind(start_seconds)
            .bind(id)
            .execute(db)
            .await
            .map_err(Error::from)
            .map(|_| ())
    }
}

#[derive(sqlx::Type, Copy, Clone, Hash, Eq, PartialEq, Serialize, Deserialize)]
#[sqlx(rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum Group {
    Admin,
}

/// Add a new user, with a specific name, email and password.
#[derive(Deserialize)]
pub struct AddUserForm {
    pub name: String,
    pub email: String,
    pub password: String,
}

/// Change password form, old, new, and confirmation.
#[derive(Deserialize)]
pub struct ChangePasswordForm {
    pub old: String,
    pub new: String,
    pub confirm: String,
}

/// Login form with username and password.
#[derive(Deserialize)]
pub struct LoginForm {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Presentation {
    pub id: i64,
    pub user_id: i64,
    pub content: String,
    pub name: String,
    pub access_mode: String,
}
impl Presentation {
    pub async fn new(user: &User, name: String, db: &SqlitePool) -> Result<Presentation, Error> {
        sqlx::query_as!(
            Presentation,
            "INSERT INTO presentation (user_id, name, content) VALUES (?, ?, ?)
            RETURNING *;",
            user.id,
            name,
            ""
        )
        .fetch_one(&*db)
        .await
        .map_err(Error::from)
    }
    pub async fn get_by_id(id: i64, db: &SqlitePool) -> Result<Option<Self>, Error> {
        sqlx::query_as!(Presentation, "SELECT * FROM presentation WHERE id = ?;", id)
            .fetch_optional(&*db)
            .await
            .map_err(Error::from)
    }
    pub async fn get_for_user(user: &User, db: &SqlitePool) -> Result<Vec<Self>, Error> {
        sqlx::query_as!(
            Presentation,
            "SELECT * FROM presentation WHERE user_id = ?;",
            user.id
        )
        .fetch_all(&*db)
        .await
        .map_err(Error::from)
    }
    pub async fn get_shared_with_user(
        user: &User,
        db: &SqlitePool,
    ) -> Result<Vec<(Self, String)>, Error> {
        struct Row {
            id: i64,
            user_id: i64,
            content: String,
            name: String,
            access_mode: String,
            role: String,
        }
        let rows = sqlx::query_as!(
            Row,
            r#"SELECT p.id, p.user_id, p.content, p.name, p.access_mode,
                      pa.role as "role!: String"
               FROM presentation p
               JOIN presentation_access pa ON pa.presentation_id = p.id
               WHERE pa.user_id = ?"#,
            user.id
        )
        .fetch_all(&*db)
        .await
        .map_err(Error::from)?;
        Ok(rows
            .into_iter()
            .map(|r| {
                (
                    Presentation {
                        id: r.id,
                        user_id: r.user_id,
                        content: r.content,
                        name: r.name,
                        access_mode: r.access_mode,
                    },
                    r.role,
                )
            })
            .collect())
    }
    pub async fn update_name(id: i64, name: String, db: &SqlitePool) -> Result<(), Error> {
        sqlx::query!("UPDATE presentation SET name = ? WHERE id = ?;", name, id)
            .execute(&*db)
            .await
            .map_err(Error::from)
            .map(|_| ())
    }
    pub async fn update_content(
        id: i64,
        new_content: String,
        db: &SqlitePool,
    ) -> Result<(), Error> {
        sqlx::query!(
            "UPDATE presentation
            SET content=?
            WHERE id=?",
            new_content,
            id
        )
        .execute(&*db)
        .await
        .map_err(Error::from)
        .map(|_| ())
    }

    /// Sets the access mode. `mode` must be `'public'`, `'audience'`, or `'private'`.
    pub async fn set_access_mode(id: i64, mode: &str, db: &SqlitePool) -> Result<(), Error> {
        sqlx::query("UPDATE presentation SET access_mode = ? WHERE id = ?")
            .bind(mode)
            .bind(id)
            .execute(db)
            .await
            .map_err(Error::from)
            .map(|_| ())
    }

    pub async fn delete(id: i64, user_id: i64, db: &SqlitePool) -> Result<(), Error> {
        sqlx::query(
            "DELETE FROM recording_slide WHERE recording_id IN \
             (SELECT id FROM recording WHERE presentation_id = ?)",
        )
        .bind(id)
        .execute(&*db)
        .await
        .map_err(Error::from)?;
        sqlx::query("DELETE FROM recording WHERE presentation_id = ?")
            .bind(id)
            .execute(&*db)
            .await
            .map_err(Error::from)?;
        sqlx::query("DELETE FROM presentation WHERE id = ? AND user_id = ?")
            .bind(id)
            .bind(user_id)
            .execute(&*db)
            .await
            .map_err(Error::from)
            .map(|_| ())
    }

}

/// A co-presenter entry from the `presentation_access` table.
///
/// NOTE: `username` is not a database column — it is populated only by
/// `get_for_presentation`, which JOINs the `users` table. Do not use
/// `query_as::<_, PresentationAccess>` with any other query or `FromRow`
/// deserialization will fail at runtime.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PresentationAccess {
    pub id: i64,
    pub presentation_id: i64,
    pub user_id: i64,
    pub role: String,
    pub username: String,  // populated by JOIN — see struct doc
}

impl PresentationAccess {
    /// Returns all co-presenter rows for a presentation.
    pub async fn get_for_presentation(
        db: &SqlitePool,
        presentation_id: i64,
    ) -> Result<Vec<Self>, Error> {
        sqlx::query_as::<_, PresentationAccess>(
            "SELECT pa.*, u.name as username FROM presentation_access pa
             JOIN users u ON u.id = pa.user_id
             WHERE pa.presentation_id = ?",
        )
        .bind(presentation_id)
        .fetch_all(db)
        .await
        .map_err(Error::from)
    }

    /// Adds a user. `role` must be `'editor'`, `'controller'`, or `'audience'`.
    pub async fn add(
        db: &SqlitePool,
        presentation_id: i64,
        user_id: i64,
        role: &str,
    ) -> Result<(), Error> {
        sqlx::query(
            "INSERT INTO presentation_access (presentation_id, user_id, role)
             VALUES (?, ?, ?)",
        )
        .bind(presentation_id)
        .bind(user_id)
        .bind(role)
        .execute(db)
        .await
        .map_err(Error::from)
        .map(|_| ())
    }

    /// Removes a co-presenter row.
    pub async fn remove(
        db: &SqlitePool,
        presentation_id: i64,
        user_id: i64,
    ) -> Result<(), Error> {
        sqlx::query(
            "DELETE FROM presentation_access WHERE presentation_id = ? AND user_id = ?",
        )
        .bind(presentation_id)
        .bind(user_id)
        .execute(db)
        .await
        .map_err(Error::from)
        .map(|_| ())
    }

    /// Updates the role for an existing co-presenter row.
    pub async fn change_role(
        db: &SqlitePool,
        presentation_id: i64,
        user_id: i64,
        new_role: &str,
    ) -> Result<(), Error> {
        sqlx::query(
            "UPDATE presentation_access SET role = ?
             WHERE presentation_id = ? AND user_id = ?",
        )
        .bind(new_role)
        .bind(presentation_id)
        .bind(user_id)
        .execute(db)
        .await
        .map_err(Error::from)
        .map(|_| ())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub name: String,
    pub email: String,
    pub password: String,
}
impl User {
    pub async fn new(db: &SqlitePool, form: AddUserForm) -> Result<(), Error> {
        let pwdstr = Argon2::default()
            .hash_password(
                form.password.as_bytes(),
                &SaltString::generate(OsRng::default()),
            )
            .unwrap()
            .serialize()
            .as_str()
            .to_string();
        sqlx::query!(
            "INSERT INTO users (name, email, password) VALUES (?, ?, ?);",
            form.name,
            form.email,
            pwdstr
        )
        .execute(*&db)
        .await
        .map_err(Error::from)
        .map(|_| ())
    }
    pub async fn change_password(&self, new: String, db: &SqlitePool) -> Result<(), Error> {
        let pwdstr = Argon2::default()
            .hash_password(new.as_bytes(), &SaltString::generate(OsRng::default()))
            .unwrap()
            .serialize()
            .as_str()
            .to_string();
        sqlx::query!(
            "UPDATE users SET password = ? WHERE id = ?;",
            pwdstr,
            self.id
        )
        .execute(*&db)
        .await
        .map_err(Error::from)
        .map(|_| ())
    }
    pub async fn get_by_name(name: String, db: &SqlitePool) -> Result<Option<User>, Error> {
        sqlx::query_as!(User, "SELECT * FROM users WHERE name = ?;", name)
            .fetch_optional(&*db)
            .await
            .map_err(Error::from)
    }
    pub async fn get_by_id(id: i64, db: &SqlitePool) -> Result<Option<Self>, Error> {
        sqlx::query_as!(User, "SELECT * FROM users WHERE id = ?;", id)
            .fetch_optional(&*db)
            .await
            .map_err(Error::from)
    }
}
impl AuthUser for User {
    type Id = i64;
    fn id(&self) -> Self::Id {
        self.id
    }
    fn session_auth_hash(&self) -> &[u8] {
        self.password.as_bytes()
    }
}

#[derive(Clone)]
pub struct Backend {
    db: SqlitePool,
}
impl Backend {
    pub fn new(db: SqlitePool) -> Self {
        Backend { db }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Password(#[from] argon2::password_hash::Error),
}

#[derive(Eq, PartialEq, Hash)]
struct GroupWrapper {
    name: Group,
}

impl AuthzBackend for Backend {
    type Permission = Group;
    async fn get_user_permissions(&self, user: &User) -> Result<HashSet<Self::Permission>, Error> {
        sqlx::query_as!(
            GroupWrapper,
            r#"SELECT groups.name as "name: Group"
            FROM group_users
            INNER JOIN groups
            ON groups.id = group_users.group_id
            WHERE group_users.user_id = ?"#,
            user.id
        )
        .fetch_all(&self.db)
        .await
        .map_err(Error::from)
        .map(|vec| HashSet::from_iter(vec.into_iter().map(|gw| gw.name)))
    }
    // SyncSlide uses a flat permission model: a user's permissions are the union
    // of all groups they belong to. There are no group-level permissions separate
    // from membership, so this delegates to get_user_permissions.
    async fn get_group_permissions(&self, user: &User) -> Result<HashSet<Self::Permission>, Error> {
        Self::get_user_permissions(self, user).await
    }
}

impl AuthnBackend for Backend {
    type User = User;
    type Credentials = LoginForm;
    type Error = Error;
    async fn authenticate(
        &self,
        creds: Self::Credentials,
    ) -> Result<Option<Self::User>, Self::Error> {
        let user = sqlx::query_as!(User, "SELECT * FROM users WHERE name = ?;", creds.username)
            .fetch_optional(&self.db)
            .await?;
        let Some(user) = user else {
            return Ok(None);
        };
        let phash = PasswordHash::new(&user.password)?;
        if Argon2::default()
            .verify_password(creds.password.as_bytes(), &phash)
            .is_ok()
        {
            Ok(Some(user))
        } else {
            Ok(None)
        }
    }
    async fn get_user(&self, user_id: &UserId<Self>) -> Result<Option<User>, Error> {
        sqlx::query_as!(User, "SELECT * FROM users WHERE id = ?;", user_id)
            .fetch_optional(&self.db)
            .await
            .map_err(Error::from)
    }
}

/// The result of an access check for a presentation or recording.
///
/// Priority order: Owner > Editor > Controller > Audience > PublicOk > Denied.
/// Owners, editors, and controllers bypass the visibility mode check entirely.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccessResult {
    /// The user owns the presentation.
    Owner,
    /// The user has editor access (can edit content and control slides).
    Editor,
    /// The user has controller access (can move between slides only).
    Controller,
    /// The user is explicitly listed as an audience member.
    Audience,
    /// The presentation is public and the user has no named role.
    PublicOk,
    /// Access is denied. No password fallback exists.
    Denied,
}

/// Checks what level of access a user (or unauthenticated visitor) has to a
/// presentation, optionally scoped to a specific recording.
///
/// - `user`: The authenticated user, if any.
/// - `presentation_id`: The presentation to check.
/// - `recording_id`: If `Some`, the recording's `access_mode` overrides the
///   presentation's when non-NULL (recording-level visibility). Pass `None`
///   for pure presentation access checks.
///
/// Priority: Owner > Editor > Controller > Audience (when mode allows) > PublicOk > Denied.
pub async fn check_access(
    db: &SqlitePool,
    user: Option<&User>,
    presentation_id: i64,
    recording_id: Option<i64>,
) -> Result<AccessResult, Error> {
    let pres = sqlx::query_as!(
        Presentation,
        "SELECT * FROM presentation WHERE id = ?",
        presentation_id
    )
    .fetch_optional(db)
    .await?;

    let Some(pres) = pres else {
        return Ok(AccessResult::Denied);
    };

    // Determine effective access mode. Recording overrides presentation when non-NULL.
    let effective_mode = if let Some(rid) = recording_id {
        let rec_mode = sqlx::query_scalar!(
            "SELECT access_mode FROM recording WHERE id = ?",
            rid
        )
        .fetch_optional(db)
        .await?
        .flatten(); // Option<Option<String>> -> Option<String>
        rec_mode.unwrap_or_else(|| pres.access_mode.clone())
    } else {
        pres.access_mode.clone()
    };

    if let Some(user) = user {
        if user.id == pres.user_id {
            return Ok(AccessResult::Owner);
        }
        let row = sqlx::query!(
            "SELECT role FROM presentation_access WHERE presentation_id = ? AND user_id = ?",
            presentation_id,
            user.id
        )
        .fetch_optional(db)
        .await?;

        if let Some(row) = row {
            return match row.role.as_str() {
                "editor" => Ok(AccessResult::Editor),
                "controller" => Ok(AccessResult::Controller),
                // Audience role is ignored in private mode
                "audience" if effective_mode != "private" => Ok(AccessResult::Audience),
                _ => Ok(AccessResult::Denied),
            };
        }
    }

    match effective_mode.as_str() {
        "public" => Ok(AccessResult::PublicOk),
        _ => Ok(AccessResult::Denied),
    }
}

#[cfg(test)]
#[allow(clippy::pedantic, missing_docs)]
mod tests {
    use super::*;

    /// Hash should use the argon2id algorithm and be parseable for future verification.
    #[test]
    fn hash_produces_argon2id_format() {
        let salt = SaltString::generate(OsRng::default());
        let hash = Argon2::default()
            .hash_password(b"hunter2", &salt)
            .unwrap()
            .to_string();
        assert!(
            hash.starts_with("$argon2id$"),
            "expected argon2id prefix, got: {hash}"
        );
        PasswordHash::new(&hash).expect("hash must be parseable by PasswordHash::new");
    }

    /// The same password that was hashed must pass verification.
    #[test]
    fn correct_password_verifies() {
        let salt = SaltString::generate(OsRng::default());
        let hash = Argon2::default()
            .hash_password(b"correct_horse", &salt)
            .unwrap()
            .to_string();
        let parsed = PasswordHash::new(&hash).unwrap();
        assert!(
            Argon2::default()
                .verify_password(b"correct_horse", &parsed)
                .is_ok(),
            "correct password should verify successfully"
        );
    }

    /// A different password must not pass verification against a stored hash.
    #[test]
    fn wrong_password_fails_verification() {
        let salt = SaltString::generate(OsRng::default());
        let hash = Argon2::default()
            .hash_password(b"correct_horse", &salt)
            .unwrap()
            .to_string();
        let parsed = PasswordHash::new(&hash).unwrap();
        assert!(
            Argon2::default()
                .verify_password(b"battery_staple", &parsed)
                .is_err(),
            "wrong password should fail verification"
        );
    }

}

pub type AuthSession = axum_login::AuthSession<Backend>;

#[cfg(test)]
mod access_tests {
    use super::*;
    use sqlx::sqlite::SqliteConnectOptions;
    use std::str::FromStr;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect_with(
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
        sqlx::query_as!(User, "SELECT * FROM users WHERE name = ?", name)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn make_presentation(owner: &User, pool: &SqlitePool) -> Presentation {
        Presentation::new(owner, "Test Pres".to_string(), pool)
            .await
            .unwrap()
    }

    /// Owner of a presentation must get AccessResult::Owner.
    #[tokio::test]
    async fn check_access_owner() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner1").await;
        let pres = make_presentation(&owner, &pool).await;

        let result = check_access(&pool, Some(&owner), pres.id, None).await.unwrap();
        assert!(
            matches!(result, AccessResult::Owner),
            "presentation owner must get Owner"
        );
    }

    /// A user with editor role in presentation_access must get AccessResult::Editor.
    #[tokio::test]
    async fn check_access_editor() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner2").await;
        let editor = make_user(&pool, "editor2").await;
        let pres = make_presentation(&owner, &pool).await;

        sqlx::query(
            "INSERT INTO presentation_access (presentation_id, user_id, role) VALUES (?, ?, 'editor')",
        )
        .bind(pres.id)
        .bind(editor.id)
        .execute(&pool)
        .await
        .unwrap();

        let result = check_access(&pool, Some(&editor), pres.id, None).await.unwrap();
        assert!(
            matches!(result, AccessResult::Editor),
            "editor must get Editor"
        );
    }

    /// A user with controller role must get AccessResult::Controller.
    #[tokio::test]
    async fn check_access_controller() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner3").await;
        let controller = make_user(&pool, "controller3").await;
        let pres = make_presentation(&owner, &pool).await;

        sqlx::query(
            "INSERT INTO presentation_access (presentation_id, user_id, role) VALUES (?, ?, 'controller')",
        )
        .bind(pres.id)
        .bind(controller.id)
        .execute(&pool)
        .await
        .unwrap();

        let result = check_access(&pool, Some(&controller), pres.id, None)
            .await
            .unwrap();
        assert!(
            matches!(result, AccessResult::Controller),
            "controller must get Controller"
        );
    }

    /// An unrelated authenticated user on a private presentation must get Denied.
    #[tokio::test]
    async fn check_access_unrelated_user_denied() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner4").await;
        let stranger = make_user(&pool, "stranger4").await;
        let pres = make_presentation(&owner, &pool).await;
        sqlx::query("UPDATE presentation SET access_mode = 'private' WHERE id = ?")
            .bind(pres.id).execute(&pool).await.unwrap();

        let result = check_access(&pool, Some(&stranger), pres.id, None).await.unwrap();
        assert!(
            matches!(result, AccessResult::Denied),
            "unrelated user must get Denied on a private presentation"
        );
    }

    /// Unauthenticated access on an audience-mode presentation must get Denied.
    #[tokio::test]
    async fn check_access_unauthenticated_denied() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner5").await;
        let pres = make_presentation(&owner, &pool).await;
        sqlx::query("UPDATE presentation SET access_mode = 'audience' WHERE id = ?")
            .bind(pres.id).execute(&pool).await.unwrap();

        let result = check_access(&pool, None, pres.id, None).await.unwrap();
        assert!(
            matches!(result, AccessResult::Denied),
            "unauthenticated access must get Denied on an audience-mode presentation"
        );
    }

    /// A non-existent presentation must return Denied.
    #[tokio::test]
    async fn check_access_nonexistent_presentation_denied() {
        let pool = setup_pool().await;
        let result = check_access(&pool, None, 999999, None).await.unwrap();
        assert!(
            matches!(result, AccessResult::Denied),
            "non-existent presentation must return Denied"
        );
    }

    /// add_access must insert a row and get_access_for_presentation must return it.
    #[tokio::test]
    async fn add_and_get_access() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner_a1").await;
        let editor = make_user(&pool, "editor_a1").await;
        let pres = make_presentation(&owner, &pool).await;

        PresentationAccess::add(&pool, pres.id, editor.id, "editor").await.unwrap();
        let entries = PresentationAccess::get_for_presentation(&pool, pres.id).await.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].user_id, editor.id);
        assert_eq!(entries[0].role, "editor");
    }

    /// remove_access must delete the row.
    #[tokio::test]
    async fn remove_access_deletes_row() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner_a2").await;
        let editor = make_user(&pool, "editor_a2").await;
        let pres = make_presentation(&owner, &pool).await;
        PresentationAccess::add(&pool, pres.id, editor.id, "editor").await.unwrap();

        PresentationAccess::remove(&pool, pres.id, editor.id).await.unwrap();
        let entries = PresentationAccess::get_for_presentation(&pool, pres.id).await.unwrap();
        assert!(entries.is_empty());
    }

    /// change_role must update the role for an existing row.
    #[tokio::test]
    async fn change_role_updates_existing_row() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner_a3").await;
        let editor = make_user(&pool, "editor_a3").await;
        let pres = make_presentation(&owner, &pool).await;
        PresentationAccess::add(&pool, pres.id, editor.id, "editor").await.unwrap();

        PresentationAccess::change_role(&pool, pres.id, editor.id, "controller").await.unwrap();
        let entries = PresentationAccess::get_for_presentation(&pool, pres.id).await.unwrap();
        assert_eq!(entries[0].role, "controller");
    }

    /// get_shared_with_user must return presentations where the user has a co-presenter row.
    #[tokio::test]
    async fn get_shared_with_user_returns_shared_presentations() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "sh_owner").await;
        let viewer = make_user(&pool, "sh_viewer").await;
        let pres = make_presentation(&owner, &pool).await;

        // No access yet — get_shared_with_user should return empty
        let shared = Presentation::get_shared_with_user(&viewer, &pool).await.unwrap();
        assert!(shared.is_empty(), "must return empty before access is granted");

        // Grant access
        sqlx::query(
            "INSERT INTO presentation_access (presentation_id, user_id, role) VALUES (?, ?, 'editor')",
        )
        .bind(pres.id)
        .bind(viewer.id)
        .execute(&pool)
        .await
        .unwrap();

        let shared = Presentation::get_shared_with_user(&viewer, &pool).await.unwrap();
        assert_eq!(shared.len(), 1, "must return the shared presentation");
        assert_eq!(shared[0].0.id, pres.id);
        assert_eq!(shared[0].1, "editor", "role must be 'editor'");
    }

    /// Unauthenticated access on a public presentation must get PublicOk.
    #[tokio::test]
    async fn check_access_public_returns_public_ok() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "pub_owner1").await;
        let pres = make_presentation(&owner, &pool).await;
        // Default is 'public', so no UPDATE needed.
        let result = check_access(&pool, None, pres.id, None).await.unwrap();
        assert!(
            matches!(result, AccessResult::PublicOk),
            "unauthenticated on public presentation must get PublicOk"
        );
    }

    /// Unauthenticated access on an audience-mode presentation must get Denied.
    #[tokio::test]
    async fn check_access_audience_mode_denies_unauthenticated() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "aud_owner1").await;
        let pres = make_presentation(&owner, &pool).await;
        sqlx::query("UPDATE presentation SET access_mode = 'audience' WHERE id = ?")
            .bind(pres.id).execute(&pool).await.unwrap();
        let result = check_access(&pool, None, pres.id, None).await.unwrap();
        assert!(matches!(result, AccessResult::Denied));
    }

    /// A user with role='audience' on an audience-mode presentation must get Audience.
    #[tokio::test]
    async fn check_access_audience_member_gets_audience_result() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "aud_owner2").await;
        let viewer = make_user(&pool, "aud_viewer2").await;
        let pres = make_presentation(&owner, &pool).await;
        sqlx::query("UPDATE presentation SET access_mode = 'audience' WHERE id = ?")
            .bind(pres.id).execute(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO presentation_access (presentation_id, user_id, role) VALUES (?, ?, 'audience')"
        )
        .bind(pres.id).bind(viewer.id).execute(&pool).await.unwrap();
        let result = check_access(&pool, Some(&viewer), pres.id, None).await.unwrap();
        assert!(
            matches!(result, AccessResult::Audience),
            "audience member must get Audience on audience-mode presentation"
        );
    }

    /// A user with role='audience' on a private presentation must get Denied.
    #[tokio::test]
    async fn check_access_private_ignores_audience_role() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "priv_owner1").await;
        let viewer = make_user(&pool, "priv_viewer1").await;
        let pres = make_presentation(&owner, &pool).await;
        sqlx::query("UPDATE presentation SET access_mode = 'private' WHERE id = ?")
            .bind(pres.id).execute(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO presentation_access (presentation_id, user_id, role) VALUES (?, ?, 'audience')"
        )
        .bind(pres.id).bind(viewer.id).execute(&pool).await.unwrap();
        let result = check_access(&pool, Some(&viewer), pres.id, None).await.unwrap();
        assert!(
            matches!(result, AccessResult::Denied),
            "audience role must be ignored on private presentation"
        );
    }

    /// A recording with NULL access_mode must inherit the presentation's mode.
    #[tokio::test]
    async fn check_access_recording_inherits_presentation_mode() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "rec_owner1").await;
        let pres = make_presentation(&owner, &pool).await;
        sqlx::query("UPDATE presentation SET access_mode = 'private' WHERE id = ?")
            .bind(pres.id).execute(&pool).await.unwrap();

        // Create a recording with NULL access_mode (inherit)
        let rec = sqlx::query_as::<_, Recording>(
            "INSERT INTO recording (presentation_id, name, captions_path)
             VALUES (?, 'Test', 'test.vtt') RETURNING *;"
        )
        .bind(pres.id)
        .fetch_one(&pool).await.unwrap();
        assert!(rec.access_mode.is_none(), "recording access_mode must default to NULL");

        // Unauthenticated access to recording must inherit 'private' -> Denied
        let result = check_access(&pool, None, pres.id, Some(rec.id)).await.unwrap();
        assert!(
            matches!(result, AccessResult::Denied),
            "recording with NULL access_mode must inherit presentation's private mode"
        );
    }
}
