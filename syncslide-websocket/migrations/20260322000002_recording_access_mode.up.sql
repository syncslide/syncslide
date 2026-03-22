ALTER TABLE recording ADD COLUMN access_mode TEXT
    CHECK(access_mode IN ('public', 'audience', 'private'));
