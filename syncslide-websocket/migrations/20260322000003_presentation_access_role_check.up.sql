PRAGMA foreign_keys = OFF;

CREATE TABLE presentation_access_new (
    id INTEGER NOT NULL PRIMARY KEY,
    presentation_id INTEGER NOT NULL REFERENCES presentation(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('editor', 'controller', 'audience')),
    UNIQUE(presentation_id, user_id)
);
INSERT INTO presentation_access_new SELECT * FROM presentation_access;
DROP TABLE presentation_access;
ALTER TABLE presentation_access_new RENAME TO presentation_access;

PRAGMA foreign_keys = ON;
