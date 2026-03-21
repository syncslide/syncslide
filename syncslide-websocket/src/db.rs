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
    pub password: Option<String>,
}
impl Recording {
    pub async fn get_by_presentation(
        pres: Presentation,
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

    /// Hashes `plaintext` with Argon2id and stores it. Minimum 8 chars, max 1000 bytes
    /// should be enforced by the caller before this is invoked.
    pub async fn set_password(id: i64, plaintext: &str, db: &SqlitePool) -> Result<(), Error> {
        let hash = Argon2::default()
            .hash_password(
                plaintext.as_bytes(),
                &SaltString::generate(OsRng::default()),
            )
            .map_err(Error::from)?
            .to_string();
        sqlx::query("UPDATE recording SET password = ? WHERE id = ?")
            .bind(hash)
            .bind(id)
            .execute(db)
            .await
            .map_err(Error::from)
            .map(|_| ())
    }

    /// Sets recording.password to NULL.
    pub async fn clear_password(id: i64, db: &SqlitePool) -> Result<(), Error> {
        sqlx::query("UPDATE recording SET password = NULL WHERE id = ?")
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
    pub password: Option<String>,
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
            password: Option<String>,
            role: String,
        }
        let rows = sqlx::query_as!(
            Row,
            r#"SELECT p.id, p.user_id, p.content, p.name, p.password,
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
                        password: r.password,
                    },
                    r.role,
                )
            })
            .collect())
    }
    pub async fn num_for_user(user: &User, db: &SqlitePool) -> Result<i64, Error> {
        sqlx::query_scalar!(
            "SELECT COUNT(id) as count FROM presentation WHERE user_id = ?;",
            user.id
        )
        .fetch_one(&*db)
        .await
        .map_err(Error::from)
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

    /// Hashes `plaintext` with Argon2id and stores it. Minimum 8 chars, max 1000 bytes
    /// should be enforced by the caller before this is invoked.
    pub async fn set_password(id: i64, plaintext: &str, db: &SqlitePool) -> Result<(), Error> {
        let hash = Argon2::default()
            .hash_password(
                plaintext.as_bytes(),
                &SaltString::generate(OsRng::default()),
            )
            .map_err(Error::from)?
            .to_string();
        sqlx::query("UPDATE presentation SET password = ? WHERE id = ?")
            .bind(hash)
            .bind(id)
            .execute(db)
            .await
            .map_err(Error::from)
            .map(|_| ())
    }

    /// Sets presentation.password to NULL.
    pub async fn clear_password(id: i64, db: &SqlitePool) -> Result<(), Error> {
        sqlx::query("UPDATE presentation SET password = NULL WHERE id = ?")
            .bind(id)
            .execute(db)
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

    /// Adds a co-presenter. `role` must be `'editor'` or `'controller'`.
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

/// The result of an access check for a presentation.
///
/// Owners, editors, and controllers bypass password checks. `PasswordOk`
/// is returned when a provided plaintext password matches the stored Argon2id
/// hash. `Denied` is returned for all other cases (no password set means
/// the presentation is publicly viewable, but still `Denied` for write access).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccessResult {
    /// The user owns the presentation.
    Owner,
    /// The user has editor access (can edit content and control slides).
    Editor,
    /// The user has controller access (can move between slides only).
    Controller,
    /// A correct password was provided for a password-protected presentation.
    PasswordOk,
    /// None of the above conditions were met.
    Denied,
}

/// Checks what level of access a user (or unauthenticated visitor) has to a
/// presentation.
///
/// - `user`: The authenticated user, if any.
/// - `presentation_id`: The presentation to check.
/// - `provided_pwd`: A plaintext password from the request, if present.
///
/// Priority: Owner > Editor > Controller > PasswordOk > Denied.
/// Owners, editors, and controllers bypass the password check entirely.
pub async fn check_access(
    db: &SqlitePool,
    user: Option<&User>,
    presentation_id: i64,
    provided_pwd: Option<&str>,
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

    if let Some(user) = user {
        // Check ownership first
        if user.id == pres.user_id {
            return Ok(AccessResult::Owner);
        }

        // Check co-presenter role
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
                _ => Ok(AccessResult::Denied),
            };
        }
    }

    // Check password if one is set
    if let Some(stored_hash) = &pres.password {
        if let Some(provided) = provided_pwd {
            let parsed = PasswordHash::new(stored_hash)?;
            if Argon2::default()
                .verify_password(provided.as_bytes(), &parsed)
                .is_ok()
            {
                return Ok(AccessResult::PasswordOk);
            }
        }
        return Ok(AccessResult::Denied);
    }

    // No password set — presentation is public but access is still Denied for
    // write operations. Callers decide what Denied means for their context
    // (e.g., audience view is allowed; editing is not).
    Ok(AccessResult::Denied)
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

    /// Presentation::new must return password: None when no password is set.
    #[tokio::test]
    async fn presentation_password_defaults_to_none() {
        use sqlx::sqlite::SqliteConnectOptions;
        use std::str::FromStr;
        let pool = SqlitePool::connect_with(
            SqliteConnectOptions::from_str("sqlite::memory:").unwrap().foreign_keys(false),
        )
        .await
        .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("PRAGMA foreign_keys = ON").execute(&pool).await.unwrap();
        let admin: User = sqlx::query_as!(User, "SELECT * FROM users WHERE name = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
        let pres = Presentation::new(&admin, "Password Test".to_string(), &pool)
            .await
            .unwrap();
        assert!(
            pres.password.is_none(),
            "password must default to None when not set"
        );
        let fetched = Presentation::get_by_id(pres.id, &pool).await.unwrap().unwrap();
        assert!(fetched.password.is_none());
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

    /// An unrelated authenticated user on a presentation with no password must get Denied.
    #[tokio::test]
    async fn check_access_unrelated_user_denied() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner4").await;
        let stranger = make_user(&pool, "stranger4").await;
        let pres = make_presentation(&owner, &pool).await;

        let result = check_access(&pool, Some(&stranger), pres.id, None)
            .await
            .unwrap();
        assert!(
            matches!(result, AccessResult::Denied),
            "unrelated user must get Denied on an unprotected presentation"
        );
    }

    /// Unauthenticated access (user = None) on a presentation with no password must get Denied.
    #[tokio::test]
    async fn check_access_unauthenticated_denied() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner5").await;
        let pres = make_presentation(&owner, &pool).await;

        let result = check_access(&pool, None, pres.id, None).await.unwrap();
        assert!(
            matches!(result, AccessResult::Denied),
            "unauthenticated access must get Denied"
        );
    }

    /// Correct password on a password-protected presentation must return PasswordOk.
    #[tokio::test]
    async fn check_access_correct_password_returns_ok() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner6").await;
        let pres = make_presentation(&owner, &pool).await;

        use argon2::password_hash::{SaltString, rand_core::OsRng};
        use argon2::{Argon2, PasswordHasher};
        let salt = SaltString::generate(OsRng::default());
        let hash = Argon2::default()
            .hash_password(b"hunter2", &salt)
            .unwrap()
            .to_string();
        sqlx::query("UPDATE presentation SET password = ? WHERE id = ?")
            .bind(&hash)
            .bind(pres.id)
            .execute(&pool)
            .await
            .unwrap();

        let result = check_access(&pool, None, pres.id, Some("hunter2"))
            .await
            .unwrap();
        assert!(
            matches!(result, AccessResult::PasswordOk),
            "correct password must return PasswordOk"
        );
    }

    /// Wrong password on a password-protected presentation must return Denied.
    #[tokio::test]
    async fn check_access_wrong_password_returns_denied() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner7").await;
        let pres = make_presentation(&owner, &pool).await;

        use argon2::password_hash::{SaltString, rand_core::OsRng};
        use argon2::{Argon2, PasswordHasher};
        let salt = SaltString::generate(OsRng::default());
        let hash = Argon2::default()
            .hash_password(b"hunter2", &salt)
            .unwrap()
            .to_string();
        sqlx::query("UPDATE presentation SET password = ? WHERE id = ?")
            .bind(&hash)
            .bind(pres.id)
            .execute(&pool)
            .await
            .unwrap();

        let result = check_access(&pool, None, pres.id, Some("wrongpass"))
            .await
            .unwrap();
        assert!(
            matches!(result, AccessResult::Denied),
            "wrong password must return Denied"
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

    /// Owner must get Owner even when the presentation has a password set.
    /// This guards the priority ordering: ownership short-circuits before the password check.
    #[tokio::test]
    async fn check_access_owner_bypasses_password() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner8").await;
        let pres = make_presentation(&owner, &pool).await;

        use argon2::password_hash::{SaltString, rand_core::OsRng};
        use argon2::{Argon2, PasswordHasher};
        let salt = SaltString::generate(OsRng::default());
        let hash = Argon2::default()
            .hash_password(b"secret", &salt)
            .unwrap()
            .to_string();
        sqlx::query("UPDATE presentation SET password = ? WHERE id = ?")
            .bind(&hash)
            .bind(pres.id)
            .execute(&pool)
            .await
            .unwrap();

        // Owner with no password provided — must still get Owner
        let result = check_access(&pool, Some(&owner), pres.id, None).await.unwrap();
        assert!(
            matches!(result, AccessResult::Owner),
            "owner must bypass password check and get Owner"
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

    /// set_password must store an Argon2id hash; get_by_id must return a non-None password.
    #[tokio::test]
    async fn set_password_stores_hash() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "pwd_owner1").await;
        let pres = make_presentation(&owner, &pool).await;
        assert!(pres.password.is_none());

        Presentation::set_password(pres.id, "hunter2", &pool).await.unwrap();
        let updated = Presentation::get_by_id(pres.id, &pool).await.unwrap().unwrap();
        let hash = updated.password.expect("password must be set");
        // Must be Argon2id format
        assert!(hash.starts_with("$argon2id$"), "stored hash must be argon2id");
    }

    /// clear_password must set the column back to NULL.
    #[tokio::test]
    async fn clear_password_removes_hash() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "pwd_owner2").await;
        let pres = make_presentation(&owner, &pool).await;
        Presentation::set_password(pres.id, "hunter2", &pool).await.unwrap();

        Presentation::clear_password(pres.id, &pool).await.unwrap();
        let updated = Presentation::get_by_id(pres.id, &pool).await.unwrap().unwrap();
        assert!(updated.password.is_none(), "password must be NULL after clear");
    }

    /// Recording::set_password must store an Argon2id hash.
    #[tokio::test]
    async fn set_recording_password_stores_hash() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "rec_pwd_owner1").await;
        let pres = make_presentation(&owner, &pool).await;
        let rec = Recording::create(pres.id, "test rec".to_string(), None, "captions.vtt".to_string(), &pool)
            .await
            .unwrap();

        Recording::set_password(rec.id, "hunter2", &pool).await.unwrap();
        let updated = Recording::get_by_id(rec.id, &pool).await.unwrap().unwrap();
        let hash = updated.password.expect("password must be set");
        assert!(hash.starts_with("$argon2id$"), "stored hash must be argon2id");
    }

    /// Recording::clear_password must set the column back to NULL.
    #[tokio::test]
    async fn clear_recording_password_removes_hash() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "rec_pwd_owner2").await;
        let pres = make_presentation(&owner, &pool).await;
        let rec = Recording::create(pres.id, "test rec".to_string(), None, "captions.vtt".to_string(), &pool)
            .await
            .unwrap();
        Recording::set_password(rec.id, "hunter2", &pool).await.unwrap();

        Recording::clear_password(rec.id, &pool).await.unwrap();
        let updated = Recording::get_by_id(rec.id, &pool).await.unwrap().unwrap();
        assert!(updated.password.is_none(), "password must be NULL after clear");
    }

    /// An authenticated user who is not the owner can unlock a password-protected
    /// presentation with the correct password.
    #[tokio::test]
    async fn check_access_authenticated_non_owner_can_unlock_with_password() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner9").await;
        let visitor = make_user(&pool, "visitor9").await;
        let pres = make_presentation(&owner, &pool).await;

        use argon2::password_hash::{SaltString, rand_core::OsRng};
        use argon2::{Argon2, PasswordHasher};
        let salt = SaltString::generate(OsRng::default());
        let hash = Argon2::default()
            .hash_password(b"open_sesame", &salt)
            .unwrap()
            .to_string();
        sqlx::query("UPDATE presentation SET password = ? WHERE id = ?")
            .bind(&hash)
            .bind(pres.id)
            .execute(&pool)
            .await
            .unwrap();

        let result = check_access(&pool, Some(&visitor), pres.id, Some("open_sesame"))
            .await
            .unwrap();
        assert!(
            matches!(result, AccessResult::PasswordOk),
            "authenticated non-owner with correct password must get PasswordOk"
        );
    }

    /// get_shared_with_user must return presentations where the user has a co-presenter row.
    #[tokio::test]
    async fn get_shared_with_user_returns_shared_presentations() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "sh_owner").await;
        let viewer = make_user(&pool, "sh_viewer").await;
        let pres = make_presentation(&owner, &pool).await;

        // No access yet — get_shared_with_user should return empty
        let shared = DbPresentation::get_shared_with_user(&viewer, &pool).await.unwrap();
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

        let shared = DbPresentation::get_shared_with_user(&viewer, &pool).await.unwrap();
        assert_eq!(shared.len(), 1, "must return the shared presentation");
        assert_eq!(shared[0].0.id, pres.id);
        assert_eq!(shared[0].1, "editor", "role must be 'editor'");
    }
}
