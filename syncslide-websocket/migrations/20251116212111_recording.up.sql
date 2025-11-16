-- Add up migration script here
CREATE TABLE IF NOT EXISTS recording (
	id INTEGER NOT NULL PRIMARY KEY,
	presentation_id INTEGER NOT NULL,
	vtt_path TEXT NOT NULL,
	captions_path TEXT NOT NULL,
	video_path TEXT NOT NULL,
	start DATETIME NOT NULL DEFAULT current_timestamp,
	FOREIGN KEY(presentation_id) REFERENCES presentation(id)
);
INSERT INTO recording (id, presentation_id, vtt_path, captions_path, video_path) VALUES (
	1,
	-- fixed for demo presetation
	1,
	'recording.vtt',
	'captions.vtt',
	'demo.mp4'
);
