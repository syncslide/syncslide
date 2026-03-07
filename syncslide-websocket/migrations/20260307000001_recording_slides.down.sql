DROP TABLE recording_slide;
ALTER TABLE recording ADD COLUMN vtt_path TEXT NOT NULL DEFAULT '';
