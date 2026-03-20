-- SQLite before 3.35 cannot drop columns. This migration is irreversible.
-- To roll back: restore from a backup or recreate the table without the column.
SELECT 1;
