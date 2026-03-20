CREATE TABLE presentation_access (
    id INTEGER NOT NULL PRIMARY KEY,
    presentation_id INTEGER NOT NULL REFERENCES presentation(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('editor', 'controller')),
    UNIQUE(presentation_id, user_id)
);
