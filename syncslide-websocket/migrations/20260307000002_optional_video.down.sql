CREATE TABLE recording_old (
	id INTEGER NOT NULL PRIMARY KEY,
	presentation_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	video_path TEXT NOT NULL DEFAULT '',
	captions_path TEXT NOT NULL,
	start DATETIME NOT NULL DEFAULT (strftime('%s', 'now')),
	last_edited DATETIME,
	FOREIGN KEY(presentation_id) REFERENCES presentation(id)
);
INSERT INTO recording_old SELECT id, presentation_id, name, COALESCE(video_path, ''), captions_path, start, last_edited FROM recording;
DROP TABLE recording;
ALTER TABLE recording_old RENAME TO recording;
