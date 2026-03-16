use argon2::password_hash::{PasswordHashString as PwdString, SaltString, rand_core::OsRng};
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
        Ok(PresentationRecordings {
            recordings,
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
            .execute(db)
            .await
            .map_err(Error::from)?;
        }
        Ok(())
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
    // TODO: group perms not set in DB
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

pub type AuthSession = axum_login::AuthSession<Backend>;
