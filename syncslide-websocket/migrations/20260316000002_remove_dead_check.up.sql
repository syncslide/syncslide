CREATE TABLE presentation_new (
    id INTEGER NOT NULL PRIMARY KEY UNIQUE,
    name TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
INSERT INTO presentation_new SELECT id, name, user_id, content FROM presentation;
DROP TABLE presentation;
ALTER TABLE presentation_new RENAME TO presentation;
