CREATE TABLE presentation_old (
    id INTEGER NOT NULL PRIMARY KEY UNIQUE,
    name TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id),
    CHECK(length("code") <= 32)
);
INSERT INTO presentation_old SELECT id, name, user_id, content FROM presentation;
DROP TABLE presentation;
ALTER TABLE presentation_old RENAME TO presentation;
