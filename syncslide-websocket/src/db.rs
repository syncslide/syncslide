use argon2::password_hash::{PasswordHashString as PwdString, SaltString, rand_core::OsRng};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum_login::{AuthUser, AuthnBackend, AuthzBackend, UserId};
use serde::{Deserialize, Serialize};
use sqlx::types::time::OffsetDateTime;
use sqlx::{self, SqlitePool};
use std::collections::HashSet;

#[derive(Deserialize)]
pub struct NewRecordingForm {
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresentationRecordings {
    pub id: i64,
    pub user_id: i64,
    pub content: String,
    pub name: String,
    pub recordings: Vec<Recording>,
}
#[derive(Clone, Debug, Hash, Eq, PartialEq, Serialize, Deserialize)]
pub struct Recording {
    pub id: i64,
    pub presentation_id: i64,
    pub name: String,
    pub start: OffsetDateTime,
    pub vtt_path: String,
    pub video_path: String,
    pub captions_path: String,
}
impl Recording {
    pub async fn get_by_presentation(
        pres: Presentation,
        db: &SqlitePool,
    ) -> Result<PresentationRecordings, Error> {
        let recordings = sqlx::query_as!(
            Recording,
            "SELECT * FROM recording WHERE presentation_id = ?;",
            pres.id
        )
        .fetch_all(&*db)
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
        sqlx::query_as!(Recording, "SELECT * FROM recording WHERE id = ?;", id)
            .fetch_optional(&*db)
            .await
            .map_err(Error::from)
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
            ON groups.id = group_users.user_id
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
