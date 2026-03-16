CREATE TABLE users_old (
    id INT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
);
INSERT INTO users_old SELECT id, name, email, password FROM users;
DROP TABLE users;
ALTER TABLE users_old RENAME TO users;
