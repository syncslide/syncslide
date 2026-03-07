CREATE TABLE recording_slide (
	id INTEGER NOT NULL PRIMARY KEY,
	recording_id INTEGER NOT NULL REFERENCES recording(id),
	start_seconds REAL NOT NULL,
	position INTEGER NOT NULL,
	title TEXT NOT NULL,
	content TEXT NOT NULL
);
ALTER TABLE recording DROP COLUMN vtt_path;
