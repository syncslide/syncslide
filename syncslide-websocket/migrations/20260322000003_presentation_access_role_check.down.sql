PRAGMA foreign_keys = OFF;

DELETE FROM presentation_access WHERE role = 'audience';

CREATE TABLE presentation_access_old (
    id INTEGER NOT NULL PRIMARY KEY,
    presentation_id INTEGER NOT NULL REFERENCES presentation(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('editor', 'controller')),
    UNIQUE(presentation_id, user_id)
);
INSERT INTO presentation_access_old SELECT * FROM presentation_access;
DROP TABLE presentation_access;
ALTER TABLE presentation_access_old RENAME TO presentation_access;

PRAGMA foreign_keys = ON;
