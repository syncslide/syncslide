CREATE TABLE users_new (
    id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
);
INSERT INTO users_new SELECT id, name, email, password FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
