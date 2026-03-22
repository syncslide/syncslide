ALTER TABLE presentation ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'public'
    CHECK(access_mode IN ('public', 'audience', 'private'));
