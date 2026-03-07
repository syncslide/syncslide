CREATE TABLE recording_new (
	id INTEGER NOT NULL PRIMARY KEY,
	presentation_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	video_path TEXT,
	captions_path TEXT NOT NULL,
	start DATETIME NOT NULL DEFAULT (strftime('%s', 'now')),
	last_edited DATETIME,
	FOREIGN KEY(presentation_id) REFERENCES presentation(id)
);
INSERT INTO recording_new SELECT id, presentation_id, name, video_path, captions_path, start, last_edited FROM recording;
DROP TABLE recording;
ALTER TABLE recording_new RENAME TO recording;
